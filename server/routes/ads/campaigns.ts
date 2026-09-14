/** Ads Monitoring: campaigns, daily records, follow-ups, overview, compare and
 *  settings. Viewing is open to every signed-in user; every change is limited to
 *  the record's creator or the System Owner (see src/lib/ads/campaign.ts). */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../http/errors';
import { actorOf, bodyOf } from '../helpers';
import {
  CAMPAIGN_STATUSES, campaignAlerts, checkCampaignInput, checkDailyInput, isIsoDate, isSystemOwner, mayAddToCampaign,
  mayCreateCampaign, mayModifyChild, mayModifyRecord, pacing, type Campaign, type CampaignStatus,
} from '../../../src/lib/ads/campaign';
import { COUNT_FIELDS, OBJECTIVES, aggregate, computeMetrics, primaryResult, type Objective } from '../../../src/lib/ads/metrics';
import { CURRENCY_CODES, unitsToDecimal } from '../../../src/lib/ads/money';
import { compareTrend, todayIn, trendWindows, TREND_METRICS } from '../../../src/lib/ads/trends';
import { sanitizeText } from '../../../src/lib/sanitize';
import {
  CAMPAIGN_COLUMNS, COUNT_COLUMNS, loadCampaign, loadCreatives, loadFollowUps, loadRecords, loadReferences, loadSettings,
  loadStatusHistory, logStatus, mapDaily, queryCampaigns,
} from './data';
import { assertExists, assertOwner, campaignOr404, person, requireReason } from './shared';

export const campaignsRouter = Router();

/** The metric a campaign's trend is judged by, per objective. */
const TREND_KEY: Record<Objective, string> = {
  Engagement: 'engagementRate', Traffic: 'costPerLinkClick', Awareness: 'cpm', 'Follower Growth': 'costPerFollower', 'App Installs': 'costPerInstall',
};

const SORTS: Record<string, string> = {
  reference: 'c.reference', name: 'c.name', startDate: 'c.start_date', endDate: 'c.end_date', status: 'c.status',
  currency: 'c.currency', budget: 'c.budget', createdAt: 'c.created_at',
  spend: '(SELECT SUM(d.amount_spent) FROM ads_daily_records d WHERE d.campaign_id = c.id)',
};

async function validateReferences(v: Partial<Record<string, unknown>>) {
  await assertExists('platforms', v.platformId as string, 'platformId', 'That platform');
  await assertExists('brands', v.brandId as string, 'brandId', 'That brand');
  await assertExists('projects', v.projectId as string, 'projectId', 'That project');
  await assertExists('countries', v.targetCountryCode as string, 'targetCountryCode', 'That country');
  await assertExists('social_accounts', v.socialAccountId as string, 'socialAccountId', 'That social account');
  await assertExists('users', v.assignedStaffId as string, 'assignedStaffId', 'That staff member');
}

/* ── List ──────────────────────────────────────────────────────── */

