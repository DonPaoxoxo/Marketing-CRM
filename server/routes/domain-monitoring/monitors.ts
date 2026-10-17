/** Domain monitors: a different pool of domains than the Domains register
 *  (see server/routes/domains.ts) — tracked for daily manual accessibility,
 *  a manual Enabled/Disabled switch, and a manually-set next-rotation
 *  reminder date. See migration 019. */

import { Router } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { DomainMonitorRecord, DomainMonitorType } from '../../../src/lib/types';
import { DOMAIN_MONITOR_FIELDS, sanitizeFields, sanitizeText } from '../../../src/lib/sanitize';
import { normalizeDomain } from '../../../src/lib/utils';
import { validateDomainLines } from '../../../src/lib/domain-monitor-import';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { requirePermission } from '../../auth/middleware';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../../http/errors';
import { hasPermission } from '../../../src/lib/permissions';
import { isAdmin } from '../../../src/lib/access';
import {
  DOMAIN_MONITOR_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readDomainMonitor,
} from '../../repositories/records';
import { actorOf, assertMayArchive, bodyOf, isDuplicateKey, nowDate, today } from '../helpers';

export const domainMonitorsRouter = Router();

type MonitorBody = Partial<DomainMonitorRecord> & { reason?: string };

/** Unique per domain_type, archived rows included — a name the team retired
 *  is still the same name if it comes back. Free Cash and Invite are two
 *  different uses of a domain, so the same name may exist once in each. */
async function nameTaken(domainName: string, domainType: string, exceptId?: string): Promise<string | null> {
  const sql = `SELECT id FROM domain_monitors WHERE domain_name = ? AND domain_type = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`;
  const row = await queryOne<RowDataPacket>(sql, exceptId ? [domainName, domainType, exceptId] : [domainName, domainType]);
  return row ? String(row.id) : null;
}

domainMonitorsRouter.post('/', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<MonitorBody>(req), DOMAIN_MONITOR_FIELDS);
  const domainType = body.domainType;
  if (domainType !== 'Free Cash' && domainType !== 'Invite') {
    throw badRequest('Choose Free Cash or Invite Domain.', { field: 'domainType' });
  }
  const domainName = normalizeDomain(body.domainName ?? '');
  if (!domainName) throw badRequest('A domain URL is required.', { field: 'domainName' });

  const taken = await nameTaken(domainName, domainType);
  if (taken) throw conflict(`${domainName} is already a ${domainType} Domain.`, { field: 'domainName', conflictId: taken });

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('DMN', conn);
    const now = nowDate();
    const values = {
      domainType,
      domainName,
      enabled: true,
      enabledDate: today(),
      lastAccessibilityStatus: 'Not Checked',
      lastCheckedDate: null,
      notes: body.notes ?? '',
      archived: false,
    };
    const insert = buildInsert('domain_monitors', DOMAIN_MONITOR_COLUMNS, values, { id, created_at: now, updated_at: now });
    await execute(insert.sql, insert.params, conn);

    await recordAudit(conn, {
      actor, recordType: 'Domain Monitor', recordId: id, recordLabel: domainName, action: 'create',
      reason: body.reason ?? `${domainType} Domain added`,
      changes: [{ field: 'domainName', from: null, to: domainName }, { field: 'domainType', from: null, to: domainType }],
    });
    return readDomainMonitor(id, conn);
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict(`${domainName} is already in the register.`, { field: 'domainName' });
    throw error;
  });

  res.status(201).json(record);
}));

domainMonitorsRouter.patch('/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readDomainMonitor(id);
  if (!before) throw notFound('Domain not found.');

  const body = sanitizeFields(bodyOf<MonitorBody>(req), DOMAIN_MONITOR_FIELDS);
  if (body.domainName !== undefined) {
    body.domainName = normalizeDomain(body.domainName);
    if (!body.domainName) throw badRequest('A domain URL is required.', { field: 'domainName' });
    const effectiveType = body.domainType ?? before.domainType;
    const taken = await nameTaken(body.domainName, effectiveType, id);
    if (taken) throw conflict(`${body.domainName} is already a ${effectiveType} Domain.`, { field: 'domainName', conflictId: taken });
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, DOMAIN_MONITOR_COLUMNS) as Record<string, unknown>;

  // Re-enabling bumps the date; disabling leaves it as the last time this
  // domain went live, rather than clearing it.
  if (patch.enabled === true && !before.enabled) {
    patch.enabledDate = today();
  }

  assertMayArchive(req, patch, reason);
  const restoring = patch.archived === false && before.archived;
  if (restoring) {
    if (!hasPermission(req.user, 'archive:records')) throw forbidden(`Your role (${req.user!.role}) cannot restore records.`);
    if (!reason?.trim()) throw badRequest('Restoring needs a written reason.', { field: 'reason' });
  }

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('domain_monitors', DOMAIN_MONITOR_COLUMNS, patch, id, { updated_at: nowDate() });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Domain Monitor', recordId: id, recordLabel: body.domainName ?? before.domainName,
        action: changes.some((c) => c.field === 'enabled') ? 'status-change' : restoring ? 'restore' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Domain monitor updated',
        changes,
      });
    }
    return readDomainMonitor(id, conn);
  });

  res.json(record);
}));

