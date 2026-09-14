/** Assignments and handovers.
 *
 *  An assignment is the only write that changes two registers at once: the
 *  handover row and the resource's allocation status. Both happen inside one
 *  transaction, because a resource that says "Available" while an active
 *  custodian row exists is exactly the contradiction this register exists to
 *  prevent. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { Assignment } from '../../src/lib/types';
import { ASSIGNMENT_FIELDS, sanitizeFields } from '../../src/lib/sanitize';
import { checkAssignmentConflict } from '../../src/lib/rules';
import { execute, query, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors';
import { mapAssignment } from '../repositories/mappers';
import {
  ASSIGNMENT_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readAssignment,
} from '../repositories/records';
import { actorOf, bodyOf, nowDate, today } from './helpers';

export const assignmentsRouter = Router();

type AssignmentBody = Partial<Assignment> & { reason?: string };

/** Keeps a resource's allocation status in step with its primary custodian.
 *
 *  Collaborator rows deliberately do not move it — a second person having access
 *  does not change who the resource is allocated to. */
async function syncResource(
  conn: Parameters<typeof execute>[2],
  record: Assignment,
  direction: 'assigned' | 'released',
): Promise<void> {
  if (record.role !== 'Primary Custodian') return;
  const now = nowDate();

  if (record.resourceType === 'Social Account') {
    await execute(
      'UPDATE social_accounts SET allocation_status = ?, updated_at = ? WHERE id = ?',
      [direction === 'assigned' ? 'Assigned' : 'Unassigned', now, record.resourceId],
      conn,
    );
  } else if (record.resourceType === 'SIM') {
    await execute(
      'UPDATE sims SET allocation_status = ?, assignee_id = ?, assignee_type = ?, updated_at = ? WHERE id = ?',
      direction === 'assigned'
        ? ['Assigned', record.newAssigneeId, record.newAssigneeType, now, record.resourceId]
        : ['Available', null, null, now, record.resourceId],
      conn,
    );
  }
  // Domains have no custodian column; their assignment history is the record.
}

assignmentsRouter.post('/', requirePermission('assign:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<AssignmentBody>(req), ASSIGNMENT_FIELDS);
  if (!body.resourceId || !body.newAssigneeId) {
    throw badRequest('A resource and a new assignee are required.');
  }

  const resourceType = body.resourceType ?? 'Social Account';
  const role = body.role ?? 'Primary Custodian';

  // The same rule the UI applies before the form is submitted, evaluated here
  // against live rows — the client's copy is a courtesy, this one decides.
  const openRows = await query<RowDataPacket>(
    'SELECT * FROM assignments WHERE resource_type = ? AND resource_id = ? AND active = 1',
    [resourceType, body.resourceId],
  );
  const clash = checkAssignmentConflict(openRows.map(mapAssignment), {
    resourceType, resourceId: body.resourceId, role,
  });
  if (clash.conflict) throw conflict(clash.message, { conflictId: clash.existing?.id });

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('ASG', conn);
    const now = nowDate();
    const values = {
      ...pick(body, ASSIGNMENT_COLUMNS),
      resourceType,
      role,
      newAssigneeType: body.newAssigneeType ?? 'Team Member',
      startDate: body.startDate ?? today(),
      purpose: body.purpose ?? '',
      handoverStatus: body.handoverStatus ?? 'Pending',
      credentialAction: body.credentialAction ?? 'None',
      notes: body.notes ?? '',
      // A new handover has not been acknowledged or returned yet, whatever the
      // request says.
      acknowledgedAt: null,
      acknowledgedBy: null,
      returnedDate: null,
      active: true,
    };
    const insert = buildInsert('assignments', ASSIGNMENT_COLUMNS, values, {
      id, created_at: now, updated_at: now,
    });
    await execute(insert.sql, insert.params, conn);

    const stored = await readAssignment(id, conn);
    if (stored) await syncResource(conn, stored, 'assigned');

    await recordAudit(conn, {
      actor, recordType: resourceType, recordId: body.resourceId!, recordLabel: body.resourceId!,
      action: 'assign',
      reason: body.reason ?? (values.purpose || 'Resource assigned'),
      changes: [
        { field: 'assignee', from: values.previousAssigneeId ?? null, to: body.newAssigneeId },
        { field: 'role', from: null, to: role },
        { field: 'credentialAction', from: null, to: values.credentialAction },
      ],
    });
    return stored;
  });

  res.status(201).json(record);
}));

assignmentsRouter.patch('/:id', requirePermission('assign:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readAssignment(id);
  if (!before) throw notFound('Assignment not found.');

  const { reason, ...rest } = sanitizeFields(bodyOf<AssignmentBody>(req), ASSIGNMENT_FIELDS);
  const patch = pick(rest, ASSIGNMENT_COLUMNS);

  // Closing a handover — explicitly, or by marking it Returned — releases the
  // resource and stamps a return date if the request did not carry one.
  const closing = patch.active === false || patch.handoverStatus === 'Returned';
  if (closing) {
    patch.active = false;
    patch.returnedDate = patch.returnedDate ?? before.returnedDate ?? today();
  }

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('assignments', ASSIGNMENT_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (closing) await syncResource(conn, before, 'released');

    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: before.resourceType, recordId: before.resourceId, recordLabel: before.resourceId,
        action: 'assign', reason: reason ?? 'Handover updated', changes,
      });
    }
    return readAssignment(id, conn);
  });

  res.json(record);
}));
