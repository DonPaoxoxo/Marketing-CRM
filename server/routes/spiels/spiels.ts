/** Spiels, categories, comments, favorites, notes and the announcement.
 *
 *  created_by always comes from the session. Edits and deletes are the creator's
 *  or the System Owner's; reviewing, archiving and restoring are the System
 *  Owner's alone. Every write is audited in the same transaction. */

import { Router, type Request } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import {
  LIMITS, SPIEL_TRANSITIONS, checkDelete, checkFeedback, checkTransition, contentKey, describeChanges, editPlan, findSimilar,
  firstIssue, isSpielOwner, mayModify, spielInputSchema, statusAfterEdit,
  type SpielAction, type SpielInput, type SpielStatus,
} from '../../../src/lib/spiels';
import { hasPermission } from '../../../src/lib/permissions';
import { sanitizeText } from '../../../src/lib/sanitize';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { notify, notifyAdministrators } from '../../notifications';
import { asyncHandler, badRequest, conflict, forbidden, HttpError, notFound } from '../../http/errors';
import { actorOf, bodyOf } from '../helpers';
import { loadCategories, loadSpielDetail, loadSpiels, lockSpiel, person, spielOr404 } from './data';

export const spielsRouter = Router();

const LINK = (id: string) => `/shared-spiel?spiel=${encodeURIComponent(id)}`;

function assertMayWrite(req: Request) {
  if (!hasPermission(req.user, 'edit:resources')) throw forbidden(`Your role (${req.user!.role}) can read the library but cannot submit spiels.`);
}

function parseInput(body: Record<string, unknown>): SpielInput {
  const parsed = spielInputSchema.safeParse(body);
  if (!parsed.success) {
    const issue = firstIssue(parsed.error);
    throw badRequest(issue.error, { field: issue.field });
  }
  return parsed.data;
}

async function assertCategory(categoryId: string, conn?: PoolConnection) {
  const row = await queryOne<RowDataPacket>('SELECT active FROM spiel_categories WHERE id = ?', [categoryId], conn);
  if (!row) throw badRequest('That category does not exist.', { field: 'categoryId' });
  if (!row.active) throw badRequest('That category has been deactivated. Choose another.', { field: 'categoryId' });
}

async function approval(conn: PoolConnection, spielId: string, versionId: string | null, action: string, actor: { id: string; name: string }, feedback = '', changes = '') {
  const id = await nextId('SPA', conn);
  await execute(
    'INSERT INTO spiel_approvals (id, spiel_id, version_id, action, feedback, changes, actor_id, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, spielId, versionId, action, feedback.slice(0, 2000), changes.slice(0, 600), actor.id, actor.name.slice(0, 160), new Date()],
    conn,
  );
}

/** Audit field changes without copying the script itself into the permanent log. */
function auditChanges(before: Partial<SpielInput> | null, after: SpielInput) {
  const fields: (keyof SpielInput)[] = ['title', 'categoryId', 'targetCountry', 'language', 'platform', 'campaignRef', 'tags', 'situation'];
  const out = fields
    .filter((f) => JSON.stringify(before?.[f] ?? null) !== JSON.stringify(after[f]))
    .map((f) => ({ field: f, from: before?.[f] ?? null, to: after[f] }));
  if (!before || before.content !== after.content) out.push({ field: 'content', from: before ? '(previous script)' : null, to: '(script updated)' } as never);
  return out;
}

const versionToInput = (v: RowDataPacket): SpielInput => ({
  title: String(v.title), categoryId: String(v.category_id), content: String(v.content), situation: String(v.situation),
  targetCountry: v.target_country, language: String(v.language), platform: v.platform, campaignRef: String(v.campaign_ref),
  tags: String(v.tags).split(',').filter(Boolean),
});

/** Exact duplicates of what this person can see: approved live spiels and their own. */
async function exactDuplicate(req: Request, key: string, exceptId?: string): Promise<RowDataPacket | null> {
  const owner = isSpielOwner(person(req));
  return queryOne<RowDataPacket>(
    `SELECT s.id, v.title FROM spiels s JOIN spiel_versions v ON v.id IN (s.approved_version_id, s.current_version_id)
      WHERE s.deleted_at IS NULL AND v.content_key = ? AND s.id <> ?
        AND (${owner ? '1 = 1' : "s.created_by = ? OR (s.approved_version_id = v.id AND s.status <> 'Archived')"}) LIMIT 1`,
    owner ? [key, exceptId ?? ''] : [key, exceptId ?? '', req.user!.id],
  );
}

