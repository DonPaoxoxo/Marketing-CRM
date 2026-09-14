/** AI Assistant Learner endpoints: suggestions, status, settings and logs.
 *
 *  The assistant only returns suggestions. Nothing here writes to spiels or
 *  documents, so it cannot approve, publish, delete, archive or reassign anything.
 *  Prompts carry the member's selected text (with phone numbers, emails and
 *  secret-looking values redacted) and, when chosen, approved reference documents.
 *  Logs record the action, model, outcome, timing and token counts — never text. */

import { Router, type Request } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  AI_ACTIONS, AI_HISTORY_KEEP, DEFAULT_AI_SETTINGS, MAX_MODELS, aiRequestSchema, aiResponseSchema, tierForPosition, aiSettingsSchema, buildMessages, redactForAi,
  type AiAssistResult, type AiHistoryItem, type AiSettings,
} from '../../../src/lib/spiel-ai';
import { firstIssue, isSpielOwner } from '../../../src/lib/spiels';
import { hasPermission } from '../../../src/lib/permissions';
import { env } from '../../env';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { asyncHandler, badRequest, forbidden, notFound, tooManyRequests } from '../../http/errors';
import { actorOf, bodyOf } from '../helpers';
import { checkModelAvailability, runWithFallback, type Attempt } from '../../ai/openrouter';
import { person } from './data';

export const aiRouter = Router();

/** Swappable in tests so no real network call is ever made. */
export const aiNetwork: { fetch: typeof fetch; sleep?: (ms: number) => Promise<void>; apiKey?: () => string | undefined } = { fetch: (...args) => fetch(...args) };
const apiKey = () => (aiNetwork.apiKey ? aiNetwork.apiKey() : env.OPENROUTER_API_KEY);

export async function loadAiSettings(conn?: PoolConnection): Promise<AiSettings> {
  const row = await queryOne<RowDataPacket>('SELECT * FROM ai_settings WHERE id = 1', [], conn);
  if (!row) return DEFAULT_AI_SETTINGS;
  let models = DEFAULT_AI_SETTINGS.models;
  try { models = JSON.parse(String(row.models)); } catch { /* keep defaults */ }
  return {
    enabled: Boolean(row.enabled), models, temperature: Number(row.temperature), maxOutputTokens: Number(row.max_output_tokens),
    timeoutMs: Number(row.timeout_ms), totalTimeoutMs: Number(row.total_timeout_ms ?? DEFAULT_AI_SETTINGS.totalTimeoutMs), dailyLimitPerMember: Number(row.daily_limit_per_member), maxRegenerations: Number(row.max_regenerations),
    maxDocumentChars: Number(row.max_document_chars),
  };
}

const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

async function usedToday(userId: string): Promise<number> {
  const row = await queryOne<RowDataPacket>('SELECT COUNT(*) AS n FROM ai_requests WHERE user_id = ? AND created_at >= ?', [userId, startOfUtcDay()]);
  return Number(row?.n ?? 0);
}

function assertOwner(req: Request) {
  if (!isSpielOwner(person(req))) throw forbidden('Only the System Administrator can manage the AI Assistant.');
}

aiRouter.get('/ai/status', asyncHandler(async (req, res) => {
  const settings = await loadAiSettings();
  const owner = isSpielOwner(person(req));
  const used = await usedToday(req.user!.id);
  res.json({
    enabled: settings.enabled,
    configured: Boolean(apiKey()),
    mayUse: hasPermission(req.user, 'edit:resources'),
    requestsLeftToday: owner ? null : Math.max(0, settings.dailyLimitPerMember - used),
    maxRegenerations: settings.maxRegenerations,
    primaryModel: settings.models.find((m) => m.enabled)?.id ?? '',
  });
}));

