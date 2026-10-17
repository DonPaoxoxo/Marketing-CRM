/** Reminds every System Administrator in-app, one day before a domain's
 *  manually-set next rotation date — see server/index.ts's periodic sweep.
 *  Dedup: skips a domain already reminded today, so an hourly sweep never
 *  repeats the same notification. */

import type { RowDataPacket } from 'mysql2/promise';
import { query, tx } from './db/pool';
import { notify, systemAdministratorIds } from './notifications';

const KIND = 'domain-rotation-reminder';

export async function checkDomainRotationReminders(): Promise<void> {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowDate = tomorrow.toISOString().slice(0, 10);

  const due = await query<RowDataPacket>(
    'SELECT id, domain_name, domain_type FROM domain_monitors WHERE next_rotation_date = ? AND archived = 0',
    [tomorrowDate],
  );
  if (!due.length) return;

  const alreadyNotified = await query<RowDataPacket>(
    `SELECT DISTINCT record_id FROM notifications
      WHERE kind = ? AND DATE(created_at) = CURDATE() AND record_id IN (${due.map(() => '?').join(', ')})`,
    [KIND, ...due.map((d) => String(d.id))],
  );
  const notifiedIds = new Set(alreadyNotified.map((r) => String(r.record_id)));
  const pending = due.filter((d) => !notifiedIds.has(String(d.id)));
  if (!pending.length) return;

  await tx(async (conn) => {
    const adminIds = await systemAdministratorIds(conn);
    if (!adminIds.length) return;
    for (const d of pending) {
      await notify(conn, adminIds, {
        kind: KIND,
        title: `Rotate ${String(d.domain_name)} tomorrow`,
        body: `${String(d.domain_type)} Domain — next rotation date is ${tomorrowDate}.`,
        link: '/domain-monitoring',
        recordType: 'Domain Monitor',
        recordId: String(d.id),
      });
    }
  });
}