/* ── Reading ────────────────────────────────────────────────────── */

spielsRouter.get('/categories', asyncHandler(async (req, res) => {
  const categories = await loadCategories();
  res.json({ categories: isSpielOwner(person(req)) ? categories : categories.filter((c) => c.active) });
}));

spielsRouter.get('/library', asyncHandler(async (req, res) => {
  const p = person(req);
  const [spiels, settings] = await Promise.all([
    loadSpiels(p, "s.approved_version_id IS NOT NULL AND s.status <> 'Archived'", []),
    queryOne<RowDataPacket>('SELECT announcement, updated_at FROM spiel_settings WHERE id = 1'),
  ]);
  // The library always shows the approved version, even to its author while an edit is pending.
  const library = spiels.map((s) => ({ ...s, current: s.approved!, pendingVersion: s.current.id !== s.approved!.id }));
  res.json({ spiels: library, announcement: String(settings?.announcement ?? ''), today: new Date().toISOString().slice(0, 10), isSystemOwner: isSpielOwner(p), mayWrite: hasPermission(req.user, 'edit:resources') });
}));

spielsRouter.get('/mine', asyncHandler(async (req, res) => {
  res.json({ spiels: await loadSpiels(person(req), 's.created_by = ?', [req.user!.id]) });
}));

spielsRouter.get('/reviews', asyncHandler(async (req, res) => {
  if (!isSpielOwner(person(req))) throw forbidden('Only the System Administrator reviews submissions.');
  res.json({ spiels: await loadSpiels(person(req), "s.status = 'Pending Approval'", []) });
}));

spielsRouter.post('/check-similar', asyncHandler(async (req, res) => {
  const body = bodyOf<{ content?: unknown; exceptId?: unknown }>(req);
  const content = String(body.content ?? '').slice(0, LIMITS.content);
  if (content.trim().length < 10) return void res.json({ similar: [] });
  const p = person(req);
  const candidates = await loadSpiels(p, "s.status <> 'Archived'", []);
  const pool = candidates.flatMap((s) => [s.approved, s.canEdit ? s.current : null].filter(Boolean).map((v) => ({ id: s.id, title: v!.title, content: v!.content })));
  const best = new Map<string, { id: string; title: string; score: number }>();
  for (const hit of findSimilar(content, pool, typeof body.exceptId === 'string' ? body.exceptId : undefined)) {
    if (!best.has(hit.id) || best.get(hit.id)!.score < hit.score) best.set(hit.id, hit);
  }
  res.json({ similar: [...best.values()] });
}));

spielsRouter.get('/:id', asyncHandler(async (req, res) => {
  res.json(await loadSpielDetail(person(req), String(req.params.id)));
}));

/* ── Creating and editing ───────────────────────────────────────── */