campaignsRouter.get('/campaigns', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.search?.trim()) { where.push('(c.name LIKE ? OR c.reference LIKE ?)'); params.push(`%${q.search.trim()}%`, `%${q.search.trim()}%`); }
  if (q.status && (CAMPAIGN_STATUSES as readonly string[]).includes(q.status)) { where.push('c.status = ?'); params.push(q.status); }
  else if (q.status !== 'all') where.push("c.status <> 'Archived'");
  const exact: [string, string][] = [['country', 'c.target_country_code'], ['platform', 'c.platform_id'], ['brand', 'c.brand_id'], ['owner', 'c.created_by'], ['objective', 'c.objective'], ['currency', 'c.currency']];
  for (const [key, column] of exact) if (q[key]) { where.push(`${column} = ?`); params.push(q[key]); }
  if (q.from && isIsoDate(q.from)) { where.push('c.end_date >= ?'); params.push(q.from); }
  if (q.to && isIsoDate(q.to)) { where.push('c.start_date <= ?'); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const pageSize = Math.min(100, Math.max(5, Number(q.pageSize) || 25));
  const page = Math.max(1, Number(q.page) || 1);
  const sort = SORTS[q.sort ?? ''] ?? 'c.start_date';
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';

  const [countRow] = await query<RowDataPacket>(`SELECT COUNT(*) AS n FROM ads_campaigns c ${whereSql}`, params);
  const campaigns = await queryCampaigns(whereSql, params, `ORDER BY ${sort} ${dir}, c.id`, `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const ids = campaigns.map((c) => c.id);
  const [records, creatives] = await Promise.all([loadRecords(ids), loadCreatives(ids)]);
  const settings = await loadSettings();

  const items = campaigns.map((c) => {
    const own = records.filter((r) => r.campaignId === c.id);
    const m = computeMetrics(aggregate(own), c.budget);
    const result = primaryResult(c.objective, m);
    const windows = trendWindows('last7', todayIn(c.reportingTimezone));
    const metric = TREND_METRICS.find((t) => t.key === TREND_KEY[c.objective])!;
    const trend = 'error' in windows ? { status: 'insufficient', reason: windows.error } : compareTrend(own, metric, windows, settings.stablePct);
    const cr = creatives.filter((k) => k.campaignId === c.id);
    return {
      ...c,
      spend: m.spend === null ? null : unitsToDecimal(m.spend),
      recordCount: own.length,
      primaryResult: result,
      trend: { metric: metric.label, ...trend },
      creatives: cr.map((k) => ({ id: k.id, fileName: k.fileName, adsUrl: k.adsUrl, width: k.width, height: k.height, sizeBytes: k.sizeBytes, createdByName: k.createdByName, createdAt: k.createdAt })),
      canEdit: mayModifyRecord(person(req), c),
    };
  });
  res.json({ items, total: Number(countRow.n), page, pageSize });
}));

/* ── Detail ────────────────────────────────────────────────────── */

campaignsRouter.get('/campaigns/:id', asyncHandler(async (req, res) => {
  const campaign = await campaignOr404(String(req.params.id));
  const [records, history, creatives, references, followUps, settings] = await Promise.all([
    loadRecords([campaign.id]), loadStatusHistory([campaign.id]), loadCreatives([campaign.id]), loadReferences(campaign.id),
    loadFollowUps([campaign.id]), loadSettings(),
  ]);
  const statusHistory = history.get(campaign.id) ?? [];
  const p = pacing(campaign, records, statusHistory);
  const me = person(req);
  res.json({
    campaign,
    records: records.map((r) => ({ ...r, canEdit: mayModifyChild(me, campaign, r) })),
    statusHistory,
    creatives: creatives.map((k) => ({ ...k, canEdit: mayModifyChild(me, campaign, k) })),
    references: references.map((f) => ({ ...f, canEdit: mayModifyChild(me, campaign, f) })),
    followUps: followUps.map((f) => ({ ...f, canEdit: mayModifyChild(me, campaign, f) })),
    pacing: { ...p, spent: p.spent === null ? null : unitsToDecimal(p.spent), remaining: p.remaining === null ? null : (p.remaining < 0n ? `-${unitsToDecimal(-p.remaining)}` : unitsToDecimal(p.remaining)) },
    alerts: campaignAlerts(campaign, records, statusHistory, settings),
    settings,
    canEdit: mayModifyRecord(me, campaign),
    isSystemOwner: isSystemOwner(me),
    today: todayIn(campaign.reportingTimezone),
  });
}));

/* ── Create / edit / archive / delete ─────────────────────────── */

campaignsRouter.post('/campaigns', asyncHandler(async (req, res) => {
  if (!mayCreateCampaign(person(req))) throw forbidden(`Your role (${req.user!.role}) cannot create campaigns.`);
  const checked = checkCampaignInput(bodyOf<Record<string, unknown>>(req));
  if ('errors' in checked) {
    const [field, message] = Object.entries(checked.errors)[0];
    throw badRequest(message!, { field });
  }
  const v = checked.value;
  if (v.status === 'Archived') throw badRequest('A new campaign cannot start archived.', { field: 'status' });
  await validateReferences(v);
  const taken = await queryOne<RowDataPacket>('SELECT id FROM ads_campaigns WHERE reference = ?', [v.reference]);
  if (taken) throw conflict(`Campaign reference ${v.reference} is already used by ${taken.id}.`, { field: 'reference', conflictId: String(taken.id) });

  const actor = actorOf(req);
  const campaign = await tx(async (conn) => {
    const id = await nextId('ADC', conn);
    const now = new Date();
    const entries = Object.entries(CAMPAIGN_COLUMNS).filter(([k]) => (v as Record<string, unknown>)[k] !== undefined);
    await execute(
      `INSERT INTO ads_campaigns (id, ${entries.map(([, col]) => col).join(', ')}, created_by, created_at, updated_by, updated_at)
       VALUES (?, ${entries.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
      [id, ...entries.map(([k]) => (v as Record<string, unknown>)[k]), actor.id, now, actor.id, now],
      conn,
    );
    await logStatus(conn, id, v.status!, actor.id);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: id, recordLabel: `${v.reference} — ${v.name}`, action: 'create', reason: 'Campaign created' });
    return loadCampaign(id, conn);
  }).catch((error) => {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw conflict(`Campaign reference ${v.reference} is already used.`, { field: 'reference' });
    throw error;
  });
  res.status(201).json(campaign);
}));

