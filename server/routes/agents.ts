/** The agent register.
 *
 *  An agent is a person or agency the team works with, not a CRM login. Creating
 *  one never creates a user account — that is a separate, permissioned action on
 *  `/api/users`, and keeping the two apart is a standing rule of this system. */

import { Router } from 'express';
import type { Agent } from '../../src/lib/types';
import { AGENT_FIELDS, sanitizeFields } from '../../src/lib/sanitize';
import { normalizePhone } from '../../src/lib/utils';
import { execute, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requireAuth, requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, forbidden, notFound } from '../http/errors';
import { queryOne } from '../db/pool';
import type { RowDataPacket } from 'mysql2/promise';
import { agentLockReason, isArchiveOnlyChange, mayArchiveAgent, mayEditAgent } from '../../src/lib/access';
import { checkSalaryStatus, maySetSalaryStatus, salaryLabel } from '../../src/lib/salary';
import { hasPermission } from '../../src/lib/permissions';
import {
  AGENT_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readAgent, replaceLinks, replaceOrdered,
} from '../repositories/records';
import { actorOf, assertMayArchive, bodyOf, nowDate } from './helpers';
import {
  agentChannelHolder, agentPhoneHolder, agentUidHolder, assertNoRepeatedUrl, keyChanged, taken,
} from './duplicates';
import { pageUrlKey, phoneKey, urlKeys } from '../../src/lib/identity';

export const agentsRouter = Router();

type AgentBody = Partial<Agent> & { reason?: string };

/** The three lists that live in join tables rather than on the row. */
async function writeLinks(
  conn: Parameters<typeof replaceLinks>[0],
  id: string,
  body: AgentBody,
): Promise<void> {
  if (body.brandIds) await replaceLinks(conn, 'agent_brands', 'agent_id', id, 'brand_id', body.brandIds);
  if (body.projectIds) await replaceLinks(conn, 'agent_projects', 'agent_id', id, 'project_id', body.projectIds);
  if (body.channelUrls) await replaceOrdered(conn, 'agent_channels', 'agent_id', id, 'url', body.channelUrls);
}

agentsRouter.post('/', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<AgentBody>(req), AGENT_FIELDS);
  const name = body.name?.trim();
  if (!name) throw badRequest('A name is required.', { field: 'name' });

  const phoneHolder = await agentPhoneHolder(body.contactNumber ?? '');
  if (phoneHolder) throw taken('contact number', phoneHolder, 'contactNumber');
  body.externalUid = (body.externalUid ?? '').trim();
  const uidHolder = await agentUidHolder(body.externalUid);
  if (uidHolder) throw taken('UID', uidHolder, 'externalUid');
  if (body.channelUrls) {
    assertNoRepeatedUrl(body.channelUrls, 'channelUrls');
    const channelHolder = await agentChannelHolder(body.channelUrls);
    if (channelHolder) throw taken(`channel URL (${channelHolder.url})`, channelHolder, 'channelUrls');
  }

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('AGT', conn);
    const now = nowDate();
    const values = {
      ...pick(body, AGENT_COLUMNS),
      name,
      agentType: body.agentType ?? 'Individual',
      contactNumber: normalizePhone(body.contactNumber ?? ''),
      email: body.email ?? '',
      preferredChannel: body.preferredChannel ?? 'Email',
      cooperationStatus: body.cooperationStatus ?? 'Prospect',
      agreementRef: body.agreementRef ?? '',
      notes: body.notes ?? '',
      archived: false,
    };
    const insert = buildInsert('agents', AGENT_COLUMNS, values, { id, created_at: now, updated_at: now });
    await execute(insert.sql, insert.params, conn);
    await writeLinks(conn, id, body);

    await recordAudit(conn, {
      actor, recordType: 'Agent', recordId: id, recordLabel: name, action: 'create',
      reason: body.reason ?? 'Agent registered. No CRM login account is created.',
      changes: [{ field: 'name', from: null, to: name }],
    });
    return readAgent(id, conn);
  });

  res.status(201).json(record);
}));

/** Salary status: Hold, Advance or Customize. The System Administrator's alone,
 *  decided from the session role; the ordinary agent edit cannot touch it. */
