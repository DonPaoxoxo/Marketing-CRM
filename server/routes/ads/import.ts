/** Ads Monitoring Excel import: preview, then an explicit commit.
 *
 *  The server parses the workbook itself (cached cell values only — formulas are
 *  never evaluated, macros never run) and decides every row with the shared rule
 *  in src/lib/ads/import.ts. Commit re-uploads the same file, re-reads the
 *  database inside a transaction, and re-decides every row; if the result differs
 *  from what the person confirmed, nothing is written. Otherwise all confirmed
 *  valid rows are written together, or — on any failure — none are.
 *
 *  Ownership is never read from the file: every campaign and record is created
 *  by the signed-in importer. */

import { Router, type Request } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { readSheet } from 'read-excel-file/node';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { asyncHandler, badRequest, conflict, notFound } from '../../http/errors';
import { actorOf } from '../helpers';
import { pageUrlKey } from '../../../src/lib/identity';
import { safeFileName } from '../../../src/lib/team-reports';
import { IMPORT_LIMITS, analyseImport, type ImportAnalysis, type ImportContext } from '../../../src/lib/ads/import';
import { COUNT_FIELDS } from '../../../src/lib/ads/metrics';
import { CAMPAIGN_COLUMNS, COUNT_COLUMNS, logStatus } from './data';
import { headerText, person, rawUpload, uploadedBytes } from './shared';
import { date, isoRequired, text } from '../../repositories/mappers';

export const adsImportRouter = Router();

const TRACKER_SHEET = 'Daily Tracker';

async function readWorkbook(req: Request): Promise<unknown[][]> {
  const bytes = uploadedBytes(req);
  if (!bytes.length) throw badRequest('Choose an .xlsx file.', { field: 'file' });
  // An .xlsx is a zip package; anything else (an old .xls, a CSV, a renamed file) is refused.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw badRequest('That is not an .xlsx workbook. In Excel choose File → Save As → Excel Workbook (.xlsx).', { field: 'file' });
  }
  const name = headerText(req, 'x-file-name').toLowerCase();
  if (name && !name.endsWith('.xlsx')) throw badRequest('Only .xlsx workbooks can be imported (macro-enabled .xlsm files are refused).', { field: 'file' });
  const buffer = Buffer.from(bytes);
  try {
    return (await readSheet(buffer, TRACKER_SHEET)) as unknown[][];
  } catch {
    try {
      return (await readSheet(buffer)) as unknown[][];
    } catch {
      throw badRequest('That workbook could not be read. Open it in Excel, save it again as .xlsx, and retry.', { field: 'file' });
    }
  }
}

async function loadContext(req: Request, mode: 'skip' | 'update', conn?: PoolConnection, lock = false): Promise<ImportContext> {
  const forUpdate = lock ? ' FOR UPDATE' : '';
  const [campaigns, entries, platforms, brands, accounts, countries] = await Promise.all([
    query<RowDataPacket>(`SELECT * FROM ads_campaigns${forUpdate}`, [], conn),
    query<RowDataPacket>(`SELECT id, campaign_id, report_date, created_by FROM ads_daily_records${forUpdate}`, [], conn),
    query<RowDataPacket>('SELECT id, name FROM platforms', [], conn),
    query<RowDataPacket>('SELECT id, name FROM brands', [], conn),
    query<RowDataPacket>('SELECT id, profile_url FROM social_accounts WHERE archived = 0', [], conn),
    query<RowDataPacket>('SELECT code, name FROM countries', [], conn),
  ]);
  return {
    user: person(req),
    mode,
    campaigns: campaigns.map((c) => ({
      id: String(c.id), reference: text(c.reference), createdById: String(c.created_by), name: text(c.name), platformId: String(c.platform_id),
      brandId: c.brand_id ? String(c.brand_id) : null, socialAccountId: c.social_account_id ? String(c.social_account_id) : null,
      targetCountryCode: text(c.target_country_code), objective: text(c.objective), currency: text(c.currency),
      budget: c.budget === null ? null : String(c.budget), startDate: date(c.start_date)!, endDate: date(c.end_date)!, adsUrl: text(c.ads_url),
    })),
    entries: entries.map((e) => ({ id: String(e.id), campaignId: String(e.campaign_id), reportDate: date(e.report_date)!, createdById: String(e.created_by) })),
    platforms: platforms.map((p) => ({ id: String(p.id), name: text(p.name) })),
    brands: brands.map((b) => ({ id: String(b.id), name: text(b.name) })),
    accounts: accounts.map((a) => ({ id: String(a.id), profileUrlKey: pageUrlKey(text(a.profile_url)) })),
    countries: countries.map((c) => ({ code: String(c.code), name: text(c.name) })),
    urlKey: pageUrlKey,
  };
}

