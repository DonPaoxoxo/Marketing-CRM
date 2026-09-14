/** The domain register. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { DomainRecord } from '../../src/lib/types';
import { DOMAIN_FIELDS, sanitizeFields } from '../../src/lib/sanitize';
import { normalizeDomain } from '../../src/lib/utils';
import { execute, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../http/errors';
import { hasPermission } from '../../src/lib/permissions';
import {
  DOMAIN_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readDomain,
} from '../repositories/records';
import { actorOf, assertMayArchive, bodyOf, isDuplicateKey, nowDate } from './helpers';
import { checkDomainExtras } from '../../src/lib/domain-import';

/** Registrar, UID, Category and Nameservers, by the same rules as a sheet row. */
function applyDomainExtras(body: DomainBody): void {
  const checked = checkDomainExtras(body);
  if ('field' in checked) throw badRequest(checked.message, { field: checked.field });
  Object.assign(body, checked.value);
}

export const domainsRouter = Router();
// The domain register needs its page permission (System Administrator by default).
domainsRouter.use(requirePermission('access:domains'));

type DomainBody = Partial<DomainRecord> & { reason?: string };

/** Domain names are unique across the whole register, archived rows included:
 *  a name the team has retired is still the same name if it comes back, and
 *  keeping it reserved is what stops two records claiming one domain's history. */
async function domainTaken(domainName: string, exceptId?: string): Promise<string | null> {
  const sql = `SELECT id FROM domains WHERE domain_name = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`;
  const row = await queryOne<RowDataPacket>(sql, exceptId ? [domainName, exceptId] : [domainName]);
  return row ? String(row.id) : null;
}

domainsRouter.post('/', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<DomainBody>(req), DOMAIN_FIELDS);
  applyDomainExtras(body);
  const domainName = normalizeDomain(body.domainName ?? '');
  if (!domainName) throw badRequest('A domain name is required.', { field: 'domainName' });

  const taken = await domainTaken(domainName);
  if (taken) {
    throw conflict(`${domainName} is already registered in the domain register.`, {
      field: 'domainName', conflictId: taken,
    });
  }
  if (!body.registeredDate || !body.expirationDate) {
    throw badRequest('Registration and expiration dates are required.', { field: 'expirationDate' });
  }
  if (body.expirationDate < body.registeredDate) {
    throw badRequest('Expiration date cannot precede the registration date.', { field: 'expirationDate' });
  }

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('DOM', conn);
    const now = nowDate();
    const values = {
      ...pick(body, DOMAIN_COLUMNS),
      domainName,
      targetCountry: body.targetCountry ?? 'India',
      status: body.status ?? 'Active',
      registrar: body.registrar ?? '',
      registrarUid: body.registrarUid ?? '',
      category: body.category ?? '',
      nameservers: body.nameservers ?? '',
      notes: body.notes ?? '',
      archived: false,
    };
    const insert = buildInsert('domains', DOMAIN_COLUMNS, values, { id, created_at: now, updated_at: now });
    await execute(insert.sql, insert.params, conn);

    await recordAudit(conn, {
      actor, recordType: 'Domain', recordId: id, recordLabel: domainName, action: 'create',
      reason: body.reason ?? 'Domain added to register',
      changes: [
        { field: 'domainName', from: null, to: domainName },
        { field: 'targetCountry', from: null, to: values.targetCountry },
        { field: 'status', from: null, to: values.status },
      ],
    });
    return readDomain(id, conn);
  }).catch((error) => {
    if (isDuplicateKey(error)) {
      throw conflict(`${domainName} is already registered in the domain register.`, { field: 'domainName' });
    }
    throw error;
  });

  res.status(201).json(record);
}));

domainsRouter.patch('/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readDomain(id);
  if (!before) throw notFound('Domain not found.');

  const body = sanitizeFields(bodyOf<DomainBody>(req), DOMAIN_FIELDS);
  applyDomainExtras(body);
  if (body.domainName !== undefined) {
    body.domainName = normalizeDomain(body.domainName);
    if (!body.domainName) throw badRequest('A domain name is required.', { field: 'domainName' });
    const taken = await domainTaken(body.domainName, id);
    if (taken) {
      throw conflict(`${body.domainName} is already registered in the domain register.`, {
        field: 'domainName', conflictId: taken,
      });
    }
  }

  // Checked against the merged record, so changing either date alone still has
  // to leave the pair in order.
  const registered = body.registeredDate ?? before.registeredDate;
  const expiration = body.expirationDate ?? before.expirationDate;
  if (expiration < registered) {
    throw badRequest('Expiration date cannot precede the registration date.', { field: 'expirationDate' });
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, DOMAIN_COLUMNS);
  assertMayArchive(req, patch, reason);
  // Restoring is the reverse of archiving: the same permission and a written reason.
  const restoring = patch.archived === false && before.archived;
  if (restoring) {
    if (!hasPermission(req.user, 'archive:records')) throw forbidden(`Your role (${req.user!.role}) cannot restore records.`);
    if (!reason?.trim()) throw badRequest('Restoring needs a written reason.', { field: 'reason' });
  }

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const rotated = changes.some((c) => c.field === 'rotationDate');
  const statusChanged = changes.some((c) => c.field === 'status');
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('domains', DOMAIN_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Domain', recordId: id, recordLabel: body.domainName ?? before.domainName,
        action: rotated ? 'rotation' : statusChanged || restoring ? 'status-change' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Domain record updated',
        changes,
      });
    }
    return readDomain(id, conn);
  });

  res.json(record);
}));
