/** The team register, which is also the list of people who can sign in.
 *
 *  Reading it needs only a session — every ownership dropdown in the app depends
 *  on it. Changing it needs `manage:users`, which only System Administrator has. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { execute, query, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors';
import { requireAuth, requirePermission } from '../auth/middleware';
import { endAllSessionsFor } from '../auth/sessions';
import { issueToken } from '../auth/credentials';
import { recordAudit } from '../audit';
import { env } from '../env';
import { ROLES, type RoleName } from '../../src/lib/types';
import { sanitizeText, FIELD_LIMITS } from '../../src/lib/sanitize';

export const usersRouter = Router();

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  title: string;
  role: string;
  active: number;
  password_set_at: Date | null;
  invite_expires_at: Date | null;
  invite_accepted_at: Date | null;
  last_login_at: Date | null;
}

/** What the client is allowed to see. No hashes, no tokens, ever. */
function present(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    title: row.title,
    role: row.role as RoleName,
    active: Boolean(row.active),
    /** Enough to show "invited / active / never signed in" without exposing anything. */
    status: row.password_set_at
      ? 'active'
      : row.invite_expires_at && new Date(row.invite_expires_at).getTime() > Date.now()
        ? 'invited'
        : 'no-access',
    lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
  };
}

const SELECT_COLUMNS = `id, email, name, title, role, active, password_set_at,
                        invite_expires_at, invite_accepted_at, last_login_at`;

usersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = await query<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users ORDER BY name`);
    res.json({ users: rows.map(present) });
  }),
);

/* ── Create ───────────────────────────────────────────────────── */

const createSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  name: z.string().trim().min(2, 'Enter the person’s name.'),
  title: z.string().trim().default(''),
  role: z.enum(ROLES),
});

usersRouter.post(
  '/',
  requirePermission('manage:users'),
  asyncHandler(async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw badRequest(issue.message, { field: String(issue.path[0]) });
    }
    const input = parsed.data;

    const existing = await queryOne<RowDataPacket>('SELECT id FROM users WHERE email = ?', [input.email]);
    if (existing) throw conflict('Someone already has that email address.', { field: 'email', conflictId: String(existing.id) });

    const { token, hash } = issueToken();
    const expires = new Date(Date.now() + env.INVITE_TTL_HOURS * 3_600_000);
    const now = new Date();

    const created = await tx(async (conn) => {
      const id = await nextId('TM', conn);
      await execute(
        `INSERT INTO users (id, email, name, title, role, active, invite_token_hash,
                            invite_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          id,
          input.email,
          sanitizeText(input.name, FIELD_LIMITS.short),
          sanitizeText(input.title, FIELD_LIMITS.short),
          input.role,
          hash,
          expires,
          now,
          now,
        ],
        conn,
      );
      await recordAudit(conn, {
        actor: req.user!,
        recordType: 'User',
        recordId: id,
        recordLabel: input.name,
        action: 'create',
        reason: `Account created and invited as ${input.role}`,
        // The email is the account identifier rather than a contact detail here,
        // but it is still personal, so only the fact is recorded.
        changes: [{ field: 'role', from: null, to: input.role }],
      });
      return queryOne<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`, [id], conn);
    });

    // The raw token is returned exactly once, to the administrator who created
    // the account, and is never stored or logged.
    res.status(201).json({
      user: present(created!),
      inviteToken: token,
      inviteExpiresAt: expires.toISOString(),
    });
  }),
);

/* ── Update ───────────────────────────────────────────────────── */

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  title: z.string().trim().optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  reason: z.string().trim().optional(),
});

usersRouter.patch(
  '/:id',
  requirePermission('manage:users'),
  asyncHandler(async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0].message);
    const patch = parsed.data;
    const id = String(req.params.id);

    const before = await queryOne<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`, [id]);
    if (!before) throw notFound('No such user.');

    // Guard rails an admin will otherwise hit exactly once, badly.
    if (patch.active === false && before.id === req.user!.id) {
      throw badRequest('You cannot deactivate your own account.');
    }
    if ((patch.role && patch.role !== 'System Administrator') || patch.active === false) {
      if (before.role === 'System Administrator') {
        const others = await queryOne<RowDataPacket>(
          `SELECT COUNT(*) AS n FROM users WHERE role = 'System Administrator' AND active = 1 AND id <> ?`,
          [id],
        );
        if (Number(others?.n ?? 0) === 0) {
          throw badRequest('This is the only active System Administrator. Promote someone else first.');
        }
      }
    }

    const updated = await tx(async (conn) => {
      const sets: string[] = [];
      const params: unknown[] = [];
      const changes: { field: string; from: unknown; to: unknown }[] = [];

      if (patch.name !== undefined && patch.name !== before.name) {
        sets.push('name = ?'); params.push(sanitizeText(patch.name, FIELD_LIMITS.short));
        changes.push({ field: 'name', from: before.name, to: patch.name });
      }
      if (patch.title !== undefined && patch.title !== before.title) {
        sets.push('title = ?'); params.push(sanitizeText(patch.title, FIELD_LIMITS.short));
        changes.push({ field: 'title', from: before.title, to: patch.title });
      }
      if (patch.role !== undefined && patch.role !== before.role) {
        sets.push('role = ?'); params.push(patch.role);
        changes.push({ field: 'role', from: before.role, to: patch.role });
      }
      if (patch.active !== undefined && patch.active !== Boolean(before.active)) {
        sets.push('active = ?'); params.push(patch.active ? 1 : 0);
        changes.push({ field: 'active', from: Boolean(before.active), to: patch.active });
      }

      if (sets.length) {
        sets.push('updated_at = ?'); params.push(new Date());
        await execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id], conn);
        await recordAudit(conn, {
          actor: req.user!,
          recordType: 'User',
          recordId: id,
          recordLabel: before.name,
          action: patch.active === false ? 'archive' : 'update',
          reason: patch.reason ?? 'User account updated',
          changes,
        });
      }

      // A deactivated or re-roled account must lose its live sessions now, not
      // whenever they happen to expire.
      if (patch.active === false || (patch.role && patch.role !== before.role)) {
        await endAllSessionsFor(id, conn);
      }
      return queryOne<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`, [id], conn);
    });

    res.json({ user: present(updated!) });
  }),
);

/* ── Re-invite ────────────────────────────────────────────────── */

usersRouter.post(
  '/:id/invite',
  requirePermission('manage:users'),
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const row = await queryOne<UserRow>(`SELECT ${SELECT_COLUMNS} FROM users WHERE id = ?`, [id]);
    if (!row) throw notFound('No such user.');
    if (!row.active) throw badRequest('That account is deactivated. Reactivate it first.');

    const { token, hash } = issueToken();
    const expires = new Date(Date.now() + env.INVITE_TTL_HOURS * 3_600_000);

    await tx(async (conn) => {
      await execute(
        'UPDATE users SET invite_token_hash = ?, invite_expires_at = ?, updated_at = ? WHERE id = ?',
        [hash, expires, new Date(), id],
        conn,
      );
      await recordAudit(conn, {
        actor: req.user!,
        recordType: 'User',
        recordId: id,
        recordLabel: row.name,
        action: 'update',
        // For someone who already has a password this link replaces it, so the
        // history must say so rather than recording a routine re-invite.
        reason: row.password_set_at ? 'Password reset link issued' : 'Invite link reissued',
        changes: [{ field: row.password_set_at ? 'passwordReset' : 'invite', from: null, to: 'issued' }],
      });
    });

    res.json({ inviteToken: token, inviteExpiresAt: expires.toISOString() });
  }),
);
