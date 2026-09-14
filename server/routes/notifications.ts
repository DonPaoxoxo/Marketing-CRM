/** A person's own notifications. Every query is scoped to the session user, so a
 *  guessed id belonging to someone else matches nothing. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import type { AppNotification } from '../../src/lib/spiels';
import { execute, query, queryOne } from '../db/pool';
import { requireAuth } from '../auth/middleware';
import { asyncHandler, notFound } from '../http/errors';
import { iso, isoRequired, text } from '../repositories/mappers';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', asyncHandler(async (req, res) => {
  const userId = req.user!.id;
  const [rows, unread] = await Promise.all([
    query<RowDataPacket>('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [userId]),
    queryOne<RowDataPacket>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]),
  ]);
  const notifications: AppNotification[] = rows.map((r) => ({
    id: String(r.id), kind: text(r.kind), title: text(r.title), body: text(r.body), link: text(r.link),
    readAt: iso(r.read_at), createdAt: isoRequired(r.created_at),
  }));
  res.json({ notifications, unread: Number(unread?.n ?? 0) });
}));

notificationsRouter.post('/read-all', asyncHandler(async (req, res) => {
  await execute('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', [new Date(), req.user!.id]);
  res.json({ ok: true });
}));

notificationsRouter.post('/:id/read', asyncHandler(async (req, res) => {
  const result = await execute('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?', [new Date(), String(req.params.id), req.user!.id]);
  if (!result.affectedRows) throw notFound('Notification not found.');
  res.json({ ok: true });
}));