campaignsRouter.patch('/campaigns/:id', asyncHandler(async (req, res) => {
  const before = await campaignOr404(String(req.params.id));
  assertOwner(req, before, 'campaign');
  const body = bodyOf<Record<string, unknown>>(req);
  // Ownership, creator and timestamps are never accepted from the client.
  for (const forbiddenKey of ['createdById', 'createdBy', 'created_by', 'updatedById', 'id']) delete body[forbiddenKey];
  if (body.reference !== undefined && String(body.reference).trim() !== before.reference) {
    throw badRequest('The campaign reference is stable and cannot be changed.', { field: 'reference' });
  }
  const checked = checkCampaignInput(body, true);
  if ('errors' in checked) {
    const [field, message] = Object.entries(checked.errors)[0];
    throw badRequest(message!, { field });
  }
  const v = checked.value;
  delete v.reference;
  const start = v.startDate ?? before.startDate;
  const end = v.endDate ?? before.endDate;
  if (end < start) throw badRequest('The end date cannot be before the start date.', { field: 'endDate' });
  await validateReferences(v);

  if (v.currency && v.currency !== before.currency) {
    const [row] = await query<RowDataPacket>('SELECT COUNT(*) AS n FROM ads_daily_records WHERE campaign_id = ?', [before.id]);
    if (Number(row.n) > 0) throw conflict('The currency cannot change once daily records exist — their amounts were entered in the current currency.', { field: 'currency' });
  }
  let reason: string | undefined;
  if (v.status === 'Archived' && before.status !== 'Archived') reason = requireReason(body, 'Archiving');
  if (before.status === 'Archived' && v.status && v.status !== 'Archived') throw badRequest('Use Restore to bring an archived campaign back.', { field: 'status' });

  const changes = Object.entries(v)
    .filter(([k, val]) => String((before as unknown as Record<string, unknown>)[k] ?? '') !== String(val ?? ''))
    .map(([field, to]) => ({ field, from: (before as unknown as Record<string, unknown>)[field] ?? null, to: to ?? null }));
  const actor = actorOf(req);
  await tx(async (conn) => {
    const sets = changes.map((c) => `${CAMPAIGN_COLUMNS[c.field]} = ?`);
    if (sets.length) {
      const extra = v.status === 'Archived' && before.status !== 'Archived' ? ', status_before_archive = ?' : '';
      await execute(
        `UPDATE ads_campaigns SET ${sets.join(', ')}${extra}, updated_by = ?, updated_at = ? WHERE id = ?`,
        [...changes.map((c) => c.to), ...(extra ? [before.status] : []), actor.id, new Date(), before.id],
        conn,
      );
    }
    if (v.status && v.status !== before.status) await logStatus(conn, before.id, v.status, actor.id);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Ads Campaign', recordId: before.id, recordLabel: `${before.reference} — ${before.name}`,
        action: v.status === 'Archived' ? 'archive' : v.status && v.status !== before.status ? 'status-change' : 'update',
        reason: reason ?? (sanitizeText(body.reason, 500) || 'Campaign updated'), changes,
      });
    }
  });
  res.json(await loadCampaign(before.id));
}));