spielsRouter.post('/', asyncHandler(async (req, res) => {
  assertMayWrite(req);
  const body = bodyOf<Record<string, unknown>>(req);
  const input = parseInput(body);
  await assertCategory(input.categoryId);
  const submit = body.submit === true;
  const key = contentKey(input.content);
  const duplicate = await exactDuplicate(req, key);
  if (duplicate && body.allowDuplicate !== true) {
    throw conflict(`This script is the same as "${duplicate.title}" (${duplicate.id}). Reuse it, or confirm to save anyway.`, { field: 'content', conflictId: String(duplicate.id) });
  }

  const actor = actorOf(req);
  const id = await tx(async (conn) => {
    const spielId = await nextId('SPL', conn);
    const versionId = await nextId('SPV', conn);
    const now = new Date();
    const status: SpielStatus = submit ? 'Pending Approval' : 'Draft';
    await execute('INSERT INTO spiels (id, status, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [spielId, status, actor.id, now, now], conn);
    await insertVersion(conn, spielId, versionId, 1, input, key, status, actor.id, submit ? now : null);
    await execute('UPDATE spiels SET current_version_id = ? WHERE id = ?', [versionId, spielId], conn);
    await approval(conn, spielId, versionId, 'created', actor);
    if (submit) await approval(conn, spielId, versionId, 'submitted', actor);
    await recordAudit(conn, { actor, recordType: 'Spiel', recordId: spielId, recordLabel: input.title, action: 'create', reason: submit ? 'Spiel submitted for approval' : 'Spiel saved as draft', changes: auditChanges(null, input) });
    if (submit) {
      await notifyAdministrators(conn, actor.id, { kind: 'spiel-submitted', title: `New spiel for approval: ${input.title}`, body: `${actor.name} submitted a spiel.`, link: LINK(spielId), recordType: 'Spiel', recordId: spielId });
    }
    return spielId;
  });
  res.status(201).json(await loadSpielDetail(person(req), id));
}));

async function insertVersion(conn: PoolConnection, spielId: string, versionId: string, no: number, input: SpielInput, key: string, status: string, userId: string, submittedAt: Date | null) {
  const now = new Date();
  await execute(
    `INSERT INTO spiel_versions (id, spiel_id, version_no, title, category_id, content, situation, target_country, language, platform, campaign_ref, tags, content_key, status, created_by, created_at, updated_by, updated_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [versionId, spielId, no, input.title, input.categoryId, input.content, input.situation, input.targetCountry, input.language, input.platform, input.campaignRef, input.tags.join(','), key, status, userId, now, userId, now, submittedAt],
    conn,
  );
}

spielsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const p = person(req);
  const id = String(req.params.id);
  const seen = await spielOr404(p, id);
  if (!mayModify(p, seen)) throw forbidden('Only the person who created this spiel or the System Owner can edit it.');
  const body = bodyOf<Record<string, unknown>>(req);
  const input = parseInput(body);
  const key = contentKey(input.content);
  const duplicate = await exactDuplicate(req, key, id);
  if (duplicate && body.allowDuplicate !== true) {
    throw conflict(`This script is the same as "${duplicate.title}" (${duplicate.id}). Confirm to save anyway.`, { field: 'content', conflictId: String(duplicate.id) });
  }
  const actor = actorOf(req);

  await tx(async (conn) => {
    const row = await lockSpiel(conn, id);
    const [current] = await query<RowDataPacket>('SELECT * FROM spiel_versions WHERE id = ?', [String(row.current_version_id)], conn);
    const before = versionToInput(current);
    if (before.categoryId !== input.categoryId) await assertCategory(input.categoryId, conn);
    const plan = editPlan({ status: row.status, current: { status: current.status }, approvedVersionId: row.approved_version_id, currentVersionId: String(row.current_version_id) });
    if (typeof plan === 'object') throw new HttpError(409, plan.error);
    const summary = describeChanges(before, input);
    const now = new Date();
    const byOwnerOnSomeoneElse = isSpielOwner(p) && String(row.created_by) !== actor.id;

    if (plan === 'new-version') {
      const [max] = await query<RowDataPacket>('SELECT MAX(version_no) AS n FROM spiel_versions WHERE spiel_id = ?', [id], conn);
      const versionId = await nextId('SPV', conn);
      await insertVersion(conn, id, versionId, Number(max.n) + 1, input, key, 'Pending Approval', actor.id, now);
      await execute("UPDATE spiels SET current_version_id = ?, status = 'Pending Approval', updated_at = ? WHERE id = ?", [versionId, now, id], conn);
      await approval(conn, id, versionId, 'new-version', actor, '', summary);
      await recordAudit(conn, { actor, recordType: 'Spiel', recordId: id, recordLabel: input.title, action: 'update', reason: `New version ${Number(max.n) + 1} submitted for approval`, changes: auditChanges(before, input) });
      await notifyAdministrators(conn, actor.id, { kind: 'spiel-edited', title: `Approved spiel edited: ${input.title}`, body: `${actor.name} edited an approved spiel. Version ${Number(max.n) + 1} needs approval; the approved version stays live meanwhile.`, link: LINK(id), recordType: 'Spiel', recordId: id });
    } else {
      const status = statusAfterEdit(row.status);
      await execute(
        `UPDATE spiel_versions SET title = ?, category_id = ?, content = ?, situation = ?, target_country = ?, language = ?, platform = ?, campaign_ref = ?, tags = ?, content_key = ?, status = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
        [input.title, input.categoryId, input.content, input.situation, input.targetCountry, input.language, input.platform, input.campaignRef, input.tags.join(','), key, status, actor.id, now, current.id],
        conn,
      );
      await execute('UPDATE spiels SET status = ?, updated_at = ? WHERE id = ?', [status, now, id], conn);
      await approval(conn, id, String(current.id), byOwnerOnSomeoneElse ? 'edited-by-owner' : 'edited', actor, '', summary);
      await recordAudit(conn, { actor, recordType: 'Spiel', recordId: id, recordLabel: input.title, action: 'update', reason: byOwnerOnSomeoneElse ? 'Edited by the System Administrator during review' : 'Draft updated', changes: auditChanges(before, input) });
      if (body.submit === true && status === 'Draft') await transition(req, conn, id, 'submit', '');
    }
  });
  res.json(await loadSpielDetail(p, id));
}));

