/** Credential *references*.
 *
 *  This system stores where a secret lives and who may retrieve it. It does not
 *  store, accept, proxy or display the secret itself, and the vault is not
 *  connected. The rejection below is deliberate belt-and-braces: the forms do
 *  not offer a password field, the column does not exist, and a request that
 *  tries anyway is refused by name rather than silently ignored. */

import { Router } from 'express';
import type { CredentialRef } from '../../src/lib/types';
import { CREDENTIAL_FIELDS, sanitizeFields } from '../../src/lib/sanitize';
import { execute, tx } from '../db/pool';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, notFound, unprocessable } from '../http/errors';
import {
  CREDENTIAL_COLUMNS, buildUpdate, diffRecords, pick, readCredential,
} from '../repositories/records';
import { actorOf, assertMayArchive, bodyOf, nowDate } from './helpers';

export const credentialsRouter = Router();
// Credential Refs needs its page permission (System Administrator by default).
credentialsRouter.use(requirePermission('access:credential-refs'));

type CredentialBody = Partial<CredentialRef> & { reason?: string };

/** Any field name that suggests secret material. Matched against the keys the
 *  client sent, before anything is read out of them. */
const SECRET_KEY = /pass|secret|token|cookie|code|otp|seed/i;

credentialsRouter.patch('/:id', requirePermission('manage:credential-refs'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const raw = bodyOf<Record<string, unknown>>(req);

  for (const key of Object.keys(raw)) {
    if (SECRET_KEY.test(key)) {
      throw unprocessable(
        `Field "${key}" is rejected. This system stores vault references only, never secret values.`,
        { field: key },
      );
    }
  }

  const before = await readCredential(id);
  if (!before) throw notFound('Credential reference not found.');

  const { reason, ...rest } = sanitizeFields(raw as CredentialBody, CREDENTIAL_FIELDS);
  const patch = pick(rest, CREDENTIAL_COLUMNS);
  assertMayArchive(req, patch, reason);

  const changes = diffRecords(before as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('credentials', CREDENTIAL_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (changes.length) {
      await recordAudit(conn, {
        actor, recordType: 'Credential Reference', recordId: id, recordLabel: before.vaultRef,
        action: patch.lastRotationDate ? 'rotation' : patch.accessStatus ? 'credential-request' : 'update',
        reason: reason ?? 'Credential reference updated',
        changes,
      });
    }
    return readCredential(id, conn);
  });

  res.json(record);
}));