/** Many domains at once, pasted one per line — see src/lib/domain-monitor-import.ts.
 *  Category and notes are chosen once for the whole paste; a domain already in
 *  the register, or repeated in the paste, is skipped and named, never
 *  overwritten — the same rule a re-paste of the same list relies on to be
 *  harmless. */
domainMonitorsRouter.post('/bulk', requirePermission('import:records'), asyncHandler(async (req, res) => {
  const body = bodyOf<{ domainType?: unknown; lines?: unknown; notes?: unknown; reason?: unknown }>(req);
  const domainType = body.domainType;
  if (domainType !== 'Free Cash' && domainType !== 'Invite') {
    throw badRequest('Choose Free Cash or Invite Domain.', { field: 'domainType' });
  }
  const lines = Array.isArray(body.lines) ? body.lines.map(String) : [];
  if (!lines.length) throw badRequest('No domains were submitted.');
  if (lines.length > 5000) throw badRequest('A bulk add is limited to 5,000 domains. Split the list and run it again.');
  const notes = sanitizeText(body.notes, 600);
  const actor = actorOf(req);

  const result = await tx(async (conn: PoolConnection) => {
    // Scoped to this domainType — the same name may already exist as the
    // other category without conflicting (uniqueness is per domain_type).
    const existingRows = await query<RowDataPacket>('SELECT domain_name FROM domain_monitors WHERE domain_type = ?', [domainType], conn);
    const existing = new Set(existingRows.map((r) => String(r.domain_name)));

    let created = 0;
    const problems: { line: number; reason: string }[] = [];
    for (const { line, domainName, problem } of validateDomainLines(lines, existing)) {
      if (!domainName) { problems.push({ line, reason: problem ?? 'Not a valid domain.' }); continue; }
      const id = await nextId('DMN', conn);
      const now = nowDate();
      const values = {
        domainType: domainType as DomainMonitorType,
        domainName,
        enabled: true,
        enabledDate: today(),
        lastAccessibilityStatus: 'Not Checked',
        lastCheckedDate: null,
        notes,
        archived: false,
      };
      const insert = buildInsert('domain_monitors', DOMAIN_MONITOR_COLUMNS, values, { id, created_at: now, updated_at: now });
      await execute(insert.sql, insert.params, conn);
      existing.add(domainName);
      created++;
    }

    await recordAudit(conn, {
      actor, recordType: 'Import', recordId: 'domain-monitoring', recordLabel: `${domainType} Domains bulk add`,
      action: 'import',
      reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason : 'Bulk add committed',
      changes: [{ field: 'rowsCreated', from: null, to: created }, { field: 'rowsSubmitted', from: null, to: lines.length }],
    });

    return { created, problems };
  });

  res.json({ created: result.created, skipped: lines.length - result.created, problems: result.problems.slice(0, 200) });
}));

/** Permanent delete, System Administrator only — same exception the project
 *  makes for Data Leads' scraped-junk cleanup. Everything else in this module
 *  only archives; a deleted domain's check history goes with it (ON DELETE
 *  CASCADE, migration 019). */
domainMonitorsRouter.delete('/:id', requirePermission('access:domain-monitoring'), asyncHandler(async (req, res) => {
  if (!isAdmin(req.user?.role)) throw forbidden('Only the System Administrator can delete domains.');
  const id = String(req.params.id);
  const before = await readDomainMonitor(id);
  if (!before) throw notFound('Domain not found.');

  const reason = sanitizeText(bodyOf<{ reason?: unknown }>(req).reason, 500);
  if (!reason) throw badRequest('Deleting a domain needs a written reason.', { field: 'reason' });

  const actor = actorOf(req);
  await tx(async (conn) => {
    await execute('DELETE FROM domain_monitors WHERE id = ?', [id], conn);
    await recordAudit(conn, {
      actor, recordType: 'Domain Monitor', recordId: id, recordLabel: before.domainName, action: 'delete', reason,
    });
  });

  res.json({ deleted: id });
}));