const modeOf = (req: Request): 'skip' | 'update' => (req.query.mode === 'update' ? 'update' : 'skip');

function publicAnalysis(a: ImportAnalysis) {
  return { missingColumns: a.missingColumns, tooManyRows: a.tooManyRows, summary: a.summary, rows: a.rows.map(({ campaign: _c, entry: _e, ...r }) => r) };
}

adsImportRouter.post('/import/preview', rawUpload(IMPORT_LIMITS.maxFileBytes), asyncHandler(async (req, res) => {
  const cells = await readWorkbook(req);
  const analysis = analyseImport(cells, await loadContext(req, modeOf(req)));
  res.json(publicAnalysis(analysis));
}));

adsImportRouter.post('/import/commit', rawUpload(IMPORT_LIMITS.maxFileBytes), asyncHandler(async (req, res) => {
  const cells = await readWorkbook(req);
  const mode = modeOf(req);
  let expected: Record<string, number> = {};
  try { expected = JSON.parse(headerText(req, 'x-expected-summary') || '{}'); } catch { /* compared below */ }
  const fileName = safeFileName(headerText(req, 'x-file-name') || 'import.xlsx');
  const actor = actorOf(req);

  const result = await tx(async (conn) => {
    // Re-read with rows locked, so permissions and duplicates are checked against
    // the data this transaction writes into.
    const analysis = analyseImport(cells, await loadContext(req, mode, conn, true));
    if (analysis.missingColumns.length || analysis.tooManyRows) throw badRequest('The workbook no longer passes validation. Preview it again.');
    const changed = (Object.keys(analysis.summary) as (keyof typeof analysis.summary)[]).some((k) => Number(expected[k]) !== analysis.summary[k]);
    if (changed) {
      throw conflict('The register changed since your preview (or the file differs), so nothing was imported. Preview the file again and confirm the new result.');
    }

    const now = new Date();
    const newCampaignIds = new Map<string, string>();
    let created = 0;
    let updated = 0;
    for (const row of analysis.rows) {
      if (row.action === 'create-campaign') {
        const id = await nextId('ADC', conn);
        const v = row.campaign as Record<string, unknown>;
        const entries = Object.entries(CAMPAIGN_COLUMNS).filter(([k]) => v[k] !== undefined);
        await execute(
          `INSERT INTO ads_campaigns (id, ${entries.map(([, col]) => col).join(', ')}, created_by, created_at, updated_by, updated_at)
           VALUES (?, ${entries.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
          [id, ...entries.map(([k]) => v[k]), actor.id, now, actor.id, now],
          conn,
        );
        await logStatus(conn, id, 'Active', actor.id);
        newCampaignIds.set(row.reference.toLowerCase(), id);
      }
      if (row.action === 'create-campaign' || row.action === 'create-entry') {
        const campaignId = row.campaign?.existingId ?? newCampaignIds.get(row.reference.toLowerCase());
        const e = row.entry!;
        const id = await nextId('ADR', conn);
        await execute(
          `INSERT INTO ads_daily_records (id, campaign_id, report_date, amount_spent, ${COUNT_FIELDS.map((f) => COUNT_COLUMNS[f]).join(', ')}, notes, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ${COUNT_FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?, ?)`,
          [id, campaignId, e.reportDate, e.amountSpent ?? null, ...COUNT_FIELDS.map((f) => e[f] ?? null), e.notes ?? '', actor.id, now, actor.id, now],
          conn,
        );
        created++;
      }
      if (row.action === 'update-entry') {
        const e = row.entry! as Record<string, unknown>;
        const fields = ['amountSpent', ...COUNT_FIELDS, 'notes'].filter((f) => e[f] !== undefined && e[f] !== null && e[f] !== '');
        if (fields.length) {
          const column = (f: string) => (f === 'amountSpent' ? 'amount_spent' : f === 'notes' ? 'notes' : COUNT_COLUMNS[f as keyof typeof COUNT_COLUMNS]);
          await execute(
            `UPDATE ads_daily_records SET ${fields.map((f) => `${column(f)} = ?`).join(', ')}, updated_by = ?, updated_at = ? WHERE id = ?`,
            [...fields.map((f) => e[f]), actor.id, now, row.existingEntryId],
            conn,
          );
        }
        updated++;
      }
    }

    const id = await nextId('ADI', conn);
    const problems = analysis.rows.filter((r) => r.errors.length || r.warnings.length).slice(0, 500)
      .map((r) => ({ row: r.rowNumber, reference: r.reference, reportDate: r.reportDate, action: r.action, errors: r.errors, warnings: r.warnings }));
    await execute(
      `INSERT INTO ads_import_history (id, user_id, user_name, file_name, mode, campaigns_created, created_count, updated_count, skipped_count, rejected_count, errors_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, actor.id, actor.name, fileName, mode, analysis.summary.campaignsToCreate, created, updated, analysis.summary.skipped, analysis.summary.rejected, JSON.stringify(problems), now],
      conn,
    );
    await recordAudit(conn, {
      actor, recordType: 'Ads Import', recordId: id, recordLabel: fileName, action: 'import', reason: `Ads Monitoring import (${mode} existing)`,
      changes: [
        { field: 'campaignsCreated', from: null, to: analysis.summary.campaignsToCreate },
        { field: 'recordsCreated', from: null, to: created },
        { field: 'recordsUpdated', from: null, to: updated },
        { field: 'skipped', from: null, to: analysis.summary.skipped },
        { field: 'rejected', from: null, to: analysis.summary.rejected },
      ],
    });
    return { importId: id, campaignsCreated: analysis.summary.campaignsToCreate, created, updated, skipped: analysis.summary.skipped, rejected: analysis.summary.rejected, rows: publicAnalysis(analysis).rows };
  }).catch((error) => {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw conflict('A record was added by someone else during the import, so nothing was imported. Preview the file again.');
    throw error;
  });
  res.status(201).json(result);
}));

adsImportRouter.get('/imports', asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = 25;
  const [count] = await query<RowDataPacket>('SELECT COUNT(*) AS n FROM ads_import_history');
  const rows = await query<RowDataPacket>(`SELECT id, user_id, user_name, file_name, mode, campaigns_created, created_count, updated_count, skipped_count, rejected_count, created_at FROM ads_import_history ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  res.json({
    total: Number(count.n), page, pageSize,
    items: rows.map((r) => ({
      id: String(r.id), userName: text(r.user_name), fileName: text(r.file_name), mode: text(r.mode), campaignsCreated: Number(r.campaigns_created),
      created: Number(r.created_count), updated: Number(r.updated_count), skipped: Number(r.skipped_count), rejected: Number(r.rejected_count), createdAt: isoRequired(r.created_at),
    })),
  });
}));

adsImportRouter.get('/imports/:id/errors', asyncHandler(async (req, res) => {
  const row = await queryOne<RowDataPacket>('SELECT errors_json FROM ads_import_history WHERE id = ?', [String(req.params.id)]);
  if (!row) throw notFound('Import not found.');
  res.json({ rows: JSON.parse(text(row.errors_json) || '[]') });
}));
