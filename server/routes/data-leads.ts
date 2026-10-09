/** Data Leads register: creators scraped from outreach sheets, and the bulk
 *  upload that fills it. See migration 018 and src/lib/lead-import.ts for the
 *  shape this mirrors — a row the upload preview calls ready is a row this
 *  accepts, for the same stated reason if it is not. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { isAdmin } from '../../src/lib/access';
import { DATA_LEAD_ASSIGNEE, type DataLeadRecord } from '../../src/lib/types';
import { DATA_LEAD_FIELDS, sanitizeFields, sanitizeText } from '../../src/lib/sanitize';
import { leadChannelKey, validateLeadRow, type LeadImportKey } from '../../src/lib/lead-import';
import { execute, query, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, forbidden, notFound } from '../http/errors';
import { hasPermission } from '../../src/lib/permissions';
import {
  DATA_LEAD_COLUMNS, buildUpdate, diffRecords, pick, readDataLead,
} from '../repositories/records';
import { actorOf, bodyOf, nowDate } from './helpers';

export const dataLeadsRouter = Router();

type LeadBody = Partial<DataLeadRecord> & { reason?: string };

/** A ceiling on one upload. The sheet this feature was built for has ~1,900
 *  rows; a much larger one is split rather than held open in one transaction. */
const MAX_ROWS = 5000;

dataLeadsRouter.patch('/:id', requirePermission('access:data-leads'), asyncHandler(async (req, res) => {
  if (!hasPermission(req.user, 'edit:resources')) {
    throw forbidden(`Your role (${req.user!.role}) cannot edit resources.`);
  }
  const id = String(req.params.id);
  const before = await readDataLead(id);
  if (!before) throw notFound('Lead not found.');

  const body = sanitizeFields(bodyOf<LeadBody>(req), DATA_LEAD_FIELDS);
  const { reason, ...rest } = body;
  const patch = pick(rest, DATA_LEAD_COLUMNS) as Record<string, unknown>;

  if (patch.assignedTo !== undefined && patch.assignedTo !== null
    && !(DATA_LEAD_ASSIGNEE as readonly string[]).includes(patch.assignedTo as string)) {
    throw badRequest('Not a recognised person to assign.', { field: 'assignedTo' });
  }

  // Moving out of "Not contacted" stamps who did it and when, the first time
  // only — reopening a lead to "Responded" after it is already past that point
  // must not overwrite the original outreach moment. Moving explicitly back to
  // "Not contacted" clears the stamp, so a mis-click can be undone cleanly.
  if (typeof patch.status === 'string' && patch.status !== before.status) {
    if (patch.status === 'Not contacted') {
      patch.contactedAt = null;
      patch.contactedById = null;
    } else if (before.status === 'Not contacted') {
      patch.contactedAt = nowDate();
      patch.contactedById = actorOf(req).id;
    }
  }

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('data_leads', DATA_LEAD_COLUMNS, patch, id, { updated_at: nowDate() });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Data Lead', recordId: id, recordLabel: before.creator,
        action: changes.some((c) => c.field === 'status') ? 'status-change' : 'update',
        reason: reason ?? 'Lead updated',
        changes,
      });
    }
    return readDataLead(id, conn);
  });

  res.json(record);
}));

/** Permanent. Unlike every other register here, a lead is never archived —
 *  there is no "restore" for a scraped contact — so deleting one is reserved
 *  for the System Administrator and needs a written reason, the same bar
 *  Team Reports' permanent delete sets (server/routes/team-reports.ts). */
dataLeadsRouter.delete('/:id', requirePermission('access:data-leads'), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user?.role)) throw forbidden('Only the System Administrator can delete leads.');
  const id = String(req.params.id);
  const before = await readDataLead(id);
  if (!before) throw notFound('Lead not found.');

  const reason = sanitizeText(bodyOf<{ reason?: unknown }>(req).reason, 500);
  if (!reason) throw badRequest('Deleting a lead needs a written reason.', { field: 'reason' });

  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('DELETE FROM data_leads WHERE id = ?', [id], conn);
    await recordAudit(conn, {
      actor, recordType: 'Data Lead', recordId: id, recordLabel: before.creator, action: 'delete', reason,
    });
  });

  res.json({ deleted: id });
}));

interface ImportBody {
  countryCode?: string;
  platformId?: string;
  niche?: string;
  rows?: Record<string, unknown>[];
  reason?: string;
}