/* ── Workflow ───────────────────────────────────────────────────── */

async function transition(req: Request, conn: PoolConnection, id: string, action: SpielAction, feedback: string) {
  const p = person(req);
  const actor = actorOf(req);
  const row = await lockSpiel(conn, id);
  const check = checkTransition(p, { createdById: String(row.created_by), status: row.status, hasApproved: Boolean(row.approved_version_id) }, action, feedback);
  if ('error' in check) throw new HttpError(check.status, check.error, check.field ? { field: check.field } : undefined);
  const versionId = String(row.current_version_id);
  const [version] = await query<RowDataPacket>('SELECT title, version_no FROM spiel_versions WHERE id = ?', [versionId], conn);
  const title = String(version.title);
  const now = new Date();
  const creatorId = String(row.created_by);
  const tellCreator = async (kind: string, heading: string) => {
    if (creatorId !== actor.id) {
      await notify(conn, [creatorId], { kind, title: heading, body: feedback ? `Feedback from ${actor.name}: ${feedback}` : `Reviewed by ${actor.name}.`, link: LINK(id), recordType: 'Spiel', recordId: id });
    }
  };

  switch (action) {
    case 'submit': {
      // Anything submitted before (then rejected, sent back or re-versioned) is a request for review, not a new submission.
      const [earlier] = await query<RowDataPacket>("SELECT COUNT(*) AS n FROM spiel_approvals WHERE spiel_id = ? AND action IN ('submitted', 'new-version')", [id], conn);
      const resubmission = Number(earlier.n) > 0;
      await execute("UPDATE spiel_versions SET status = 'Pending Approval', submitted_at = ? WHERE id = ?", [now, versionId], conn);
      await execute("UPDATE spiels SET status = 'Pending Approval', updated_at = ? WHERE id = ?", [now, id], conn);
      await approval(conn, id, versionId, 'submitted', actor);
      await notifyAdministrators(conn, actor.id, resubmission
        ? { kind: 'review-requested', title: `Review requested: ${title}`, body: `${actor.name} asked for this spiel to be reviewed again.`, link: LINK(id), recordType: 'Spiel', recordId: id }
        : { kind: 'spiel-submitted', title: `New spiel for approval: ${title}`, body: `${actor.name} submitted a spiel.`, link: LINK(id), recordType: 'Spiel', recordId: id });
      break;
    }
    case 'approve': {
      if (row.approved_version_id && String(row.approved_version_id) !== versionId) {
        await execute("UPDATE spiel_versions SET status = 'Superseded' WHERE id = ?", [String(row.approved_version_id)], conn);
      }
      await execute("UPDATE spiel_versions SET status = 'Approved', admin_feedback = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?", [feedback, actor.id, now, versionId], conn);
      await execute("UPDATE spiels SET status = 'Approved', approved_version_id = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?", [versionId, actor.id, now, now, id], conn);
      await approval(conn, id, versionId, 'approved', actor, feedback);
      await tellCreator('spiel-approved', `Spiel approved: ${title}`);
      break;
    }
    case 'reject':
    case 'request-changes': {
      const to = SPIEL_TRANSITIONS[action].to;
      await execute('UPDATE spiel_versions SET status = ?, admin_feedback = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?', [to, feedback, actor.id, now, versionId], conn);
      await execute('UPDATE spiels SET status = ?, updated_at = ? WHERE id = ?', [to, now, id], conn);
      await approval(conn, id, versionId, action === 'reject' ? 'rejected' : 'changes-requested', actor, feedback);
      await tellCreator(action === 'reject' ? 'spiel-rejected' : 'spiel-changes-requested', action === 'reject' ? `Spiel rejected: ${title}` : `Changes requested: ${title}`);
      break;
    }
    case 'archive':
      await execute("UPDATE spiels SET status = 'Archived', status_before_archive = status, updated_at = ? WHERE id = ?", [now, id], conn);
      await approval(conn, id, versionId, 'archived', actor, feedback);
      break;
    case 'restore':
      await execute("UPDATE spiels SET status = 'Approved', status_before_archive = NULL, current_version_id = approved_version_id, updated_at = ? WHERE id = ?", [now, id], conn);
      await approval(conn, id, String(row.approved_version_id), 'restored', actor, feedback);
      break;
  }
  const auditAction = ({ submit: 'status-change', approve: 'approve', reject: 'reject', 'request-changes': 'status-change', archive: 'archive', restore: 'restore' } as const)[action];
  await recordAudit(conn, {
    actor, recordType: 'Spiel', recordId: id, recordLabel: title, action: auditAction,
    reason: feedback || `Spiel ${action === 'submit' ? 'submitted for approval' : action}`,
    changes: [{ field: 'status', from: row.status, to: check.to }],
  });
}

