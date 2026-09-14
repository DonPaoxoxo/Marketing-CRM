/** Server-side sessions.
 *
 *  The cookie holds an opaque random token; the table holds only its SHA-256.
 *  That means a database dump contains no usable sessions, and signing someone
 *  out is a DELETE rather than a wait for a token to expire. */

import type { Request, Response } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { env } from '../env';
import { execute, query, queryOne } from '../db/pool';
import { hashToken, issueToken } from './credentials';
import type { Permission, RoleName } from '../../src/lib/types';
import { permissionsFor } from './permissions';

export const SESSION_COOKIE = 'mrcrm_session';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  title: string;
  role: RoleName;
  active: boolean;
  /** Effective permissions: the role's stored list plus individual grants. */
  permissions: Permission[];
}

interface SessionRow extends RowDataPacket {
  user_id: string;
  expires_at: Date;
  email: string;
  name: string;
  title: string;
  role: string;
  active: number;
}

function expiryFromNow(): Date {
  return new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000);
}

/** Issue a session and set the cookie. Returns nothing useful on purpose — the
 *  token exists only inside the cookie. */
export async function startSession(
  res: Response,
  user: { id: string },
  meta: { ip?: string; userAgent?: string } = {},
  conn?: PoolConnection,
): Promise<void> {
  const { token, hash } = issueToken();
  const now = new Date();
  await execute(
    `INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [hash, user.id, now, now, expiryFromNow(), (meta.ip ?? '').slice(0, 45), (meta.userAgent ?? '').slice(0, 255)],
    conn,
  );

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,              // unreadable from JavaScript, so XSS cannot lift it
    secure: env.cookieSecure,
    sameSite: 'lax',             // survives normal navigation, blocks cross-site POSTs
    path: '/',
    maxAge: env.SESSION_TTL_HOURS * 3_600_000,
  });
}

/** Resolve the caller from the cookie, or null.
 *
 *  Expired rows are treated as absent and cleaned up as they are found, so an
 *  abandoned session does not linger indefinitely. */
export async function readSession(req: Request): Promise<SessionUser | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== 'string' || token.length < 16) return null;

  const id = hashToken(token);
  const row = await queryOne<SessionRow>(
    `SELECT s.user_id, s.expires_at, u.email, u.name, u.title, u.role, u.active
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
    [id],
  );
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await execute('DELETE FROM sessions WHERE id = ?', [id]);
    return null;
  }
  // A deactivated account loses access immediately, without waiting for expiry.
  if (!row.active) {
    await execute('DELETE FROM sessions WHERE user_id = ?', [row.user_id]);
    return null;
  }

  // Sliding expiry, written at most once a minute so a busy session does not
  // turn every request into a write.
  await execute(
    'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND last_seen_at < ?',
    [new Date(), expiryFromNow(), id, new Date(Date.now() - 60_000)],
  );

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    title: row.title,
    role: row.role as RoleName,
    active: Boolean(row.active),
    permissions: await permissionsFor(row.user_id, row.role as RoleName),
  };
}

export async function endSession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token === 'string') {
    await execute('DELETE FROM sessions WHERE id = ?', [hashToken(token)]);
  }
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Sign a user out everywhere — used on password change and deactivation. */
export async function endAllSessionsFor(userId: string, conn?: PoolConnection): Promise<void> {
  await execute('DELETE FROM sessions WHERE user_id = ?', [userId], conn);
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await execute('DELETE FROM sessions WHERE expires_at <= ?', [new Date()]);
  return result.affectedRows;
}

export async function listSessionsFor(userId: string) {
  return query<RowDataPacket>(
    'SELECT id, created_at, last_seen_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC',
    [userId],
  );
}
