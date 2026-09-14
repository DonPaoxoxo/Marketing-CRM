/** MySQL connection pool and the two helpers everything else uses.
 *
 *  Every query goes through `query`/`tx` so that parameter binding is never
 *  optional — string-concatenated SQL is the one thing that must not be possible
 *  anywhere in this server. */

import mysql, {
  type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader,
} from 'mysql2/promise';

/** mysql2 types its bind parameters narrowly; callers legitimately pass dates,
 *  nulls and numbers, so they are widened once here rather than at every site. */
type BindValue = Parameters<Pool['execute']>[1];
import { env } from '../env';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  pool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 10,
    // DATE columns come back as 'YYYY-MM-DD' strings rather than Date objects,
    // which is what the domain model uses throughout and avoids a timezone
    // round-trip turning a date into the day before.
    dateStrings: ['DATE'],
    timezone: 'Z',
    charset: 'utf8mb4',
    // Guards against a query that accidentally carries more than one statement.
    multipleStatements: false,
    supportBigNumbers: true,
  });
  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

/** A parameterised read. `params` is always bound, never interpolated. */
export async function query<T extends RowDataPacket>(
  sql: string,
  params: readonly unknown[] = [],
  conn?: PoolConnection,
): Promise<T[]> {
  const runner = conn ?? getPool();
  const [rows] = await runner.execute<T[]>(sql, params as BindValue);
  return rows;
}

export async function queryOne<T extends RowDataPacket>(
  sql: string,
  params: readonly unknown[] = [],
  conn?: PoolConnection,
): Promise<T | null> {
  const rows = await query<T>(sql, params, conn);
  return rows[0] ?? null;
}

export async function execute(
  sql: string,
  params: readonly unknown[] = [],
  conn?: PoolConnection,
): Promise<ResultSetHeader> {
  const runner = conn ?? getPool();
  const [result] = await runner.execute<ResultSetHeader>(sql, params as BindValue);
  return result;
}

/** Run a unit of work in a transaction, rolling back on any throw.
 *
 *  Writes that touch more than one table — an assignment plus the resource's
 *  allocation status, a snapshot plus the account's follower figure — must go
 *  through here, or a failure halfway leaves the register contradicting itself. */
export async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

/** Confirms the database is reachable and is the one we expect. */
export async function checkConnection(): Promise<{ database: string; version: string }> {
  const row = await queryOne<RowDataPacket>('SELECT DATABASE() AS db, VERSION() AS version');
  return { database: String(row?.db ?? ''), version: String(row?.version ?? '') };
}
