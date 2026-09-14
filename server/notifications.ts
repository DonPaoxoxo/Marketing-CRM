/** In-app notifications: a row per recipient, written in the caller's transaction
 *  so a rolled-back change never announces itself. */

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { execute, query } from './db/pool';
import { nextId } from './db/ids';
import { SYSTEM_ADMIN_ROLE } from '../src/lib/permissions';

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string;
  link?: string;
  recordType?: string;
  recordId?: string;
}

/** Active System Administrators, optionally leaving out the person who acted. */
export async function systemAdministratorIds(conn: PoolConnection, exceptId?: string): Promise<string[]> {
  const rows = await query<RowDataPacket>('SELECT id FROM users WHERE role = ? AND active = 1', [SYSTEM_ADMIN_ROLE], conn);
  return rows.map((r) => String(r.id)).filter((id) => id !== exceptId);
}

export async function notify(conn: PoolConnection, userIds: string[], input: NotificationInput): Promise<void> {
  const now = new Date();
  for (const userId of new Set(userIds)) {
    const id = await nextId('NTF', conn);
    await execute(
      `INSERT INTO notifications (id, user_id, kind, title, body, link, record_type, record_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, input.kind.slice(0, 40), input.title.slice(0, 200), (input.body ?? '').slice(0, 2000), (input.link ?? '').slice(0, 300),
        (input.recordType ?? '').slice(0, 40), (input.recordId ?? '').slice(0, 24), now],
      conn,
    );
  }
}

export async function notifyAdministrators(conn: PoolConnection, actorId: string, input: NotificationInput): Promise<void> {
  await notify(conn, await systemAdministratorIds(conn, actorId), input);
}