campaignsRouter.post('/campaigns/:id/restore', asyncHandler(async (req, res) => {
  const before = await campaignOr404(String(req.params.id));
  assertOwner(req, before, 'campaign');
  if (before.status !== 'Archived') throw badRequest('This campaign is not archived.');
  const reason = requireReason(bodyOf<{ reason?: unknown }>(req), 'Restoring');
  const row = await queryOne<RowDataPacket>('SELECT status_before_archive FROM ads_campaigns WHERE id = ?', [before.id]);
  const status = ((row?.status_before_archive as CampaignStatus | null) ?? 'Paused') as CampaignStatus;
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('UPDATE ads_campaigns SET status = ?, status_before_archive = NULL, updated_by = ?, updated_at = ? WHERE id = ?', [status, actor.id, new Date(), before.id], conn);
    await logStatus(conn, before.id, status, actor.id);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: before.id, recordLabel: `${before.reference} — ${before.name}`, action: 'status-change', reason, changes: [{ field: 'status', from: 'Archived', to: status }] });
  });
  res.json(await loadCampaign(before.id));
}));

/** Deleting is for mistakes: only a campaign with nothing recorded against it. */
campaignsRouter.delete('/campaigns/:id', asyncHandler(async (req, res) => {
  const before = await campaignOr404(String(req.params.id));
  assertOwner(req, before, 'campaign');
  const reason = requireReason(bodyOf<{ reason?: unknown }>(req), 'Deleting');
  const [row] = await query<RowDataPacket>(
    `SELECT (SELECT COUNT(*) FROM ads_daily_records WHERE campaign_id = ?) AS records,
            (SELECT COUNT(*) FROM ads_creatives WHERE campaign_id = ?) AS creatives,
            (SELECT COUNT(*) FROM ads_references WHERE campaign_id = ?) AS refs,
            (SELECT COUNT(*) FROM ads_followups WHERE campaign_id = ?) AS followups`,
    [before.id, before.id, before.id, before.id],
  );
  if (Number(row.records) + Number(row.creatives) + Number(row.refs) + Number(row.followups) > 0) {
    throw conflict('This campaign has records, files or follow-ups. Archive it instead — its history is kept.');
  }
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('DELETE FROM ads_campaigns WHERE id = ?', [before.id], conn);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: before.id, recordLabel: `${before.reference} — ${before.name}`, action: 'delete', reason });
  });
  res.json({ deleted: before.id });
}));

/* ── Daily records ─────────────────────────────────────────────── */

const countColumns = COUNT_FIELDS.map((f) => COUNT_COLUMNS[f]);

campaignsRouter.post('/campaigns/:id/records', asyncHandler(async (req, res) => {
  const campaign = await campaignOr404(String(req.params.id));
  if (!mayAddToCampaign(person(req), campaign)) throw forbidden('Only the campaign creator or the System Owner can add daily records.');
  if (campaign.status === 'Archived') throw badRequest('Restore the campaign before adding records.');
  const checked = checkDailyInput(bodyOf<Record<string, unknown>>(req));
  if ('errors' in checked) {
    const [field, message] = Object.entries(checked.errors)[0];
    throw badRequest(message, { field });
  }
  const v = checked.value;
  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('ADR', conn);
    const now = new Date();
    await execute(
      `INSERT INTO ads_daily_records (id, campaign_id, report_date, amount_spent, ${countColumns.join(', ')}, notes, created_by, created_at, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ${countColumns.map(() => '?').join(', ')}, ?, ?, ?, ?, ?)`,
      [id, campaign.id, v.reportDate, v.amountSpent, ...COUNT_FIELDS.map((f) => v[f] ?? null), v.notes ?? '', actor.id, now, actor.id, now],
      conn,
    );
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: campaign.id, recordLabel: `${campaign.reference} — ${campaign.name}`, action: 'create', reason: `Daily record ${v.reportDate} added` });
    return queryOne<RowDataPacket>('SELECT d.*, u.name AS creator_name FROM ads_daily_records d JOIN users u ON u.id = d.created_by WHERE d.id = ?', [id], conn);
  }).catch((error) => {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw conflict(`A daily record for ${v.reportDate} already exists on this campaign. Edit that record instead.`, { field: 'reportDate' });
    throw error;
  });
  res.status(201).json({ record: mapDaily(record!), warnings: checked.warnings });
}));

async function recordOr404(id: string) {
  const row = await queryOne<RowDataPacket>('SELECT d.*, u.name AS creator_name FROM ads_daily_records d JOIN users u ON u.id = d.created_by WHERE d.id = ?', [id]);
  if (!row) throw notFound('Daily record not found.');
  const record = mapDaily(row);
  const campaign = (await loadCampaign(record.campaignId))!;
  return { record, campaign };
}