aiRouter.post('/ai/assist', asyncHandler(async (req, res) => {
  if (!hasPermission(req.user, 'edit:resources')) throw forbidden(`Your role (${req.user!.role}) cannot use the AI Assistant.`);
  const settings = await loadAiSettings();
  if (!settings.enabled) throw forbidden('The AI Assistant Learner is turned off by the System Administrator.');
  const parsed = aiRequestSchema.safeParse(bodyOf(req));
  if (!parsed.success) { const i = firstIssue(parsed.error); throw badRequest(i.error, { field: i.field }); }
  const input = parsed.data;
  const p = person(req);
  const owner = isSpielOwner(p);
  const actor = actorOf(req);

  if (!owner && (await usedToday(p.id)) >= settings.dailyLimitPerMember) {
    throw tooManyRequests(`You have used all ${settings.dailyLimitPerMember} AI requests for today. Your text is unchanged; try again tomorrow.`);
  }

  // Regenerations: a chain rooted at the member's own original request, capped by the settings.
  let root: string | null = null;
  if (input.regenerateOf) {
    const original = await queryOne<RowDataPacket>('SELECT id, regenerate_of FROM ai_requests WHERE id = ? AND user_id = ?', [input.regenerateOf, p.id]);
    if (!original) throw badRequest('That suggestion cannot be regenerated.', { field: 'regenerateOf' });
    root = original.regenerate_of ? String(original.regenerate_of) : String(original.id);
    const count = await queryOne<RowDataPacket>('SELECT COUNT(*) AS n FROM ai_requests WHERE regenerate_of = ?', [root]);
    if (Number(count?.n ?? 0) >= settings.maxRegenerations) throw tooManyRequests(`This suggestion has been regenerated ${settings.maxRegenerations} times, the most allowed.`);
  }

  // Reference documents: approved versions only. The System Owner may use a pending one to review it.
  const documents: { id: string; title: string; text: string }[] = [];
  if (input.documentIds.length) {
    const ids = [...new Set(input.documentIds)];
    const rows = await query<RowDataPacket>(
      `SELECT d.id, d.title, d.description, d.status, d.created_by, d.approved_version_id, d.current_version_id, av.extracted_text AS approved_text, cv.extracted_text AS current_text
         FROM spiel_documents d
         LEFT JOIN spiel_document_versions av ON av.id = d.approved_version_id
         LEFT JOIN spiel_document_versions cv ON cv.id = d.current_version_id
        WHERE d.deleted_at IS NULL AND d.id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
    let budget = settings.maxDocumentChars;
    for (const id of ids) {
      const d = rows.find((r) => String(r.id) === id);
      const usable = d && d.approved_version_id && d.status !== 'Archived';
      const ownerReview = d && owner;
      if (!d || (!usable && !ownerReview)) throw badRequest('Only approved documents can be used as AI references.', { field: 'documentIds' });
      const source = usable ? d.approved_text : d.current_text;
      const body = `${d.description ? `Description: ${d.description}\n` : ''}${source ? String(source) : '(No readable text in this file; use the title and description only.)'}`;
      const slice = redactForAi(body.slice(0, Math.max(0, budget))).text;
      budget -= slice.length;
      documents.push({ id, title: String(d.title), text: slice });
      if (budget <= 0) break;
    }
  }

  const redacted = redactForAi(input.text);
  const compare = input.compareTexts.map((t) => redactForAi(t).text);
  const categories = (await query<RowDataPacket>('SELECT name FROM spiel_categories WHERE active = 1 ORDER BY sort_order')).map((r) => String(r.name));
  const messages = buildMessages(input.action, redacted.text, {
    country: input.country, language: input.language, targetLanguage: input.targetLanguage, platform: input.platform,
    category: input.category, situation: redactForAi(input.situation).text, tone: input.tone, categories, documents,
  }, compare);

  const started = Date.now();
  const models = settings.models.filter((m) => m.enabled).map((m) => m.id);
  const result = await runWithFallback({
    apiKey: apiKey(), models, messages, temperature: settings.temperature, maxTokens: settings.maxOutputTokens,
    timeoutMs: settings.timeoutMs, totalTimeoutMs: settings.totalTimeoutMs, appOrigin: env.APP_ORIGIN, fetchImpl: aiNetwork.fetch, sleep: aiNetwork.sleep,
  });
  const durationMs = Date.now() - started;
  const sum = (k: keyof Attempt['usage']) => result.attempts.reduce<number | null>((n, a) => (a.usage[k] === null ? n : (n ?? 0) + (a.usage[k] as number)), null);

  const requestId = await tx(async (conn) => {
    const id = await nextId('AIR', conn);
    const now = new Date();
    const modelsTried = new Set(result.attempts.map((a) => a.model)).size;
    await execute(
      `INSERT INTO ai_requests (id, user_id, action, spiel_id, regenerate_of, status, model_used, used_fallback, fallback_attempts, error_type, duration_ms, prompt_tokens, completion_tokens, total_tokens, input_chars, document_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, p.id, input.action, input.spielId, root, result.ok ? 'success' : 'failed', result.ok ? result.model : '', result.ok && result.usedFallback ? 1 : 0,
        Math.max(0, modelsTried - 1), result.ok ? '' : result.errorType, durationMs, sum('prompt'), sum('completion'), sum('total'),
        input.text.length, documents.map((d) => d.id).join(','), now],
      conn,
    );
    for (const [i, a] of result.attempts.entries()) {
      await execute(
        'INSERT INTO ai_usage_logs (request_id, attempt_no, model, outcome, http_status, error_type, duration_ms, prompt_tokens, completion_tokens, total_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, i + 1, a.model.slice(0, 120), a.outcome, a.httpStatus, a.errorType, a.durationMs, a.usage.prompt, a.usage.completion, a.usage.total, now],
        conn,
      );
    }
    await recordAudit(conn, {
      actor, recordType: 'AI Assistant', recordId: id, recordLabel: `${AI_ACTIONS[input.action].label}${input.spielId ? ` · ${input.spielId}` : ''}`, action: 'ai-request',
      reason: result.ok ? `Suggestion from ${result.model} (${tierForPosition(result.modelIndex)} model ${result.modelIndex + 1})` : `Failed: ${result.errorType}`,
      changes: [{ field: 'model', from: null, to: result.ok ? result.model : null }, { field: 'documents', from: null, to: documents.map((d) => d.id).join(', ') || null }],
    });
    if (result.ok) {
      // The member's own history: the text as it was sent (already redacted) and the suggestion.
      const context = { country: input.country, language: input.language, targetLanguage: input.targetLanguage, platform: input.platform, category: input.category, situation: redactForAi(input.situation).text, tone: input.tone };
      await execute(
        `INSERT INTO ai_history (ai_request_id, user_id, action, input_text, context, suggestion, model, model_position, spiel_id, document_count, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, p.id, input.action, redacted.text, JSON.stringify(context).slice(0, 2000), JSON.stringify(result.suggestion), result.model.slice(0, 120), result.modelIndex + 1, input.spielId, documents.length, now],
        conn,
      );
      const [cutoff] = await query<RowDataPacket>('SELECT created_at FROM ai_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET ?', [p.id, AI_HISTORY_KEEP], conn);
      if (cutoff) await execute('DELETE FROM ai_history WHERE user_id = ? AND created_at <= ?', [p.id, cutoff.created_at], conn);
    }
    return id;
  });

  const attempts = result.attempts.map((a) => ({ model: a.model, outcome: a.outcome, errorType: a.errorType, httpStatus: a.httpStatus, durationMs: a.durationMs }));
  if (!result.ok) {
    const status = result.errorType === 'not-configured' ? 503 : result.errorType === 'rate-limited' ? 429 : 502;
    return void res.status(status).json({ message: result.message, errorType: result.errorType, requestId, attempts, original: input.text });
  }
  const left = owner ? null : Math.max(0, settings.dailyLimitPerMember - (await usedToday(p.id)));
  const regenerationsUsed = root ? Number((await queryOne<RowDataPacket>('SELECT COUNT(*) AS n FROM ai_requests WHERE regenerate_of = ?', [root]))?.n ?? 0) : 0;
  const payload: AiAssistResult = {
    requestId, original: input.text, suggestion: result.suggestion, model: result.model, usedFallback: result.usedFallback, modelPosition: result.modelIndex + 1, tier: tierForPosition(result.modelIndex), attempts,
    redactions: redacted.redactions, documentsUsed: documents.map((d) => ({ id: d.id, title: d.title })),
    regenerationsLeft: Math.max(0, settings.maxRegenerations - regenerationsUsed), requestsLeftToday: left ?? -1,
  };
  res.json(payload);
}));

/* ── A member's own history ─────────────────────────────────────── */

const mapHistory = (r: RowDataPacket): AiHistoryItem => {
  let context: AiHistoryItem['context'] = {};
  try { context = JSON.parse(String(r.context)); } catch { /* keep empty */ }
  const parsed = aiResponseSchema.safeParse((() => { try { return JSON.parse(String(r.suggestion)); } catch { return {}; } })());
  return {
    id: String(r.ai_request_id), action: r.action, inputText: String(r.input_text), context,
    suggestion: parsed.success ? parsed.data : aiResponseSchema.parse({}), model: String(r.model), modelPosition: Number(r.model_position),
    tier: tierForPosition(Number(r.model_position) - 1), spielId: r.spiel_id ? String(r.spiel_id) : null,
    documentCount: Number(r.document_count), createdAt: new Date(r.created_at).toISOString(),
  };
};

/** Always the session user's own rows; nobody browses another member's history. */
aiRouter.get('/ai/history', asyncHandler(async (req, res) => {
  const limit = Math.min(AI_HISTORY_KEEP, Math.max(1, Number(req.query.limit) || 50));
  const [rows, total] = await Promise.all([
    query<RowDataPacket>(`SELECT * FROM ai_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ${limit}`, [req.user!.id]),
    queryOne<RowDataPacket>('SELECT COUNT(*) AS n FROM ai_history WHERE user_id = ?', [req.user!.id]),
  ]);
  res.json({ items: rows.map(mapHistory), total: Number(total?.n ?? 0) });
}));

aiRouter.delete('/ai/history/:id', asyncHandler(async (req, res) => {
  const p = person(req);
  const row = await queryOne<RowDataPacket>('SELECT ai_request_id, user_id, action FROM ai_history WHERE ai_request_id = ?', [String(req.params.id)]);
  // Someone else's entry does not exist for a member; the System Owner may remove any.
  if (!row || (String(row.user_id) !== p.id && !isSpielOwner(p))) throw notFound('History entry not found.');
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('DELETE FROM ai_history WHERE ai_request_id = ?', [row.ai_request_id], conn);
    await recordAudit(conn, { actor, recordType: 'AI Assistant', recordId: String(row.ai_request_id), recordLabel: `${AI_ACTIONS[row.action as keyof typeof AI_ACTIONS]?.label ?? row.action} history`, action: 'delete', reason: String(row.user_id) === actor.id ? 'Removed from own AI history' : `Removed from ${row.user_id}'s AI history` });
  });
  res.json({ removed: String(row.ai_request_id) });
}));

aiRouter.delete('/ai/history', asyncHandler(async (req, res) => {
  const reason = String(bodyOf<{ reason?: unknown }>(req).reason ?? '').trim().slice(0, 500);
  if (reason.length < 10) throw badRequest('Write a reason of at least 10 characters.', { field: 'reason' });
  const actor = actorOf(req);
  const removed = await tx(async (conn) => {
    const result = await execute('DELETE FROM ai_history WHERE user_id = ?', [actor.id], conn);
    await recordAudit(conn, { actor, recordType: 'AI Assistant', recordId: actor.id, recordLabel: 'AI history', action: 'delete', reason: `Cleared own AI history (${result.affectedRows} entries): ${reason}` });
    return result.affectedRows;
  });
  res.json({ removed });
}));

/* ── System Owner settings and logs ─────────────────────────────── */

aiRouter.get('/ai/settings', asyncHandler(async (req, res) => {
  assertOwner(req);
  res.json({ settings: await loadAiSettings(), configured: Boolean(apiKey()) });
}));

aiRouter.put('/ai/settings', asyncHandler(async (req, res) => {
  assertOwner(req);
  const parsed = aiSettingsSchema.safeParse(bodyOf(req));
  if (!parsed.success) { const i = firstIssue(parsed.error); throw badRequest(i.error, { field: i.field }); }
  const s = parsed.data;
  const ids = s.models.map((m) => m.id);
  if (new Set(ids).size !== ids.length) throw badRequest('Each model can appear only once.', { field: 'models' });
  const before = await loadAiSettings();
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute(
      `UPDATE ai_settings SET enabled = ?, models = ?, temperature = ?, max_output_tokens = ?, timeout_ms = ?, total_timeout_ms = ?, daily_limit_per_member = ?, max_regenerations = ?, max_document_chars = ?, updated_by = ?, updated_at = ? WHERE id = 1`,
      [s.enabled ? 1 : 0, JSON.stringify(s.models), s.temperature, s.maxOutputTokens, s.timeoutMs, s.totalTimeoutMs, s.dailyLimitPerMember, s.maxRegenerations, s.maxDocumentChars, actor.id, new Date()],
      conn,
    );
    const changes = (Object.keys(s) as (keyof AiSettings)[])
      .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(s[k]))
      .map((k) => ({ field: k, from: k === 'models' ? before.models.map((m) => `${m.id}${m.enabled ? '' : ' (off)'}`) : before[k], to: k === 'models' ? s.models.map((m) => `${m.id}${m.enabled ? '' : ' (off)'}`) : s[k] }));
    await recordAudit(conn, { actor, recordType: 'AI Settings', recordId: 'ai-settings', recordLabel: 'AI Assistant Learner settings', action: 'update', reason: 'AI settings changed', changes });
  });
  res.json({ settings: await loadAiSettings(), configured: Boolean(apiKey()) });
}));

