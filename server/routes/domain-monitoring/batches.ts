/** Rotation groups and batches — configuration only. Creating or editing a
 *  batch never sets it Active: that flag changes only through the rotation
 *  endpoints (see rotation.ts), which is what keeps "exactly one Active batch
 *  per group" true. See migration 019. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { RotationBatchRecord, RotationGroupRecord } from '../../../src/lib/types';
import { ROTATION_FIELDS, sanitizeFields } from '../../../src/lib/sanitize';
import { execute, query, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { requirePermission } from '../../auth/middleware';
import { asyncHandler, badRequest, conflict, notFound } from '../../http/errors';
import {
  ROTATION_BATCH_COLUMNS, ROTATION_GROUP_COLUMNS, buildInsert, buildUpdate, diffRecords, pick,
  readRotationBatch, readRotationGroup,
} from '../../repositories/records';
import { actorOf, assertMayArchive, bodyOf, isDuplicateKey, nowDate } from '../helpers';

export const rotationBatchesRouter = Router();
rotationBatchesRouter.use(requirePermission('manage:rotation-batches'));

type GroupBody = Partial<RotationGroupRecord> & { reason?: string };
type BatchBody = Partial<RotationBatchRecord> & { reason?: string };

/* ── Rotation groups ─────────────────────────────────────────────── */

rotationBatchesRouter.post('/groups', asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<GroupBody>(req), ROTATION_FIELDS);
  const name = body.name?.trim();
  if (!name) throw badRequest('A group name is required.', { field: 'name' });

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('RTG', conn);
    const now = nowDate();
    const values = {
      name, notes: body.notes ?? '', rotationIntervalDays: body.rotationIntervalDays ?? 5,
      cycleStartedAt: null, nextRotationDueAt: null, archived: false,
    };
    const insert = buildInsert('rotation_groups', ROTATION_GROUP_COLUMNS, values, { id, created_at: now, updated_at: now });
    await execute(insert.sql, insert.params, conn);
    await recordAudit(conn, {
      actor, recordType: 'Rotation Group', recordId: id, recordLabel: name, action: 'create',
      reason: body.reason ?? 'Rotation group created', changes: [{ field: 'name', from: null, to: name }],
    });
    return readRotationGroup(id, conn);
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict(`${name} is already a rotation group.`, { field: 'name' });
    throw error;
  });

  res.status(201).json(record);
}));

rotationBatchesRouter.patch('/groups/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readRotationGroup(id);
  if (!before) throw notFound('Rotation group not found.');

  const body = sanitizeFields(bodyOf<GroupBody>(req), ROTATION_FIELDS);
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw badRequest('A group name is required.', { field: 'name' });
    body.name = name;
  }
  // The schedule itself (cycleStartedAt / nextRotationDueAt) changes only
  // through a rotation or an explicit override — never a plain edit.
  if (body.cycleStartedAt !== undefined || body.nextRotationDueAt !== undefined) {
    throw badRequest('The rotation schedule is set by a rotation or an override, not a plain edit.', { field: 'nextRotationDueAt' });
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, ROTATION_GROUP_COLUMNS) as Record<string, unknown>;
  assertMayArchive(req, patch, reason);

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('rotation_groups', ROTATION_GROUP_COLUMNS, patch, id, { updated_at: nowDate() });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Rotation Group', recordId: id, recordLabel: body.name ?? before.name,
        action: patch.archived === true ? 'archive' : patch.archived === false ? 'restore' : 'update',
        reason: reason ?? 'Rotation group updated', changes,
      });
    }
    return readRotationGroup(id, conn);
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict(`${body.name} is already a rotation group.`, { field: 'name' });
    throw error;
  });

  res.json(record);
}));

/* ── Rotation batches ────────────────────────────────────────────── */