campaignsRouter.patch('/records/:id', asyncHandler(async (req, res) => {
  const { record, campaign } = await recordOr404(String(req.params.id));
  if (!mayModifyChild(person(req), campaign, record)) throw forbidden('Only the person who entered this daily record or the System Owner can change it.');
  const body = bodyOf<Record<string, unknown>>(req);
  if (body.reportDate !== undefined && body.reportDate !== record.reportDate) throw badRequest('The report date cannot change; delete this record and add one for the right date.', { field: 'reportDate' });
  const checked = checkDailyInput(body, { partial: true });
  if ('errors' in checked) {
    const [field, message] = Object.entries(checked.errors)[0];
    throw badRequest(message, { field });
  }
  const v = checked.value;
  const fields = ['amountSpent', ...COUNT_FIELDS, 'notes'].filter((f) => (v as Record<string, unknown>)[f] !== undefined);
  const column = (f: string) => (f === 'amountSpent' ? 'amount_spent' : f === 'notes' ? 'notes' : COUNT_COLUMNS[f as keyof typeof COUNT_COLUMNS]);
  const changes = fields
    .filter((f) => String((record as unknown as Record<string, unknown>)[f] ?? '') !== String((v as Record<string, unknown>)[f] ?? ''))
    .map((f) => ({ field: f, from: (record as unknown as Record<string, unknown>)[f] ?? null, to: (v as Record<string, unknown>)[f] ?? null }));
  const actor = actorOf(req);
  if (changes.length) {
    await tx(async (conn) => {
      await execute(
        `UPDATE ads_daily_records SET ${changes.map((c) => `${column(c.field)} = ?`).join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`,
        [...changes.map((c) => c.to), actor.id, new Date(), record.id], conn,
      );
      await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: campaign.id, recordLabel: `${campaign.reference} — ${campaign.name}`, action: 'update', reason: `Daily record ${record.reportDate} changed`, changes });
    });
  }
  res.json({ record: (await recordOr404(record.id)).record, warnings: checked.warnings });
}));

campaignsRouter.delete('/records/:id', asyncHandler(async (req, res) => {
  const { record, campaign } = await recordOr404(String(req.params.id));
  if (!mayModifyChild(person(req), campaign, record)) throw forbidden('Only the person who entered this daily record or the System Owner can delete it.');
  const reason = requireReason(bodyOf<{ reason?: unknown }>(req), 'Deleting a daily record');
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('UPDATE ads_references SET daily_record_id = NULL WHERE daily_record_id = ?', [record.id], conn);
    await execute('DELETE FROM ads_daily_records WHERE id = ?', [record.id], conn);
    await recordAudit(conn, {
      actor, recordType: 'Ads Campaign', recordId: campaign.id, recordLabel: `${campaign.reference} — ${campaign.name}`, action: 'delete', reason,
      changes: [{ field: 'dailyRecord', from: record.reportDate, to: null }],
    });
  });
  res.json({ deleted: record.id });
}));

/* ── Follow-ups ────────────────────────────────────────────────── */

function checkFollowUp(body: Record<string, unknown>) {
  const note = sanitizeText(body.note, 4000);
  const recommendation = sanitizeText(body.recommendation, 4000);
  if (body.note !== undefined && !note && !recommendation) throw badRequest('Write a note or a recommendation.', { field: 'note' });
  if (body.dueDate && !isIsoDate(body.dueDate)) throw badRequest('Use a date in YYYY-MM-DD.', { field: 'dueDate' });
  return { note, recommendation, ownerUserId: String(body.ownerUserId ?? '').trim() || null, dueDate: (body.dueDate as string) || null };
}

