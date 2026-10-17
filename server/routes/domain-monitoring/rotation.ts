/** Running a rotation: the one place that actually flips a batch's Active /
 *  Standby status and a domain's activationStatus. Everything else in this
 *  module only configures; this is the manual action a person confirms after
 *  reviewing a preview — never run on a timer, never run automatically. */

import { Router } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { ROTATION_FIELDS, sanitizeFields } from '../../../src/lib/sanitize';
import { execute, query, queryOne, tx } from '../../db/pool';
import { nextId } from '../../db/ids';
import { recordAudit } from '../../audit';
import { requirePermission } from '../../auth/middleware';
import { asyncHandler, badRequest, notFound } from '../../http/errors';
import { readRotationGroup } from '../../repositories/records';
import { actorOf, bodyOf, nowDate } from '../helpers';

export const rotationRouter = Router();

interface DomainChange {
  domainMonitorId: string;
  fromBatchId: string | null;
  toBatchId: string | null;
  fromActivationStatus: string | null;
  toActivationStatus: string | null;
}

async function writeEvent(
  conn: PoolConnection,
  params: {
    rotationGroupId: string;
    eventType: string;
    outgoingBatchId: string | null;
    incomingBatchId: string | null;
    previousDueAt: Date | null;
    newDueAt: Date | null;
    previousIntervalDays: number | null;
    newIntervalDays: number | null;
    isOverride: boolean;
    reason: string;
    performedById: string;
  },
  changes: DomainChange[],
): Promise<string> {
  const id = await nextId('RTE', conn);
  const now = nowDate();
  await execute(
    `INSERT INTO rotation_events
       (id, rotation_group_id, event_type, outgoing_batch_id, incoming_batch_id, previous_due_at, new_due_at,
        previous_interval_days, new_interval_days, is_override, reason, performed_by_id, performed_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, params.rotationGroupId, params.eventType, params.outgoingBatchId, params.incomingBatchId,
      params.previousDueAt, params.newDueAt, params.previousIntervalDays, params.newIntervalDays,
      params.isOverride, params.reason, params.performedById, now, now,
    ],
    conn,
  );
  for (const [position, c] of changes.entries()) {
    await execute(
      `INSERT INTO rotation_event_domain_changes
         (rotation_event_id, position, domain_monitor_id, from_batch_id, to_batch_id, from_activation_status, to_activation_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, position, c.domainMonitorId, c.fromBatchId, c.toBatchId, c.fromActivationStatus, c.toActivationStatus],
      conn,
    );
  }
  return id;
}

async function batchMembers(batchId: string, conn: PoolConnection): Promise<string[]> {
  const rows = await query<RowDataPacket>('SELECT domain_monitor_id FROM rotation_batch_members WHERE rotation_batch_id = ?', [batchId], conn);
  return rows.map((r) => String(r.domain_monitor_id));
}

async function setDomainsActivation(domainIds: string[], status: string, conn: PoolConnection): Promise<void> {
  if (!domainIds.length) return;
  await execute(
    `UPDATE domain_monitors SET activation_status = ?, updated_at = ? WHERE id IN (${domainIds.map(() => '?').join(', ')})`,
    [status, nowDate(), ...domainIds],
    conn,
  );
}

/** Full rotation: the current Active batch (if any) goes Standby, the chosen
 *  Standby batch becomes Active, and the group's schedule restarts from now. */