const rawFromRecord = (row: Record<string, unknown>): Partial<Record<LeadImportKey, string>> => ({
  platform: typeof row.platform === 'string' ? row.platform : '',
  creator: typeof row.creator === 'string' ? row.creator : '',
  channelUrl: typeof row.channelUrl === 'string' ? row.channelUrl : '',
  subscribers: typeof row.subscribers === 'string' ? row.subscribers : '',
  tier: typeof row.tier === 'string' ? row.tier : '',
  keyword: typeof row.keyword === 'string' ? row.keyword : '',
  promoConfidence: typeof row.promoConfidence === 'string' ? row.promoConfidence : '',
  evidenceTitle: typeof row.evidenceTitle === 'string' ? row.evidenceTitle : '',
  evidenceUrl: typeof row.evidenceUrl === 'string' ? row.evidenceUrl : '',
  publicEmail: typeof row.publicEmail === 'string' ? row.publicEmail : '',
  publicTelegram: typeof row.publicTelegram === 'string' ? row.publicTelegram : '',
  publicInstagram: typeof row.publicInstagram === 'string' ? row.publicInstagram : '',
  status: typeof row.status === 'string' ? row.status : '',
});

dataLeadsRouter.post('/import', requirePermission('access:data-leads'), asyncHandler(async (req, res) => {
  if (!hasPermission(req.user, 'import:records')) {
    throw forbidden(`Your role (${req.user!.role}) cannot import records in bulk.`);
  }

  const { countryCode, platformId, niche, rows, reason } = bodyOf<ImportBody>(req);
  if (!Array.isArray(rows) || !rows.length) throw badRequest('No rows were submitted.');
  if (rows.length > MAX_ROWS) throw badRequest(`An upload is limited to ${MAX_ROWS} rows. Split the file and run it again.`);

  const actor = actorOf(req);

  const result = await tx(async (conn) => {
    const [countryRow, platformRows, existingRows] = await Promise.all([
      query<RowDataPacket>('SELECT code FROM countries WHERE code = ?', [countryCode], conn),
      query<RowDataPacket>('SELECT id, name, slug FROM platforms', [], conn),
      query<RowDataPacket>('SELECT platform_id, channel_url FROM data_leads WHERE country_code = ?', [countryCode], conn),
    ]);
    if (!countryRow.length) throw badRequest('Choose a country.', { field: 'countryCode' });
    const platforms = platformRows.map((p) => ({ id: String(p.id), name: String(p.name), slug: String(p.slug) }));
    const defaultPlatform = platforms.find((p) => p.id === platformId);
    if (!defaultPlatform) throw badRequest('Choose a platform.', { field: 'platformId' });

    const country = String(countryRow[0].code);
    const niceNiche = sanitizeText(niche, 160);
    const existing = new Set(existingRows.map((r) => leadChannelKey(country, String(r.platform_id), String(r.channel_url))));
    const seen = new Set<string>();

    let created = 0;
    const skipped: { row: number; reason: string }[] = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = Number((row as { rowNumber?: unknown })?.rowNumber) || index + 1;
      if (!row || typeof row !== 'object') { skipped.push({ row: rowNumber, reason: 'Not a row.' }); continue; }

      const { value, problems } = validateLeadRow(rawFromRecord(row as Record<string, unknown>), {
        platforms, defaultPlatformId: defaultPlatform.id, countryCode: country, existing, seen,
      });
      if (!value) {
        skipped.push({ row: rowNumber, reason: problems.map((p) => `${p.column}: ${p.message}`).join(' ') });
        continue;
      }

      const id = await nextId('LED', conn);
      const now = nowDate();
      await execute(
        `INSERT INTO data_leads
           (id, country_code, platform_id, niche, creator, channel_url, follower_count, tier, keyword,
            promo_confidence, evidence_title, evidence_url, public_email, public_telegram, public_instagram,
            status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
        [
          id, country, value.platformId, niceNiche, value.creator, value.channelUrl, value.followerCount,
          value.tier, value.keyword, value.promoConfidence, value.evidenceTitle, value.evidenceUrl,
          value.publicEmail, value.publicTelegram, value.publicInstagram, value.status, now, now,
        ],
        conn,
      );
      seen.add(leadChannelKey(country, value.platformId, value.channelUrl));
      created++;
    }

    await recordAudit(conn, {
      actor, recordType: 'Import', recordId: 'data-leads', recordLabel: `Data Leads upload (${niceNiche || 'uncategorised'})`,
      action: 'import',
      reason: reason ?? 'CSV import committed',
      changes: [
        { field: 'rowsCreated', from: null, to: created },
        { field: 'rowsSubmitted', from: null, to: rows.length },
      ],
    });

    return { created, skipped: skipped.slice(0, 200), skippedCount: rows.length - created };
  });

  res.json({ created: result.created, skipped: result.skippedCount, problems: result.skipped });
}));