campaignsRouter.post('/campaigns/:id/followups', asyncHandler(async (req, res) => {
  const campaign = await campaignOr404(String(req.params.id));
  if (!mayAddToCampaign(person(req), campaign)) throw forbidden('Only the campaign creator or the System Owner can add follow-ups.');
  const f = checkFollowUp({ note: '', ...bodyOf<Record<string, unknown>>(req) });
  await assertExists('users', f.ownerUserId, 'ownerUserId', 'That follow-up owner');
  const actor = actorOf(req);
  await tx(async (conn) => {
    const id = await nextId('ADU', conn);
    const now = new Date();
    await execute('INSERT INTO ads_followups (id, campaign_id, note, recommendation, owner_user_id, due_date, completed, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)',
      [id, campaign.id, f.note, f.recommendation, f.ownerUserId, f.dueDate, actor.id, now, now], conn);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: campaign.id, recordLabel: `${campaign.reference} — ${campaign.name}`, action: 'update', reason: 'Follow-up added' });
  });
  res.status(201).json(await loadFollowUps([campaign.id]));
}));

async function followUpOr404(id: string) {
  const row = await queryOne<RowDataPacket>('SELECT id, campaign_id, created_by FROM ads_followups WHERE id = ?', [id]);
  if (!row) throw notFound('Follow-up not found.');
  return { id: String(row.id), createdById: String(row.created_by), campaign: (await loadCampaign(String(row.campaign_id)))! };
}

