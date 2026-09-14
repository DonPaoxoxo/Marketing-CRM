/** Ads Monitoring files: creatives (exact 1080 × 1350) and reference documents.
 *
 *  Every upload, preview, download and removal is authorised here. Viewing a
 *  file needs a signed-in user who can view the module; changing one needs the
 *  campaign's creator (for new files) or the file's own creator, or the System
 *  Owner. Bytes are checked by their content, stored privately in chunks, and
 *  always served with a locked-down content policy. */

import { Router, type Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { execute, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { asyncHandler, badRequest, forbidden, notFound } from '../../http/errors';
import { actorOf, bodyOf } from '../helpers';
import { checkAdsUrl, isIsoDate, mayAddToCampaign, mayModifyChild } from '../../../src/lib/ads/campaign';
import { CREATIVE_MAX_BYTES, checkCreative, checkReference } from '../../../src/lib/ads/files';
import { REPORT_FILE_LIMITS } from '../../../src/lib/team-reports';
import { sanitizeText } from '../../../src/lib/sanitize';
import { loadCampaign, readChunks, writeChunks } from './data';
import { campaignOr404, headerText, person, rawUpload, requireReason, uploadedBytes } from './shared';

export const adsFilesRouter = Router();

function sendFile(res: Response, data: Buffer, name: string, mime: string, inline: boolean) {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(data);
}

/* ── Creatives ─────────────────────────────────────────────────── */

adsFilesRouter.post('/campaigns/:id/creatives', rawUpload(CREATIVE_MAX_BYTES + 1024), asyncHandler(async (req, res) => {
  const campaign = await campaignOr404(String(req.params.id));
  if (!mayAddToCampaign(person(req), campaign)) throw forbidden('Only the campaign creator or the System Owner can add creatives.');
  const bytes = uploadedBytes(req);
  const creative = checkCreative(headerText(req, 'x-file-name') || 'creative', bytes);
  if ('error' in creative) throw badRequest(creative.error, { field: 'file' });
  const adsUrl = checkAdsUrl(headerText(req, 'x-ads-url'));
  if ('error' in adsUrl) throw badRequest(adsUrl.error, { field: 'adsUrl' });
  const usedFrom = headerText(req, 'x-used-from') || null;
  const usedTo = headerText(req, 'x-used-to') || null;
  if ((usedFrom && !isIsoDate(usedFrom)) || (usedTo && !isIsoDate(usedTo))) throw badRequest('Use dates in YYYY-MM-DD.', { field: 'usedFrom' });
  if (usedFrom && usedTo && usedTo < usedFrom) throw badRequest('"Used to" cannot be before "used from".', { field: 'usedTo' });

  const actor = actorOf(req);
  const id = await tx(async (conn) => {
    const newId = await nextId('ADK', conn);
    await execute(
      `INSERT INTO ads_creatives (id, campaign_id, file_name, mime_type, width, height, size_bytes, ads_url, used_from, used_to, description, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, campaign.id, creative.fileName, creative.mime, creative.width, creative.height, creative.sizeBytes, adsUrl.value, usedFrom, usedTo,
        sanitizeText(headerText(req, 'x-description'), 500), actor.id, new Date()],
      conn,
    );
    await writeChunks(conn, newId, bytes);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: campaign.id, recordLabel: `${campaign.reference} — ${campaign.name}`, action: 'update', reason: 'Creative uploaded', changes: [{ field: 'creative', from: null, to: creative.fileName }] });
    return newId;
  });
  res.status(201).json({ id });
}));

async function creativeOr404(id: string) {
  const row = await queryOne<RowDataPacket>('SELECT * FROM ads_creatives WHERE id = ?', [id]);
  if (!row) throw notFound('Creative not found.');
  return { row, createdById: String(row.created_by), campaign: (await loadCampaign(String(row.campaign_id)))! };
}

adsFilesRouter.get('/creatives/:id/file', asyncHandler(async (req, res) => {
  const { row } = await creativeOr404(String(req.params.id));
  sendFile(res, await readChunks(String(row.id)), String(row.file_name), String(row.mime_type), req.query.download === undefined);
}));

adsFilesRouter.patch('/creatives/:id', asyncHandler(async (req, res) => {
  const c = await creativeOr404(String(req.params.id));
  if (c.row.removed_at) throw notFound('Creative not found.');
  if (!mayModifyChild(person(req), c.campaign, c)) throw forbidden('Only the person who uploaded this creative or the System Owner can change it.');
  const body = bodyOf<Record<string, unknown>>(req);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (body.adsUrl !== undefined) {
    const url = checkAdsUrl(body.adsUrl);
    if ('error' in url) throw badRequest(url.error, { field: 'adsUrl' });
    sets.push('ads_url = ?'); params.push(url.value);
  }
  for (const [key, column] of [['usedFrom', 'used_from'], ['usedTo', 'used_to']] as const) {
    if (body[key] === undefined) continue;
    if (body[key] && !isIsoDate(body[key])) throw badRequest('Use dates in YYYY-MM-DD.', { field: key });
    sets.push(`${column} = ?`); params.push(body[key] || null);
  }
  if (body.description !== undefined) { sets.push('description = ?'); params.push(sanitizeText(body.description, 500)); }
  if (sets.length) await execute(`UPDATE ads_creatives SET ${sets.join(', ')} WHERE id = ?`, [...params, c.row.id]);
  res.json({ id: c.row.id });
}));

adsFilesRouter.delete('/creatives/:id', asyncHandler(async (req, res) => {
  const c = await creativeOr404(String(req.params.id));
  if (!mayModifyChild(person(req), c.campaign, c)) throw forbidden('Only the person who uploaded this creative or the System Owner can remove it.');
  const reason = requireReason(bodyOf<{ reason?: unknown }>(req), 'Removing a creative');
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('UPDATE ads_creatives SET removed_at = ?, removed_by = ? WHERE id = ? AND removed_at IS NULL', [new Date(), actor.id, c.row.id], conn);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: c.campaign.id, recordLabel: `${c.campaign.reference} — ${c.campaign.name}`, action: 'archive', reason, changes: [{ field: 'creative', from: String(c.row.file_name), to: null }] });
  });
  res.json({ removed: c.row.id });
}));

/* ── References ────────────────────────────────────────────────── */

adsFilesRouter.post('/campaigns/:id/references', rawUpload(REPORT_FILE_LIMITS.document + 1024), asyncHandler(async (req, res) => {
  const campaign = await campaignOr404(String(req.params.id));
  if (!mayAddToCampaign(person(req), campaign)) throw forbidden('Only the campaign creator or the System Owner can attach references.');
  const bytes = uploadedBytes(req);
  const file = checkReference(headerText(req, 'x-file-name') || 'file', bytes);
  if ('error' in file) throw badRequest(file.error, { field: 'file' });
  const dailyRecordId = headerText(req, 'x-daily-record-id') || null;
  if (dailyRecordId) {
    const row = await queryOne<RowDataPacket>('SELECT id FROM ads_daily_records WHERE id = ? AND campaign_id = ?', [dailyRecordId, campaign.id]);
    if (!row) throw badRequest('That daily record is not part of this campaign.', { field: 'dailyRecordId' });
  }
  const actor = actorOf(req);
  const id = await tx(async (conn) => {
    const newId = await nextId('ADF', conn);
    await execute(
      `INSERT INTO ads_references (id, campaign_id, daily_record_id, file_name, mime_type, kind, size_bytes, description, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, campaign.id, dailyRecordId, file.fileName, file.mimeType, file.kind, bytes.length, sanitizeText(headerText(req, 'x-description'), 500), actor.id, new Date()],
      conn,
    );
    await writeChunks(conn, newId, bytes);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: campaign.id, recordLabel: `${campaign.reference} — ${campaign.name}`, action: 'update', reason: 'Reference attached', changes: [{ field: 'reference', from: null, to: file.fileName }] });
    return newId;
  });
  res.status(201).json({ id });
}));

