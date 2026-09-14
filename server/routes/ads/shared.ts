/** Small helpers shared by the Ads Monitoring routes. */

import express, { type Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { HttpError, badRequest, forbidden, notFound } from '../../http/errors';
import { queryOne } from '../../db/pool';
import { mayModifyRecord, type Campaign } from '../../../src/lib/ads/campaign';
import { loadCampaign } from './data';

export const person = (req: Request) => ({ id: req.user!.id, role: req.user!.role });

/** A raw file body with "too large" explained instead of reported as a fault. */
export function rawUpload(limitBytes: number): express.RequestHandler {
  const read = express.raw({ type: () => true, limit: limitBytes });
  return (req, res, next) => read(req, res, (error?: unknown) => {
    if ((error as { type?: string } | undefined)?.type === 'entity.too.large') {
      return next(new HttpError(413, 'That file is too large for this upload.', { field: 'file' }));
    }
    next(error);
  });
}

export const uploadedBytes = (req: Request) => (Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : new Uint8Array());

export function headerText(req: Request, name: string): string {
  const raw = req.headers[name.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return '';
  try { return decodeURIComponent(value); } catch { return value; }
}

/** The campaign, or 404. Viewing is open to every signed-in user. */
export async function campaignOr404(id: string): Promise<Campaign> {
  const campaign = await loadCampaign(id);
  if (!campaign) throw notFound('Campaign not found.');
  return campaign;
}

/** Refuse unless the caller created the record or is the System Owner. */
export function assertOwner(req: Request, record: { createdById: string }, what: string): void {
  if (!mayModifyRecord(person(req), record)) {
    throw forbidden(`Only the person who created this ${what} or the System Owner can change it.`);
  }
}

export function requireReason(body: { reason?: unknown }, action: string): string {
  const reason = String(body.reason ?? '').trim().slice(0, 500);
  if (reason.length < 3) throw badRequest(`${action} needs a written reason.`, { field: 'reason' });
  return reason;
}

/** References must point at rows that exist; nothing is created on the fly. */
export async function assertExists(table: 'platforms' | 'brands' | 'projects' | 'social_accounts' | 'users' | 'countries', id: string | null | undefined, field: string, label: string): Promise<void> {
  if (!id) return;
  const key = table === 'countries' ? 'code' : 'id';
  const row = await queryOne<RowDataPacket>(`SELECT ${key} FROM ${table} WHERE ${key} = ?`, [id]);
  if (!row) throw badRequest(`${label} does not exist.`, { field });
}