campaignsRouter.patch('/followups/:id', asyncHandler(async (req, res) => {
  const fu = await followUpOr404(String(req.params.id));
  // Being the follow-up's owner grants nothing: only its creator or the System Owner edit it.
  if (!mayModifyChild(person(req), fu.campaign, fu)) throw forbidden('Only the person who wrote this follow-up or the System Owner can change it.');
  const body = bodyOf<Record<string, unknown>>(req);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.note !== undefined || body.recommendation !== undefined) {
    const f = checkFollowUp({ note: body.note ?? '', recommendation: body.recommendation ?? '', ownerUserId: body.ownerUserId, dueDate: body.dueDate });
    sets.push('note = ?', 'recommendation = ?'); params.push(f.note, f.recommendation);
  }
  if (body.ownerUserId !== undefined) {
    const owner = String(body.ownerUserId ?? '').trim() || null;
    await assertExists('users', owner, 'ownerUserId', 'That follow-up owner');
    sets.push('owner_user_id = ?'); params.push(owner);
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate && !isIsoDate(body.dueDate)) throw badRequest('Use a date in YYYY-MM-DD.', { field: 'dueDate' });
    sets.push('due_date = ?'); params.push(body.dueDate || null);
  }
  if (body.completed !== undefined) { sets.push('completed = ?', 'completed_at = ?'); params.push(body.completed ? 1 : 0, body.completed ? new Date() : null); }
  if (sets.length) await execute(`UPDATE ads_followups SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, new Date(), fu.id]);
  res.json(await loadFollowUps([fu.campaign.id]));
}));

campaignsRouter.delete('/followups/:id', asyncHandler(async (req, res) => {
  const fu = await followUpOr404(String(req.params.id));
  if (!mayModifyChild(person(req), fu.campaign, fu)) throw forbidden('Only the person who wrote this follow-up or the System Owner can delete it.');
  const reason = requireReason(bodyOf<{ reason?: unknown }>(req), 'Deleting a follow-up');
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('DELETE FROM ads_followups WHERE id = ?', [fu.id], conn);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: fu.campaign.id, recordLabel: `${fu.campaign.reference} — ${fu.campaign.name}`, action: 'delete', reason, changes: [{ field: 'followUp', from: fu.id, to: null }] });
  });
  res.json({ deleted: fu.id });
}));

/* ── Overview ──────────────────────────────────────────────────── */

campaignsRouter.get('/overview', asyncHandler(async (_req, res) => {
  const campaigns = await queryCampaigns("WHERE c.status <> 'Archived'", [], 'ORDER BY c.end_date', 'LIMIT 2000');
  const ids = campaigns.map((c) => c.id);
  const [records, history, followUps, settings] = await Promise.all([loadRecords(ids), loadStatusHistory(ids), loadFollowUps(ids), loadSettings()]);
  const byCampaign = (c: Campaign) => records.filter((r) => r.campaignId === c.id);

  const spendByCurrency = CURRENCY_CODES.map((currency) => {
    const inCurrency = campaigns.filter((c) => c.currency === currency);
    const m = computeMetrics(aggregate(records.filter((r) => inCurrency.some((c) => c.id === r.campaignId))));
    return { currency, campaigns: inCurrency.length, spend: m.spend === null ? null : unitsToDecimal(m.spend) };
  }).filter((g) => g.campaigns > 0);

  // Objective-relevant costs, pooled from summed inputs within one objective and one currency.
  const objectiveCosts = OBJECTIVES.flatMap((objective) => CURRENCY_CODES.map((currency) => {
    const group = campaigns.filter((c) => c.objective === objective && c.currency === currency);
    if (!group.length) return null;
    const m = computeMetrics(aggregate(records.filter((r) => group.some((c) => c.id === r.campaignId))));
    const result = primaryResult(objective, m);
    return { objective, currency, campaigns: group.length, resultLabel: result.label, result: result.value, costLabel: result.costLabel, cost: result.cost };
  }).filter(Boolean));

  const perCampaign = campaigns.map((c) => {
    const own = byCampaign(c);
    const statusHistory = history.get(c.id) ?? [];
    const metric = TREND_METRICS.find((t) => t.key === TREND_KEY[c.objective])!;
    const windows = trendWindows('last7', todayIn(c.reportingTimezone));
    const trend = 'error' in windows ? null : compareTrend(own, metric, windows, settings.stablePct);
    const m = computeMetrics(aggregate(own), c.budget);
    return {
      id: c.id, reference: c.reference, name: c.name, status: c.status, objective: c.objective, currency: c.currency, endDate: c.endDate,
      interactions: m.interactions, interactionsComplete: m.interactionsComplete, recordCount: own.length,
      trend: trend ? { metric: metric.label, ...trend } : null,
      alerts: campaignAlerts(c, own, statusHistory, settings),
    };
  });

  const complete = perCampaign.filter((c) => c.recordCount > 0 && c.interactionsComplete);
  res.json({
    activeCampaigns: campaigns.filter((c) => c.status === 'Active').length,
    campaignsTracked: campaigns.length,
    spendByCurrency,
    engagement: {
      interactions: complete.reduce((s, c) => s + (c.interactions ?? 0), 0),
      completeCampaigns: complete.length,
      incompleteCampaigns: perCampaign.filter((c) => c.recordCount > 0 && !c.interactionsComplete).length,
    },
    objectiveCosts,
    campaigns: perCampaign,
    followUpsOpen: followUps.filter((f) => !f.completed),
    settings,
  });
}));

/* ── Compare ───────────────────────────────────────────────────── */

campaignsRouter.get('/compare', asyncHandler(async (req, res) => {
  const ids = String(req.query.ids ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  if (ids.length < 2) throw badRequest('Choose at least two campaigns to compare.');
  const campaigns = await queryCampaigns(`WHERE c.id IN (${ids.map(() => '?').join(',')})`, ids, 'ORDER BY c.start_date', '');
  if (campaigns.length !== ids.length) throw notFound('One of those campaigns was not found.');
  if (new Set(campaigns.map((c) => c.objective)).size > 1) throw badRequest('Compare campaigns with the same objective — their results are measured differently.');
  if (new Set(campaigns.map((c) => c.currency)).size > 1) throw badRequest('Compare campaigns in the same currency — amounts in different currencies are never compared without conversion.');
  res.json({ campaigns, records: await loadRecords(ids) });
}));

/* ── Settings ──────────────────────────────────────────────────── */

campaignsRouter.get('/settings', asyncHandler(async (_req, res) => { res.json(await loadSettings()); }));

campaignsRouter.patch('/settings', asyncHandler(async (req, res) => {
  if (!isSystemOwner(person(req))) throw forbidden('Only the System Owner can change alert thresholds.');
  const body = bodyOf<Record<string, unknown>>(req);
  const fields: [string, string, number, number][] = [
    ['stablePct', 'stable_pct', 0, 100], ['budgetWarningPct', 'budget_warning_pct', 1, 100], ['endingSoonDays', 'ending_soon_days', 1, 90],
    ['risingCostPct', 'rising_cost_pct', 1, 1000], ['decliningEngagementPct', 'declining_engagement_pct', 1, 100],
  ];
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, column, min, max] of fields) {
    if (body[key] === undefined) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${key} must be between ${min} and ${max}.`, { field: key });
    sets.push(`${column} = ?`); params.push(n);
  }
  if (sets.length) await execute(`UPDATE ads_settings SET ${sets.join(', ')}, updated_by = ?, updated_at = ? WHERE id = 1`, [...params, req.user!.id, new Date()]);
  res.json(await loadSettings());
}));