async function referenceOr404(id: string) {
  const row = await queryOne<RowDataPacket>('SELECT * FROM ads_references WHERE id = ?', [id]);
  if (!row || row.removed_at) throw notFound('Reference not found.');
  return { row, createdById: String(row.created_by), campaign: (await loadCampaign(String(row.campaign_id)))! };
}

adsFilesRouter.get('/references/:id/file', asyncHandler(async (req, res) => {
  const { row } = await referenceOr404(String(req.params.id));
  // Images and PDFs may preview inline; everything else only downloads.
  const previewable = row.kind === 'image' || row.mime_type === 'application/pdf';
  sendFile(res, await readChunks(String(row.id)), String(row.file_name), String(row.mime_type), previewable && req.query.download === undefined);
}));

adsFilesRouter.delete('/references/:id', asyncHandler(async (req, res) => {
  const f = await referenceOr404(String(req.params.id));
  if (!mayModifyChild(person(req), f.campaign, f)) throw forbidden('Only the person who attached this file or the System Owner can remove it.');
  const reason = requireReason(bodyOf<{ reason?: unknown }>(req), 'Removing a reference');
  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('UPDATE ads_references SET removed_at = ?, removed_by = ? WHERE id = ?', [new Date(), actor.id, f.row.id], conn);
    await recordAudit(conn, { actor, recordType: 'Ads Campaign', recordId: f.campaign.id, recordLabel: `${f.campaign.reference} — ${f.campaign.name}`, action: 'archive', reason, changes: [{ field: 'reference', from: String(f.row.file_name), to: null }] });
  });
  res.json({ removed: f.row.id });
}));