spielsRouter.post('/:id/actions', asyncHandler(async (req, res) => {
  const p = person(req);
  const id = String(req.params.id);
  await spielOr404(p, id);
  const body = bodyOf<{ action?: unknown; feedback?: unknown }>(req);
  const action = String(body.action) as SpielAction;
  if (!(action in SPIEL_TRANSITIONS)) throw badRequest('Unknown action.', { field: 'action' });
  if (action === 'submit') assertMayWrite(req);
  const feedback = sanitizeText(body.feedback, LIMITS.feedback);
  await tx((conn) => transition(req, conn, id, action, feedback));
  res.json(await loadSpielDetail(p, id));
}));

spielsRouter.delete('/:id', asyncHandler(async (req, res) => {
  const p = person(req);
  const id = String(req.params.id);
  const spiel = await spielOr404(p, id);
  const reason = checkFeedback(bodyOf<{ reason?: unknown }>(req).reason, true);
  if ('error' in reason) throw badRequest(reason.error.replace('an explanation', 'a reason'), { field: 'reason' });
  const actor = actorOf(req);
  await tx(async (conn) => {
    const row = await lockSpiel(conn, id);
    const plan = checkDelete(p, { createdById: String(row.created_by), status: row.status, hasApproved: Boolean(row.approved_version_id) });
    if ('error' in plan) throw new HttpError(plan.status, plan.error);
    if (plan.mode === 'permanent') {
      await execute('DELETE FROM spiels WHERE id = ?', [id], conn);
    } else {
      await execute('UPDATE spiels SET deleted_at = ?, updated_at = ? WHERE id = ?', [new Date(), new Date(), id], conn);
    }
    // The audit keeps who, which spiel, when and why — not its content.
    await recordAudit(conn, { actor, recordType: 'Spiel', recordId: id, recordLabel: spiel.current.title, action: 'delete', reason: `${plan.mode === 'permanent' ? 'Permanently deleted' : 'Deleted by its author'}: ${reason.value}` });
  });
  res.json({ deleted: id });
}));

/* ── Using, favorites, notes ────────────────────────────────────── */

spielsRouter.post('/:id/use', asyncHandler(async (req, res) => {
  const spiel = await spielOr404(person(req), String(req.params.id));
  if (!spiel.approved) throw badRequest('Only approved spiels are counted as used.');
  await execute('UPDATE spiels SET usage_count = usage_count + 1, last_used_at = ? WHERE id = ?', [new Date(), spiel.id]);
  res.json({ usageCount: spiel.usageCount + 1 });
}));

