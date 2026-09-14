/** The SIM register. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { Sim } from '../../src/lib/types';
import { SIM_FIELDS, sanitizeFields } from '../../src/lib/sanitize';
import { normalizePhone } from '../../src/lib/utils';
import { execute, query, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors';
import {
  SIM_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readSim,
} from '../repositories/records';
import { actorOf, assertMayArchive, bodyOf, isDuplicateKey, nowDate } from './helpers';
import { keyChanged, simExtraHolder, taken as takenBy } from './duplicates';
import { emailKey, phoneKey, telegramKey } from '../../src/lib/identity';
import { checkSimExtras } from '../../src/lib/sim-import';

/** Created For, Email and Telegram username: validated and normalised by the
 *  same rule as a sheet row, then held to one live SIM each. `before` is the
 *  record being edited, so an unchanged value is never re-checked. */
async function applySimExtras(body: SimBody, before?: Sim): Promise<void> {
  const checked = checkSimExtras(body);
  if ('field' in checked) throw badRequest(checked.message, { field: checked.field });
  Object.assign(body, checked.value);

  if (body.email !== undefined && keyChanged(emailKey, before?.email, body.email)) {
    const holder = await simExtraHolder('email', body.email, before?.id);
    if (holder) throw takenBy('email', holder, 'email');
  }
  if (body.telegramUsername !== undefined && keyChanged(telegramKey, before?.telegramUsername, body.telegramUsername)) {
    const holder = await simExtraHolder('telegram_username', body.telegramUsername, before?.id);
    if (holder) throw takenBy('Telegram username', holder, 'telegramUsername');
  }
}

export const simsRouter = Router();

type SimBody = Partial<Sim> & { reason?: string };

/** A phone number already on a live record.
 *
 *  Archived rows are excluded on purpose: a retired SIM keeps its history, and
 *  the same number genuinely can be reissued on a new record later. */
async function phoneTaken(phoneNumber: string, exceptId?: string): Promise<string | null> {
  const rows = exceptId
    ? await query<RowDataPacket>(
      'SELECT id FROM sims WHERE phone_number = ? AND archived = 0 AND id <> ? LIMIT 1',
      [phoneNumber, exceptId],
    )
    : await query<RowDataPacket>(
      'SELECT id FROM sims WHERE phone_number = ? AND archived = 0 LIMIT 1',
      [phoneNumber],
    );
  return rows.length ? String(rows[0].id) : null;
}

simsRouter.post('/', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<SimBody>(req), SIM_FIELDS);
  const phoneNumber = normalizePhone(body.phoneNumber ?? '');
  if (!phoneNumber) throw badRequest('A phone number is required.', { field: 'phoneNumber' });

  await applySimExtras(body);

  const taken = await phoneTaken(phoneNumber);
  if (taken) {
    throw conflict(`${phoneNumber} is already registered on another SIM record.`, {
      field: 'phoneNumber', conflictId: taken,
    });
  }

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('SIM', conn);
    const now = nowDate();
    const values = {
      ...pick(body, SIM_COLUMNS),
      phoneNumber,
      countryCode: body.countryCode ?? 'IN',
      provider: body.provider ?? '',
      form: body.form ?? 'Physical SIM',
      createdFor: body.createdFor ?? '',
      email: body.email ?? '',
      telegramUsername: body.telegramUsername ?? '',
      operationalStatus: body.operationalStatus ?? 'Active',
      allocationStatus: body.allocationStatus ?? 'Available',
      notes: body.notes ?? '',
      archived: false,
    };
    const insert = buildInsert('sims', SIM_COLUMNS, values, { id, created_at: now, updated_at: now });
    await execute(insert.sql, insert.params, conn);

    // The label is the record id, never the number: an audit entry is permanent
    // and read by more people than the register itself. The number stays
    // reachable through the record it names.
    await recordAudit(conn, {
      actor, recordType: 'SIM', recordId: id, recordLabel: id, action: 'create',
      reason: body.reason ?? 'New SIM registered',
      changes: [{ field: 'phoneNumber', from: null, to: '[recorded]' }],
    });
    return readSim(id, conn);
  }).catch((error) => {
    if (isDuplicateKey(error)) throw conflict('That SIM is already registered.', { field: 'phoneNumber' });
    throw error;
  });

  res.status(201).json(record);
}));

simsRouter.patch('/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readSim(id);
  if (!before) throw notFound('SIM record not found.');

  const body = sanitizeFields(bodyOf<SimBody>(req), SIM_FIELDS);
  await applySimExtras(body, before);
  if (body.phoneNumber !== undefined) {
    body.phoneNumber = normalizePhone(body.phoneNumber);
    if (!body.phoneNumber) throw badRequest('A phone number is required.', { field: 'phoneNumber' });
    // Only a changed number: a SIM that already clashes from before must stay editable.
    const taken = keyChanged(phoneKey, before.phoneNumber, body.phoneNumber)
      ? await phoneTaken(body.phoneNumber, id)
      : null;
    if (taken) {
      throw conflict(`${body.phoneNumber} is already registered on another SIM record.`, {
        field: 'phoneNumber', conflictId: taken,
      });
    }
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, SIM_COLUMNS);
  assertMayArchive(req, patch, reason);
  const changes = diffRecords(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('sims', SIM_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'SIM', recordId: id, recordLabel: id,
        action: patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Record updated',
        changes,
      });
    }
    return readSim(id, conn);
  });

  res.json(record);
}));