aiRouter.post('/ai/models/check', asyncHandler(async (req, res) => {
  assertOwner(req);
  const body = bodyOf<{ ids?: unknown }>(req);
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_MODELS) : (await loadAiSettings()).models.map((m) => m.id);
  const availability = await checkModelAvailability(ids, aiNetwork.fetch);
  res.json({ availability, checkedAt: new Date().toISOString() });
}));

aiRouter.get('/ai/logs', asyncHandler(async (req, res) => {
  assertOwner(req);
  const onlyErrors = req.query.status === 'failed';
  const rows = await query<RowDataPacket>(
    `SELECT r.*, u.name AS user_name FROM ai_requests r JOIN users u ON u.id = r.user_id ${onlyErrors ? "WHERE r.status = 'failed'" : ''} ORDER BY r.created_at DESC LIMIT 200`,
  );
  const ids = rows.map((r) => String(r.id));
  const attempts = ids.length ? await query<RowDataPacket>(`SELECT * FROM ai_usage_logs WHERE request_id IN (${ids.map(() => '?').join(',')}) ORDER BY request_id, attempt_no`, ids) : [];
  const [totals] = await query<RowDataPacket>(
    "SELECT COUNT(*) AS requests, SUM(status = 'failed') AS failed, SUM(used_fallback) AS fallbacks, SUM(total_tokens) AS tokens FROM ai_requests WHERE created_at >= ?",
    [startOfUtcDay()],
  );
  res.json({
    today: { requests: Number(totals.requests ?? 0), failed: Number(totals.failed ?? 0), fallbacks: Number(totals.fallbacks ?? 0), tokens: Number(totals.tokens ?? 0) },
    logs: rows.map((r) => ({
      id: String(r.id), userName: String(r.user_name), action: String(r.action), status: String(r.status), model: String(r.model_used),
      usedFallback: Boolean(r.used_fallback), fallbackAttempts: Number(r.fallback_attempts), errorType: String(r.error_type), durationMs: Number(r.duration_ms),
      totalTokens: r.total_tokens === null ? null : Number(r.total_tokens), createdAt: new Date(r.created_at).toISOString(),
      attempts: attempts.filter((a) => String(a.request_id) === String(r.id)).map((a) => ({ model: String(a.model), outcome: String(a.outcome), errorType: String(a.error_type), httpStatus: a.http_status === null ? null : Number(a.http_status), durationMs: Number(a.duration_ms) })),
    })),
  });
}));