rotationRouter.post('/groups/:id/rotate-full', requirePermission('execute:full-rotation'), asyncHandler(async (req, res) => {
  const groupId = String(req.params.id);
  const group = await readRotationGroup(groupId);
  if (!group) throw notFound('Rotation group not found.');
  if (group.archived) throw badRequest('This rotation group is archived.');

  const body = sanitizeFields(bodyOf<{ incomingBatchId?: string; reason?: string }>(req), ROTATION_FIELDS);
  const incomingBatchId = body.incomingBatchId;
  if (!incomingBatchId) throw badRequest('Choose a batch to bring in.', { field: 'incomingBatchId' });
  const reason = body.reason?.trim();
  if (!reason || reason.length < 10) throw badRequest('A full rotation needs a written reason of at least 10 characters.', { field: 'reason' });

  const incoming = await queryOne<RowDataPacket>('SELECT * FROM rotation_batches WHERE id = ? AND rotation_group_id = ?', [incomingBatchId, groupId]);
  if (!incoming) throw badRequest('That batch does not belong to this group.', { field: 'incomingBatchId' });
  if (incoming.archived) throw badRequest('That batch is archived.', { field: 'incomingBatchId' });
  if (incoming.status === 'Active') throw badRequest('That batch is already Active.', { field: 'incomingBatchId' });

  const outgoing = await queryOne<RowDataPacket>(
    "SELECT * FROM rotation_batches WHERE rotation_group_id = ? AND status = 'Active' AND archived = 0",
    [groupId],
  );

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const incomingIds = await batchMembers(incoming.id, conn);
    if (!incomingIds.length) throw badRequest('That batch has no domains assigned to it.', { field: 'incomingBatchId' });
    const outgoingIds = outgoing ? await batchMembers(outgoing.id, conn) : [];

    const now = nowDate();
    const newDue = new Date(now.getTime() + group.rotationIntervalDays * 86_400_000);

    if (outgoing) {
      await execute('UPDATE rotation_batches SET status = ?, updated_at = ? WHERE id = ?', ['Standby', now, outgoing.id], conn);
    }
    await execute('UPDATE rotation_batches SET status = ?, updated_at = ? WHERE id = ?', ['Active', now, incoming.id], conn);
    await setDomainsActivation(outgoingIds, 'Standby', conn);
    await setDomainsActivation(incomingIds, 'Active', conn);
    await execute(
      'UPDATE rotation_groups SET cycle_started_at = ?, next_rotation_due_at = ?, updated_at = ? WHERE id = ?',
      [now, newDue, now, groupId],
      conn,
    );

    const changes: DomainChange[] = [
      ...outgoingIds.map((id): DomainChange => ({
        domainMonitorId: id, fromBatchId: outgoing!.id, toBatchId: outgoing!.id, fromActivationStatus: 'Active', toActivationStatus: 'Standby',
      })),
      ...incomingIds.map((id): DomainChange => ({
        domainMonitorId: id, fromBatchId: incoming.id, toBatchId: incoming.id, fromActivationStatus: 'Standby', toActivationStatus: 'Active',
      })),
    ];
    await writeEvent(conn, {
      rotationGroupId: groupId, eventType: 'full_rotation', outgoingBatchId: outgoing?.id ?? null, incomingBatchId: incoming.id,
      previousDueAt: group.nextRotationDueAt ? new Date(group.nextRotationDueAt) : null, newDueAt: newDue,
      previousIntervalDays: null, newIntervalDays: null, isOverride: false, reason, performedById: actor.id,
    }, changes);
    await recordAudit(conn, {
      actor, recordType: 'Rotation Event', recordId: groupId, recordLabel: `${group.name}: full rotation to ${incoming.name}`,
      action: 'rotation', reason,
      changes: [{ field: 'activeBatch', from: outgoing?.name ?? null, to: incoming.name }],
    });

    return readRotationGroup(groupId, conn);
  });

  res.json(record);
}));

/** Partial rotation: specific domains move to a different batch in the same
 *  group — a sick domain swapped out mid-cycle — without touching the
 *  group's own schedule (cycle_started_at / next_rotation_due_at). */
rotationRouter.post('/groups/:id/rotate-partial', requirePermission('execute:partial-rotation'), asyncHandler(async (req, res) => {
  const groupId = String(req.params.id);
  const group = await readRotationGroup(groupId);
  if (!group) throw notFound('Rotation group not found.');
  if (group.archived) throw badRequest('This rotation group is archived.');

  const body = sanitizeFields(bodyOf<{ moves?: unknown; reason?: string }>(req), ROTATION_FIELDS);
  const reason = body.reason?.trim();
  if (!reason || reason.length < 10) throw badRequest('A partial rotation needs a written reason of at least 10 characters.', { field: 'reason' });
  const moves = Array.isArray(body.moves)
    ? body.moves.map((m) => m as { domainMonitorId?: unknown; toBatchId?: unknown }).filter((m) => typeof m.domainMonitorId === 'string' && typeof m.toBatchId === 'string')
    : [];
  if (!moves.length) throw badRequest('Choose at least one domain to move.', { field: 'moves' });

  const groupBatches = await query<RowDataPacket>('SELECT * FROM rotation_batches WHERE rotation_group_id = ? AND archived = 0', [groupId]);
  const batchById = new Map(groupBatches.map((b) => [String(b.id), b]));

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const changes: DomainChange[] = [];
    for (const move of moves) {
      const domainId = String(move.domainMonitorId);
      const toBatchId = String(move.toBatchId);
      const toBatch = batchById.get(toBatchId);
      if (!toBatch) throw badRequest(`Batch ${toBatchId} does not belong to this group.`, { field: 'moves' });

      const current = await queryOne<RowDataPacket>('SELECT rotation_batch_id FROM rotation_batch_members WHERE domain_monitor_id = ?', [domainId], conn);
      const fromBatchId = current ? String(current.rotation_batch_id) : null;
      if (fromBatchId && !batchById.has(fromBatchId)) throw badRequest(`Domain ${domainId} does not belong to this group.`, { field: 'moves' });
      if (fromBatchId === toBatchId) continue;

      const domain = await queryOne<RowDataPacket>('SELECT activation_status FROM domain_monitors WHERE id = ?', [domainId], conn);
      if (!domain) throw badRequest(`Domain ${domainId} was not found.`, { field: 'moves' });

      await execute('DELETE FROM rotation_batch_members WHERE domain_monitor_id = ?', [domainId], conn);
      const now = nowDate();
      await execute('INSERT INTO rotation_batch_members (rotation_batch_id, domain_monitor_id, created_at) VALUES (?, ?, ?)', [toBatchId, domainId, now], conn);
      await setDomainsActivation([domainId], toBatch.status, conn);

      changes.push({
        domainMonitorId: domainId, fromBatchId, toBatchId,
        fromActivationStatus: String(domain.activation_status ?? ''), toActivationStatus: String(toBatch.status),
      });
    }

    if (!changes.length) throw badRequest('None of the chosen domains needed to move.', { field: 'moves' });

    await writeEvent(conn, {
      rotationGroupId: groupId, eventType: 'partial_rotation', outgoingBatchId: null, incomingBatchId: null,
      previousDueAt: null, newDueAt: null, previousIntervalDays: null, newIntervalDays: null,
      isOverride: false, reason, performedById: actor.id,
    }, changes);
    await recordAudit(conn, {
      actor, recordType: 'Rotation Event', recordId: groupId, recordLabel: `${group.name}: partial rotation (${changes.length} domain${changes.length === 1 ? '' : 's'})`,
      action: 'rotation', reason,
      changes: changes.map((c) => ({ field: c.domainMonitorId, from: c.fromBatchId, to: c.toBatchId })),
    });

    return readRotationGroup(groupId, conn);
  });

  res.json(record);
}));

