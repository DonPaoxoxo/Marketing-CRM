/** Sign in, sign out, accept an invite, change a password.
 *
 *  Every response here is deliberately vague about whether an account exists.
 *  "Email not found" and "wrong password" are the same message and cost roughly
 *  the same time, because the difference between them is a list of who works here. */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { execute, queryOne, tx } from '../db/pool';
import { asyncHandler, badRequest, unauthorized } from '../http/errors';
import {
  equaliseVerificationCost, hashPassword, hashToken, passwordProblem, verifyPassword,
} from '../auth/credentials';
import { endAllSessionsFor, endSession, readSession, startSession } from '../auth/sessions';
import { requireAuth } from '../auth/middleware';
import { env } from '../env';
import type { RoleName } from '../../src/lib/types';

export const authRouter = Router();

/** Per-IP throttle. The per-account lockout below is the one that actually
 *  protects a targeted account; this limits broad spraying. */
const signInLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many attempts. Wait a few minutes and try again.' },
});

const MAX_FAILURES = 8;
const LOCKOUT_MINUTES = 15;

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  name: string;
  title: string;
  role: string;
  active: number;
  password_hash: string | null;
  failed_login_count: number;
  locked_until: Date | null;
}

const publicUser = (row: UserRow) => ({
  id: row.id,
  email: row.email,
  name: row.name,
  title: row.title,
  role: row.role as RoleName,
  active: Boolean(row.active),
});

/* ── Sign in ──────────────────────────────────────────────────── */

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

authRouter.post(
  '/login',
  signInLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0].message, { field: parsed.error.issues[0].path[0] as string });
    const { email, password } = parsed.data;

    const row = await queryOne<UserRow>(
      `SELECT id, email, name, title, role, active, password_hash, failed_login_count, locked_until
         FROM users WHERE email = ?`,
      [email],
    );

    // No account, no password set, or deactivated: spend the same time as a real
    // verification, then give the same answer.
    if (!row || !row.password_hash || !row.active) {
      await equaliseVerificationCost();
      throw unauthorized('That email and password do not match an active account.');
    }

    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      throw unauthorized('Too many failed attempts. Try again in a few minutes.');
    }

    const ok = await verifyPassword(row.password_hash, password);
    if (!ok) {
      const failures = row.failed_login_count + 1;
      const lockUntil = failures >= MAX_FAILURES ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
      await execute(
        'UPDATE users SET failed_login_count = ?, locked_until = ?, updated_at = ? WHERE id = ?',
        [lockUntil ? 0 : failures, lockUntil, new Date(), row.id],
      );
      throw unauthorized('That email and password do not match an active account.');
    }

    await execute(
      'UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?',
      [new Date(), new Date(), row.id],
    );
    await startSession(res, row, { ip: req.ip, userAgent: req.get('user-agent') ?? '' });
    res.json({ user: publicUser(row) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await endSession(req, res);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const user = await readSession(req);
    if (!user) throw unauthorized();
    res.json({ user });
  }),
);

/* ── Invites ──────────────────────────────────────────────────── */

/** Look up an invite so the page can greet the person by name before they set a
 *  password. Returns 401 for anything invalid — an invite token is a credential. */
authRouter.get(
  '/invite/:token',
  signInLimiter,
  asyncHandler(async (req, res) => {
    const row = await findInvite(String(req.params.token));
    res.json({ name: row.name, email: row.email });
  }),
);

const acceptSchema = z.object({
  token: z.string().min(16, 'That invite link is not valid.'),
  password: z.string().min(1, 'Choose a password.'),
});

authRouter.post(
  '/accept-invite',
  signInLimiter,
  asyncHandler(async (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0].message, { field: 'password' });
    const { token, password } = parsed.data;

    const row = await findInvite(token);
    const problem = passwordProblem(password, { email: row.email, name: row.name });
    if (problem) throw badRequest(problem, { field: 'password' });

    const hash = await hashPassword(password);
    await tx(async (conn) => {
      await execute(
        `UPDATE users
            SET password_hash = ?, password_set_at = ?, invite_token_hash = NULL,
                invite_expires_at = NULL, invite_accepted_at = ?, failed_login_count = 0,
                locked_until = NULL, updated_at = ?
          WHERE id = ?`,
        [hash, new Date(), new Date(), new Date(), row.id],
        conn,
      );
      // Any session predating the password being set is not this person's.
      await endAllSessionsFor(row.id, conn);
    });

    await startSession(res, row, { ip: req.ip, userAgent: req.get('user-agent') ?? '' });
    res.json({ user: publicUser(row) });
  }),
);

async function findInvite(token: string): Promise<UserRow> {
  if (!token || token.length < 16) throw unauthorized('That invite link is not valid.');
  const row = await queryOne<UserRow>(
    `SELECT id, email, name, title, role, active, password_hash, failed_login_count,
            locked_until, invite_expires_at
       FROM users WHERE invite_token_hash = ?`,
    [hashToken(token)],
  );
  if (!row || !row.active) throw unauthorized('That invite link is not valid.');
  const expires = (row as UserRow & { invite_expires_at: Date | null }).invite_expires_at;
  if (!expires || new Date(expires).getTime() <= Date.now()) {
    throw unauthorized(`That invite link has expired. Ask an administrator for a new one.`);
  }
  return row;
}

/* ── Change password ──────────────────────────────────────────── */

const changeSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: z.string().min(1, 'Choose a new password.'),
});

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest(parsed.error.issues[0].message, { field: parsed.error.issues[0].path[0] as string });
    const { currentPassword, newPassword } = parsed.data;
    const me = req.user!;

    const row = await queryOne<UserRow>('SELECT id, email, name, password_hash FROM users WHERE id = ?', [me.id]);
    if (!row || !(await verifyPassword(row.password_hash, currentPassword))) {
      throw unauthorized('Your current password is not correct.');
    }

    const problem = passwordProblem(newPassword, { email: row.email, name: row.name });
    if (problem) throw badRequest(problem, { field: 'newPassword' });
    if (await verifyPassword(row.password_hash, newPassword)) {
      throw badRequest('That is the password you are already using.', { field: 'newPassword' });
    }

    const hash = await hashPassword(newPassword);
    await tx(async (conn) => {
      await execute(
        'UPDATE users SET password_hash = ?, password_set_at = ?, updated_at = ? WHERE id = ?',
        [hash, new Date(), new Date(), me.id],
        conn,
      );
      // Changing a password signs out every other device — the usual reason to
      // change one is that you think somebody else has it.
      await endAllSessionsFor(me.id, conn);
    });
    await startSession(res, { id: me.id }, { ip: req.ip, userAgent: req.get('user-agent') ?? '' });
    res.json({ ok: true });
  }),
);

export const authConfig = { inviteTtlHours: env.INVITE_TTL_HOURS };
