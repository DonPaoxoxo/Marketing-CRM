/** The social account register. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { SocialAccount } from '../../src/lib/types';
import { ACCOUNT_FIELDS, sanitizeFields } from '../../src/lib/sanitize';
import { execute, query, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors';
import {
  ACCOUNT_COLUMNS, buildInsert, buildUpdate, diffRecords, pick, readAccount, replaceLinks,
} from '../repositories/records';
import { actorOf, assertMayArchive, bodyOf, nowDate } from './helpers';
import { keyChanged, profileUrlHolder, taken } from './duplicates';
import { pageUrlKey } from '../../src/lib/identity';
import { checkRecoveryDetail } from '../../src/lib/recovery';

export const socialAccountsRouter = Router();

type AccountBody = Partial<SocialAccount> & { reason?: string };

/** What identifies an account is the platform's own ID, not the handle.
 *
 *  Handles are deliberately allowed to repeat. Team members manage many pages
 *  and record the same handle or name on each; Facebook pages and groups often
 *  have no username at all. Two live records with the same platform account ID,
 *  though, are the same asset — that is what is refused. */
async function platformIdTaken(platformId: string, external: string, exceptId?: string): Promise<string | null> {
  if (!external) return null;
  const sql = `SELECT id FROM social_accounts
                WHERE platform_id = ? AND platform_account_id = ? AND archived = 0
                  ${exceptId ? 'AND id <> ?' : ''}
                LIMIT 1`;
  const params = exceptId ? [platformId, external, exceptId] : [platformId, external];
  const row = await queryOne<RowDataPacket>(sql, params);
  return row ? String(row.id) : null;
}

async function defaultPlatformId(): Promise<string | null> {
  const rows = await query<RowDataPacket>('SELECT id FROM platforms ORDER BY name LIMIT 1');
  return rows.length ? String(rows[0].id) : null;
}

/** The recovery detail, by the rules for its method (see src/lib/recovery.ts).
 *  Checked whenever either the method or the detail is sent. */
function applyRecovery(body: AccountBody, before?: { recoveryMethod: AccountBody['recoveryMethod']; recoveryRef: string }): void {
  if (body.recoveryMethod === undefined && body.recoveryRef === undefined) return;
  const method = body.recoveryMethod ?? before?.recoveryMethod ?? 'None';
  const checked = checkRecoveryDetail(method, body.recoveryRef ?? before?.recoveryRef ?? '');
  if ('error' in checked) throw badRequest(checked.error, { field: 'recoveryRef' });
  body.recoveryRef = checked.value;
}

socialAccountsRouter.post('/', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const body = sanitizeFields(bodyOf<AccountBody>(req), ACCOUNT_FIELDS);
  applyRecovery(body);
  const username = body.username?.trim();
  if (!username) throw badRequest('A username or handle is required.', { field: 'username' });

  const platformId = body.platformId ?? (await defaultPlatformId());
  if (!platformId) throw badRequest('No platforms are configured yet.', { field: 'platformId' });

  const urlHolder = await profileUrlHolder(body.profileUrl ?? '');
  if (urlHolder) throw taken('profile URL', urlHolder, 'profileUrl');

  const dupExternal = await platformIdTaken(platformId, body.platformAccountId ?? '');
  if (dupExternal) {
    throw conflict(`This platform ID already exists (${dupExternal}).`, {
      field: 'platformAccountId', conflictId: dupExternal,
    });
  }

  const actor = actorOf(req);
  const record = await tx(async (conn) => {
    const id = await nextId('ACC', conn);
    const now = nowDate();
    const values = {
      ...pick(body, ACCOUNT_COLUMNS),
      platformId,
      username,
      platformAccountId: body.platformAccountId ?? '',
      assetType: body.assetType ?? 'Profile',
      displayName: body.displayName ?? username,
      profileUrl: body.profileUrl ?? '',
      contentLanguage: body.contentLanguage ?? 'English',
      loginEmailRef: body.loginEmailRef ?? '',
      recoveryMethod: body.recoveryMethod ?? 'None',
      recoveryRef: body.recoveryRef ?? '',
      twoFaEnabled: body.twoFaEnabled ?? false,
      twoFaMethod: body.twoFaMethod ?? 'None',
      operationalStatus: body.operationalStatus ?? 'Active',
      allocationStatus: body.allocationStatus ?? 'Unassigned',
      notes: body.notes ?? '',
      archived: false,
    };
    const insert = buildInsert('social_accounts', ACCOUNT_COLUMNS, values, {
      id, created_at: now, updated_at: now,
    });
    await execute(insert.sql, insert.params, conn);
    if (body.simIds) await replaceLinks(conn, 'account_sims', 'account_id', id, 'sim_id', body.simIds);

    await recordAudit(conn, {
      actor, recordType: 'Social Account', recordId: id, recordLabel: `@${username}`, action: 'create',
      reason: body.reason ?? 'Account registered',
      changes: [{ field: 'username', from: null, to: username }],
    });
    return readAccount(id, conn);
  });

  res.status(201).json(record);
}));

socialAccountsRouter.patch('/:id', requirePermission('edit:resources'), asyncHandler(async (req, res) => {
  const id = String(req.params.id);
  const before = await readAccount(id);
  if (!before) throw notFound('Account not found.');

  const body = sanitizeFields(bodyOf<AccountBody>(req), ACCOUNT_FIELDS);
  applyRecovery(body, before);
  const platformId = body.platformId ?? before.platformId;
  if (body.username !== undefined) {
    const username = body.username.trim();
    if (!username) throw badRequest('A username or handle is required.', { field: 'username' });
    body.username = username;
  }
  if (body.profileUrl !== undefined && keyChanged(pageUrlKey, before.profileUrl, body.profileUrl)) {
    const holder = await profileUrlHolder(body.profileUrl, id);
    if (holder) throw taken('profile URL', holder, 'profileUrl');
  }
  if (body.platformAccountId !== undefined) {
    const dup = await platformIdTaken(platformId, body.platformAccountId, id);
    if (dup) {
      throw conflict(`This platform ID already exists (${dup}).`, {
        field: 'platformAccountId', conflictId: dup,
      });
    }
  }

  const { reason, ...rest } = body;
  const patch = pick(rest, ACCOUNT_COLUMNS);
  assertMayArchive(req, patch, reason);

  const listPatch = rest.simIds ? { simIds: rest.simIds } : {};
  const changes = diffRecords(
    before as unknown as Record<string, unknown>,
    { ...patch, ...listPatch } as Record<string, unknown>,
  );
  const actor = actorOf(req);

  const record = await tx(async (conn) => {
    const update = buildUpdate('social_accounts', ACCOUNT_COLUMNS, patch as Record<string, unknown>, id, {
      updated_at: nowDate(),
    });
    if (update) await execute(update.sql, update.params, conn);
    if (body.simIds) await replaceLinks(conn, 'account_sims', 'account_id', id, 'sim_id', body.simIds);

    if (changes.length) {
      await recordAudit(conn, {
        actor,
        recordType: 'Social Account',
        recordId: id,
        recordLabel: `@${body.username ?? before.username}`,
        action: patch.archived
          ? 'archive'
          : patch.operationalStatus || patch.allocationStatus ? 'status-change' : 'update',
        reason: reason ?? 'Record updated',
        changes,
      });
    }
    return readAccount(id, conn);
  });

  res.json(record);
}));