agentsRouter.patch('/:id/salary', requireAuth, asyncHandler(async (req, res) => {
  if (!maySetSalaryStatus(req.user!.role)) throw forbidden('Only the System Administrator can set the salary status.');
  const id = String(req.params.id);
  const before = await readAgent(id);
  if (!before) throw notFound('Agent not found.');
  const checked = checkSalaryStatus(bodyOf<{ status?: unknown; note?: unknown }>(req));
  if ('error' in checked) throw badRequest(checked.error, { field: checked.field });
  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const unchanged = checked.status === before.salaryStatus && checked.note === before.salaryNote;
    if (!unchanged) {
      await execute(
        'UPDATE agents SET salary_status = ?, salary_note = ?, salary_updated_by_name = ?, salary_updated_at = ?, updated_at = ? WHERE id = ?',
        [checked.status, checked.note, actor.name.slice(0, 160), nowDate(), nowDate(), id],
        conn,
      );
      const after = salaryLabel({ salaryStatus: checked.status, salaryNote: checked.note });
      await recordAudit(conn, {
        actor, recordType: 'Agent', recordId: id, recordLabel: before.name, action: 'status-change',
        reason: `Salary status set to ${after}`,
        changes: [{ field: 'salaryStatus', from: before.salaryStatus ? salaryLabel(before) : null, to: checked.status ? after : null }],
      });
    }
    return readAgent(id, conn);
  });
  res.json(record);
}));

agentsRouter.patch('/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readAgent(id);
  if (!before) throw notFound('Agent not found.');
  // Only the assigned manager or the System Administrator edits an agent. Archiving
  // or restoring on its own is open to every member who may archive records; the
  // permission and reason checks below still apply.
  const archiveOnly = isArchiveOnlyChange(bodyOf<Record<string, unknown>>(req));
  if (archiveOnly && !mayArchiveAgent(req.user)) {
    throw forbidden(`Your role (${req.user!.role}) cannot archive or restore agents.`);
  }
  if (!archiveOnly && !mayEditAgent(req.user, before)) {
    const manager = before.managerId
      ? await queryOne<RowDataPacket>('SELECT name FROM users WHERE id = ?', [before.managerId])
      : null;
    throw forbidden(agentLockReason(req.user, before, manager ? String(manager.name) : 'the assigned manager') ?? 'Not allowed.');
  }

  const body = sanitizeFields(bodyOf<AgentBody>(req), AGENT_FIELDS);
  if (body.externalUid !== undefined) {
    body.externalUid = body.externalUid.trim();
    if (body.externalUid.toLowerCase() !== before.externalUid.toLowerCase()) {
      const holder = await agentUidHolder(body.externalUid, id);
      if (holder) throw taken('UID', holder, 'externalUid');
    }
  }
  if (body.contactNumber !== undefined) {
    body.contactNumber = normalizePhone(body.contactNumber);
    if (keyChanged(phoneKey, before.contactNumber, body.contactNumber)) {
      const holder = await agentPhoneHolder(body.contactNumber, id);
      if (holder) throw taken('contact number', holder, 'contactNumber');
    }
  }
  if (body.channelUrls) {
    assertNoRepeatedUrl(body.channelUrls, 'channelUrls');
    // Only URLs this agent did not already have, so an old clash never blocks
    // an unrelated edit.
    const had = new Set(urlKeys(before.channelUrls));
    const added = body.channelUrls.filter((u) => pageUrlKey(u) && !had.has(pageUrlKey(u)));
    const holder = await agentChannelHolder(added, id);
    if (holder) throw taken(`channel URL (${holder.url})`, holder, 'channelUrls');
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, AGENT_COLUMNS);
  assertMayArchive(req, patch, reason);

  // Restoring is the reverse of archiving: the same permission, a written reason,
  // and the agent's number, UID and channels must not now belong to a live agent.
  if (patch.archived === false && before.archived) {
    if (!hasPermission(req.user, 'archive:records')) {
      throw forbidden(`Your role (${req.user!.role}) cannot restore records.`);
    }
    if (!reason?.trim()) throw badRequest('Restoring needs a written reason.', { field: 'reason' });
    const phone = await agentPhoneHolder(body.contactNumber ?? before.contactNumber, id);
    if (phone) throw taken('contact number', phone, 'contactNumber');
    const uid = await agentUidHolder(body.externalUid ?? before.externalUid, id);
    if (uid) throw taken('UID', uid, 'externalUid');
    const channel = await agentChannelHolder(body.channelUrls ?? before.channelUrls, id);
    if (channel) throw taken(`channel URL (${channel.url})`, channel, 'channelUrls');
  }

  // The join-table lists are not columns, so they are diffed separately —
  // otherwise changing only an agent's brands would write no history.
  const listPatch: Record<string, unknown> = {};
  for (const field of ['brandIds', 'projectIds', 'channelUrls'] as const) {
    if (rest[field]) listPatch[field] = rest[field];
  }
  const changes = diffRecords(
    before as unknown as Record<string, unknown>,
    { ...patch, ...listPatch } as Record<string, unknown>,
  );
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('agents', AGENT_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    await writeLinks(conn, id, body);

    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Agent', recordId: id, recordLabel: before.name,
        action: patch.archived ? 'archive' : patch.archived === false && before.archived ? 'status-change' : 'update',
        reason: reason ?? 'Record updated',
        changes,
      });
    }
    return readAgent(id, conn);
  });

  res.json(record);
}));
