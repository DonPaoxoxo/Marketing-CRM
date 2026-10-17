/** Daily manual accessibility checks — entirely separate from the Enabled
 *  switch and the next-rotation reminder date; recording one never resets
 *  the others (see migration 019). No reason is required: a daily check is
 *  high-frequency and already attributed (who, when). */

import { Router } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DOMAIN_ACCESSIBILITY_STATUS, type DomainAccessibilityStatus } from '../../../src/lib/types';
import { sanitizeText } from '../../../src/lib/sanitize';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { requirePermission } from '../../auth/middleware';
import { asyncHandler, badRequest, notFound } from '../../http/errors';
import { mapDomainCheckLog } from '../../repositories/mappers';
import { readDomainMonitor } from '../../repositories/records';
import { actorOf, bodyOf, nowDate, today } from '../helpers';

export const domainChecksRouter = Router();

function readStatus(value: unknown): DomainAccessibilityStatus {
  const status = typeof value === 'string' ? value : '';
  if (!(DOMAIN_ACCESSIBILITY_STATUS as readonly string[]).includes(status)) {
    throw badRequest('Choose Accessible, Inaccessible, Intermittent or Not Checked.', { field: 'accessibilityStatus' });
  }
  return status as DomainAccessibilityStatus;
}

/** Writes one domain's check for today, inside the caller's transaction, and
 *  updates the monitor's own denormalised cache. Upserts on (domain, date):
 *  recording a second check the same day replaces the first, it never
 *  duplicates — so correcting a mis-click costs nothing. */
async function writeCheck(
  conn: PoolConnection,
  domainMonitorId: string,
  status: DomainAccessibilityStatus,
  notes: string,
  checkedById: string,
): Promise<void> {
  const checkDate = today();
  const now = nowDate();
  const existing = await queryOne<RowDataPacket>(
    'SELECT id FROM domain_check_logs WHERE domain_monitor_id = ? AND check_date = ?',
    [domainMonitorId, checkDate],
    conn,
  );
  if (existing) {
    await execute(
      'UPDATE domain_check_logs SET accessibility_status = ?, checked_by_id = ?, notes = ?, updated_at = ? WHERE id = ?',
      [status, checkedById, notes, now, existing.id],
      conn,
    );
  } else {
    const id = await nextId('DCL', conn);
    await execute(
      `INSERT INTO domain_check_logs (id, domain_monitor_id, check_date, accessibility_status, checked_by_id, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, domainMonitorId, checkDate, status, checkedById, notes, now, now],
      conn,
    );
  }
  await execute(
    'UPDATE domain_monitors SET last_accessibility_status = ?, last_checked_date = ?, last_checked_by_id = ?, updated_at = ? WHERE id = ?',
    [status, checkDate, checkedById, now, domainMonitorId],
    conn,
  );
}

domainChecksRouter.post('/:id/checks', requirePermission('record:domain-checks'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const monitor = await readDomainMonitor(id);
  if (!monitor) throw notFound('Domain not found.');

  const body = bodyOf<{ accessibilityStatus?: unknown; notes?: unknown }>(req);
  const status = readStatus(body.accessibilityStatus);
  const notes = sanitizeText(body.notes, 600);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    await writeCheck(conn, id, status, notes, actor.id);
    return readDomainMonitor(id, conn);
  });

  res.json(record);
}));

domainChecksRouter.post('/bulk-checks', requirePermission('record:domain-checks'), asyncHandler(async (req, res) => {
  const body = bodyOf<{ domainMonitorIds?: unknown; accessibilityStatus?: unknown; notes?: unknown }>(req);
  const ids = Array.isArray(body.domainMonitorIds) ? body.domainMonitorIds.map(String) : [];
  if (!ids.length) throw badRequest('No domains were selected.');
  const status = readStatus(body.accessibilityStatus);
  const notes = sanitizeText(body.notes, 600);
  const actor = actorOf(req);

  const { updated, skipped } = await tx(async (conn) => {
    let count = 0;
    const missing: string[] = [];
    for (const domainId of ids) {
      const monitor = await readDomainMonitor(domainId, conn);
      if (!monitor) { missing.push(domainId); continue; }
      await writeCheck(conn, domainId, status, notes, actor.id);
      count++;
    }
    return { updated: count, skipped: missing };
  });

  res.json({ updated, skipped: skipped.length, problems: skipped.map((domainId) => ({ domainId, reason: 'Not found.' })) });
}));

/** Across every domain — backs the "Daily Monitoring History" export scope,
 *  the one scope that cannot be a pure client-side transform of the bootstrap
 *  payload, since check logs are deliberately not part of it (unbounded
 *  growth — one row per domain per day). */
domainChecksRouter.get('/checks', requirePermission('access:domain-monitoring'), asyncHandler(async (req, res) => {
  const { from, to } = req.query as { from?: string; to?: string };
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (from) { conditions.push('check_date >= ?'); params.push(from); }
  if (to) { conditions.push('check_date <= ?'); params.push(to); }

  const rows = await query<RowDataPacket>(
    `SELECT * FROM domain_check_logs ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY check_date DESC`,
    params,
  );
  res.json(rows.map(mapDomainCheckLog));
}));

domainChecksRouter.get('/:id/checks', requirePermission('access:domain-monitoring'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const monitor = await readDomainMonitor(id);
  if (!monitor) throw notFound('Domain not found.');

  const { from, to } = req.query as { from?: string; to?: string };
  const conditions = ['domain_monitor_id = ?'];
  const params: unknown[] = [id];
  if (from) { conditions.push('check_date >= ?'); params.push(from); }
  if (to) { conditions.push('check_date <= ?'); params.push(to); }

  const rows = await query<RowDataPacket>(
    `SELECT * FROM domain_check_logs WHERE ${conditions.join(' AND ')} ORDER BY check_date DESC`,
    params,
  );
  res.json(rows.map(mapDomainCheckLog));
}));
