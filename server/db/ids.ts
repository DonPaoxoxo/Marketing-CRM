/** Readable identifier allocation.
 *
 *  The app's ids (SIM-0001, ACC-0231) appear in URLs, cross-references and
 *  exports, so they stay the primary key. `MAX(id) + 1` would hand the same id to
 *  two concurrent writers; this takes it from a counter row inside the caller's
 *  transaction instead. */

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { execute, queryOne } from './pool';

export type IdPrefix =
  | 'TM' | 'SIM' | 'AGT' | 'ACC' | 'CRD' | 'ASG' | 'DOM' | 'FSN' | 'CNT' | 'AUD' | 'BRD' | 'PRJ' | 'PRF' | 'RPT' | 'RPF' | 'RPR' | 'ADC' | 'ADR' | 'ADK' | 'ADF' | 'ADI' | 'ADU'
  | 'SCT' | 'SPL' | 'SPV' | 'SPA' | 'SPC' | 'SPD' | 'SPDV' | 'NTF' | 'AIR' | 'CMP';

/** Reserve the next id for a prefix.
 *
 *  Uses MySQL's LAST_INSERT_ID(expr) trick: the UPDATE both increments the counter
 *  and stashes the pre-increment value on the connection, so reserving and reading
 *  it is a single atomic step with no SELECT ... FOR UPDATE round trip.
 *
 *  Must be called with the same connection as the insert it is for, so an aborted
 *  transaction gives the number back. */
export async function nextId(prefix: IdPrefix, conn: PoolConnection): Promise<string> {
  const updated = await execute(
    'UPDATE id_sequences SET next_value = LAST_INSERT_ID(next_value) + 1 WHERE prefix = ?',
    [prefix],
    conn,
  );
  if (updated.affectedRows === 0) {
    throw new Error(`Unknown id prefix "${prefix}" — add it to id_sequences.`);
  }

  const row = await queryOne<RowDataPacket>(
    'SELECT LAST_INSERT_ID() AS value, (SELECT width FROM id_sequences WHERE prefix = ?) AS width',
    [prefix],
    conn,
  );
  const value = Number(row?.value ?? 0);
  const width = Number(row?.width ?? 4);
  return `${prefix}-${String(value).padStart(width, '0')}`;
}

/** Move a counter past ids that already exist — used after importing data that
 *  carries its own identifiers, so the next allocation cannot collide. */
export async function advanceSequenceTo(prefix: IdPrefix, atLeast: number, conn: PoolConnection): Promise<void> {
  await execute(
    'UPDATE id_sequences SET next_value = GREATEST(next_value, ?) WHERE prefix = ?',
    [atLeast, prefix],
    conn,
  );
}