rotationBatchesRouter.post('/groups/:groupId/batches', asyncHandler(async (req, res) => {
  const groupId = String(req.params.groupId);
  const group = await readRotationGroup(groupId);
  if (!group) throw notFound('Rotation group not found.');

  const body = sanitizeFields(bodyOf<BatchBody>(req), ROTATION_FIELDS);
  const name = body.name?.trim();
  if (!name) throw badRequest('A batch name is required.', { field: 'name' });

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('RTB', conn);
    const now = nowDate();
    // Always Standby: a batch becomes Active only through a rotation (rotation.ts).
    const values = { rotationGroupId: groupId, name, status: 'Standby', archived: false };
    const insert = buildInsert('rotation_batches', ROTATION_BATCH_COLUMNS, values, { id, created_at: now, updated_at: now });
    await execute(insert.sql, insert.params, conn);
    await recordAudit(conn, {
      actor, recordType: 'Rotation Batch', recordId: id, recordLabel: `${group.name} / ${name}`, action: 'create',
      reason: body.reason ?? 'Rotation batch created', changes: [{ field: 'name', from: null, to: name }],
    });
    return readRotationBatch(id, conn);
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict(`${name} already exists in this group.`, { field: 'name' });
    throw error;
  });

  res.status(201).json(record);
}));

rotationBatchesRouter.patch('/batches/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readRotationBatch(id);
  if (!before) throw notFound('Rotation batch not found.');

  const body = sanitizeFields(bodyOf<BatchBody>(req), ROTATION_FIELDS);
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) throw badRequest('A batch name is required.', { field: 'name' });
    body.name = name;
  }
  // Active/Standby are set only by a rotation — never a plain edit (see
  // monitors.ts for the same rule on a domain's own activationStatus).
  if (body.status !== undefined) {
    throw badRequest('A batch becomes Active or Standby through a rotation, not a plain edit.', { field: 'status' });
  }
  if (body.archived === true && before.status === 'Active') {
    throw badRequest('Rotate this batch out before archiving it.', { field: 'archived' });
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, ROTATION_BATCH_COLUMNS) as Record<string, unknown>;
  assertMayArchive(req, patch, reason);

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('rotation_batches', ROTATION_BATCH_COLUMNS, patch, id, { updated_at: nowDate() });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Rotation Batch', recordId: id, recordLabel: body.name ?? before.name,
        action: patch.archived === true ? 'archive' : patch.archived === false ? 'restore' : 'update',
        reason: reason ?? 'Rotation batch updated', changes,
      });
    }
    return readRotationBatch(id, conn);
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict(`${body.name} already exists in this group.`, { field: 'name' });
    throw error;
  });

  res.json(record);
}));

/** Replaces a batch's membership in one step. A domain belongs to at most one
 *  batch system-wide (migration 019's unique key on domain_monitor_id), so
 *  adding it here also removes it from wherever else it was — the request
 *  describes the end state, not a delta. */
rotationBatchesRouter.put('/batches/:id/members', asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const batch = await readRotationBatch(id);
  if (!batch) throw notFound('Rotation batch not found.');

  const body = bodyOf<{ domainMonitorIds?: unknown }>(req);
  const ids = [...new Set(Array.isArray(body.domainMonitorIds) ? body.domainMonitorIds.map(String) : [])];

  const rows = ids.length
    ? await query<RowDataPacket>(
        `SELECT id, domain_type, archived FROM domain_monitors WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids,
      )
    : [];
  const found = new Map(rows.map((r) => [String(r.id), r]));
  for (const domainId of ids) {
    const row = found.get(domainId);
    if (!row) throw badRequest(`Domain ${domainId} was not found.`, { field: 'domainMonitorIds' });
    if (row.domain_type !== 'Invite') throw badRequest('Only Invite Domains can belong to a rotation batch.', { field: 'domainMonitorIds' });
    if (row.archived) throw badRequest('An archived domain cannot be added to a rotation batch.', { field: 'domainMonitorIds' });
  }

  await tx(async (conn) => {
    await execute('DELETE FROM rotation_batch_members WHERE rotation_batch_id = ?', [id], conn);
    if (ids.length) {
      await execute(`DELETE FROM rotation_batch_members WHERE domain_monitor_id IN (${ids.map(() => '?').join(', ')})`, ids, conn);
    }
    const now = nowDate();
    for (const domainId of ids) {
      await execute(
        'INSERT INTO rotation_batch_members (rotation_batch_id, domain_monitor_id, created_at) VALUES (?, ?, ?)',
        [id, domainId, now],
        conn,
      );
    }
  });

  const members = await query<RowDataPacket>('SELECT domain_monitor_id FROM rotation_batch_members WHERE rotation_batch_id = ?', [id]);
  res.json({ rotationBatchId: id, domainMonitorIds: members.map((m) => String(m.domain_monitor_id)) });
}));