spielsRouter.put('/:id/favorite', asyncHandler(async (req, res) => {
  const spiel = await spielOr404(person(req), String(req.params.id));
  const favorite = bodyOf<{ favorite?: unknown }>(req).favorite === true;
  if (favorite) await execute('INSERT IGNORE INTO spiel_favorites (user_id, spiel_id, created_at) VALUES (?, ?, ?)', [req.user!.id, spiel.id, new Date()]);
  else await execute('DELETE FROM spiel_favorites WHERE user_id = ? AND spiel_id = ?', [req.user!.id, spiel.id]);
  res.json({ favorite });
}));

spielsRouter.put('/:id/note', asyncHandler(async (req, res) => {
  const spiel = await spielOr404(person(req), String(req.params.id));
  const raw = bodyOf<{ body?: unknown }>(req).body;
  if (typeof raw === 'string' && raw.length > LIMITS.note) throw badRequest(`Keep the note under ${LIMITS.note.toLocaleString()} characters.`, { field: 'body' });
  const note = typeof raw === 'string' ? raw.replace(/[ --]/g, '').trim() : '';
  // Personal: keyed by the session user, never touching the shared spiel.
  if (note) {
    await execute('INSERT INTO spiel_notes (user_id, spiel_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)', [req.user!.id, spiel.id, note, new Date(), new Date()]);
  } else {
    await execute('DELETE FROM spiel_notes WHERE user_id = ? AND spiel_id = ?', [req.user!.id, spiel.id]);
  }
  res.json({ note });
}));

/* ── Comments ───────────────────────────────────────────────────── */

spielsRouter.post('/:id/comments', asyncHandler(async (req, res) => {
  const p = person(req);
  const spiel = await spielOr404(p, String(req.params.id));
  const body = sanitizeText(bodyOf<{ body?: unknown }>(req).body, LIMITS.comment);
  if (!body) throw badRequest('Write a comment first.', { field: 'body' });
  const actor = actorOf(req);
  await tx(async (conn) => {
    const id = await nextId('SPC', conn);
    await execute('INSERT INTO spiel_comments (id, spiel_id, body, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, spiel.id, body, actor.id, new Date(), new Date()], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel', recordId: spiel.id, recordLabel: spiel.current.title, action: 'create', reason: `Comment ${id} added` });
  });
  res.status(201).json(await loadSpielDetail(p, spiel.id));
}));

async function commentOr404(req: Request, commentId: string) {
  const row = await queryOne<RowDataPacket>('SELECT * FROM spiel_comments WHERE id = ? AND deleted_at IS NULL', [commentId]);
  if (!row) throw notFound('Comment not found.');
  const spiel = await spielOr404(person(req), String(row.spiel_id)).catch(() => { throw notFound('Comment not found.'); });
  if (!mayModify(person(req), { createdById: String(row.created_by) })) throw forbidden('Only the person who wrote this comment or the System Owner can change it.');
  return { row, spiel };
}

spielsRouter.patch('/comments/:commentId', asyncHandler(async (req, res) => {
  const { row, spiel } = await commentOr404(req, String(req.params.commentId));
  const body = sanitizeText(bodyOf<{ body?: unknown }>(req).body, LIMITS.comment);
  if (!body) throw badRequest('Write a comment first.', { field: 'body' });
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('UPDATE spiel_comments SET body = ?, updated_at = ? WHERE id = ?', [body, new Date(), row.id], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel', recordId: spiel.id, recordLabel: spiel.current.title, action: 'update', reason: `Comment ${row.id} edited` });
  });
  res.json(await loadSpielDetail(person(req), spiel.id));
}));

spielsRouter.delete('/comments/:commentId', asyncHandler(async (req, res) => {
  const { row, spiel } = await commentOr404(req, String(req.params.commentId));
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('UPDATE spiel_comments SET deleted_at = ? WHERE id = ?', [new Date(), row.id], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel', recordId: spiel.id, recordLabel: spiel.current.title, action: 'delete', reason: `Comment ${row.id} deleted` });
  });
  res.json(await loadSpielDetail(person(req), spiel.id));
}));

/* ── Categories and announcement (System Owner) ─────────────────── */

function assertOwner(req: Request) {
  if (!isSpielOwner(person(req))) throw forbidden('Only the System Administrator can manage this.');
}