/** Schedule overrides: postpone or complete the current cycle early, or
 *  change the interval going forward. Always written as is_override=true,
 *  which is what distinguishes it from a full rotation in the history view. */
rotationRouter.post('/groups/:id/override', requirePermission('override:rotation-schedule'), asyncHandler(async (req, res) => {
  const groupId = String(req.params.id);
  const group = await readRotationGroup(groupId);
  if (!group) throw notFound('Rotation group not found.');
  if (group.archived) throw badRequest('This rotation group is archived.');

  const body = sanitizeFields(bodyOf<{
    action?: string; newDueAt?: string; newIntervalDays?: unknown; reason?: string;
  }>(req), ROTATION_FIELDS);
  const reason = body.reason?.trim();
  if (!reason || reason.length < 10) throw badRequest('An override needs a written reason of at least 10 characters.', { field: 'reason' });

  const actor = actorOf(req);
  const now = nowDate();
  const previousDueAt = group.nextRotationDueAt ? new Date(group.nextRotationDueAt) : null;

  let eventType: string;
  let newDueAt: Date | null = previousDueAt;
  let newIntervalDays: number | null = null;
  const previousIntervalDays = group.rotationIntervalDays;

  if (body.action === 'postpone') {
    if (!body.newDueAt) throw badRequest('Choose a new rotation date.', { field: 'newDueAt' });
    newDueAt = new Date(body.newDueAt);
    if (Number.isNaN(newDueAt.getTime())) throw badRequest('That date is not valid.', { field: 'newDueAt' });
    eventType = 'postpone';
  } else if (body.action === 'early_complete') {
    newDueAt = new Date(now.getTime() + group.rotationIntervalDays * 86_400_000);
    eventType = 'early_complete';
  } else if (body.action === 'change_interval') {
    const days = Number(body.newIntervalDays);
    if (!Number.isInteger(days) || days < 1 || days > 90) throw badRequest('Choose a whole number of days between 1 and 90.', { field: 'newIntervalDays' });
    newIntervalDays = days;
    newDueAt = group.cycleStartedAt ? new Date(new Date(group.cycleStartedAt).getTime() + days * 86_400_000) : previousDueAt;
    eventType = 'change_interval';
  } else {
    throw badRequest('Choose postpone, early_complete or change_interval.', { field: 'action' });
  }

  const record = await tx(async (conn) => {
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [now];
    if (eventType !== 'change_interval' || newDueAt !== previousDueAt) {
      sets.push('next_rotation_due_at = ?');
      params.push(newDueAt);
    }
    if (eventType === 'early_complete') {
      sets.push('cycle_started_at = ?');
      params.push(now);
    }
    if (newIntervalDays !== null) {
      sets.push('rotation_interval_days = ?');
      params.push(newIntervalDays);
    }
    params.push(groupId);
    await execute(`UPDATE rotation_groups SET ${sets.join(', ')} WHERE id = ?`, params, conn);

    await writeEvent(conn, {
      rotationGroupId: groupId, eventType, outgoingBatchId: null, incomingBatchId: null,
      previousDueAt, newDueAt, previousIntervalDays, newIntervalDays, isOverride: true, reason, performedById: actor.id,
    }, []);
    await recordAudit(conn, {
      actor, recordType: 'Rotation Event', recordId: groupId, recordLabel: `${group.name}: ${eventType.replace('_', ' ')} override`,
      action: 'rotation', reason,
      changes: [
        { field: 'nextRotationDueAt', from: group.nextRotationDueAt, to: newDueAt?.toISOString() ?? null },
        ...(newIntervalDays !== null ? [{ field: 'rotationIntervalDays', from: group.rotationIntervalDays, to: newIntervalDays }] : []),
      ],
    });

    return readRotationGroup(groupId, conn);
  });

  res.json(record);
}));