spielsRouter.post('/categories', asyncHandler(async (req, res) => {
  assertOwner(req);
  const name = sanitizeText(bodyOf<{ name?: unknown }>(req).name, LIMITS.category);
  if (name.length < 3) throw badRequest('Give the category a name of at least 3 characters.', { field: 'name' });
  const actor = actorOf(req);
  await tx(async (conn) => {
    const clash = await queryOne<RowDataPacket>('SELECT id FROM spiel_categories WHERE name = ?', [name], conn);
    if (clash) throw conflict('A category with that name already exists.', { field: 'name', conflictId: String(clash.id) });
    const id = await nextId('SCT', conn);
    const [max] = await query<RowDataPacket>('SELECT COALESCE(MAX(sort_order), 0) AS n FROM spiel_categories', [], conn);
    await execute('INSERT INTO spiel_categories (id, name, sort_order, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)', [id, name, Number(max.n) + 1, new Date(), new Date()], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel Category', recordId: id, recordLabel: name, action: 'create', reason: 'Category added' });
  });
  res.status(201).json({ categories: await loadCategories() });
}));

spielsRouter.put('/categories/order', asyncHandler(async (req, res) => {
  assertOwner(req);
  const ids = bodyOf<{ ids?: unknown }>(req).ids;
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) throw badRequest('Send the category ids in their new order.');
  const actor = actorOf(req);
  await tx(async (conn) => {
    for (const [i, cid] of (ids as string[]).entries()) await execute('UPDATE spiel_categories SET sort_order = ?, updated_at = ? WHERE id = ?', [i + 1, new Date(), cid], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel Category', recordId: 'order', recordLabel: 'Category order', action: 'update', reason: 'Categories reordered' });
  });
  res.json({ categories: await loadCategories() });
}));

spielsRouter.patch('/categories/:categoryId', asyncHandler(async (req, res) => {
  assertOwner(req);
  const id = String(req.params.categoryId);
  const body = bodyOf<{ name?: unknown; active?: unknown }>(req);
  const actor = actorOf(req);
  await tx(async (conn) => {
    const [row] = await query<RowDataPacket>('SELECT * FROM spiel_categories WHERE id = ? FOR UPDATE', [id], conn);
    if (!row) throw notFound('Category not found.');
    const changes: { field: string; from: unknown; to: unknown }[] = [];
    if (body.name !== undefined) {
      const name = sanitizeText(body.name, LIMITS.category);
      if (name.length < 3) throw badRequest('Give the category a name of at least 3 characters.', { field: 'name' });
      const clash = await queryOne<RowDataPacket>('SELECT id FROM spiel_categories WHERE name = ? AND id <> ?', [name, id], conn);
      if (clash) throw conflict('A category with that name already exists.', { field: 'name' });
      await execute('UPDATE spiel_categories SET name = ?, updated_at = ? WHERE id = ?', [name, new Date(), id], conn);
      changes.push({ field: 'name', from: row.name, to: name });
    }
    if (typeof body.active === 'boolean') {
      await execute('UPDATE spiel_categories SET active = ?, updated_at = ? WHERE id = ?', [body.active ? 1 : 0, new Date(), id], conn);
      changes.push({ field: 'active', from: Boolean(row.active), to: body.active });
    }
    if (changes.length) await recordAudit(conn, { actor, recordType: 'Spiel Category', recordId: id, recordLabel: String(row.name), action: 'update', reason: 'Category changed', changes });
  });
  res.json({ categories: await loadCategories() });
}));

spielsRouter.put('/announcement', asyncHandler(async (req, res) => {
  assertOwner(req);
  const announcement = sanitizeText(bodyOf<{ announcement?: unknown }>(req).announcement, LIMITS.announcement);
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('UPDATE spiel_settings SET announcement = ?, updated_by = ?, updated_at = ? WHERE id = 1', [announcement, actor.id, new Date()], conn);
    await recordAudit(conn, { actor, recordType: 'Spiel Category', recordId: 'announcement', recordLabel: 'Library announcement', action: 'update', reason: announcement ? 'Announcement updated' : 'Announcement cleared' });
  });
  res.json({ announcement });
}));
