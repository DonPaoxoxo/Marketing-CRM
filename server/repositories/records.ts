/** Reading one record back, and writing the lists that live in join tables.
 *
 *  The routes describe *what* changed; the repository owns *where* it is stored.
 *  Column maps and statement building live in `statements.ts`, which has no
 *  database import; everything here needs a connection.
 *
 *  The column maps and builders are re-exported so a route has one place to
 *  import from. */

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { execute, query, queryOne } from '../db/pool';
import {
  mapAccount, mapAgent, mapAssignment, mapCompetitor, mapContentPost, mapCredential, mapDomain, mapSim, mapSnapshot,
} from './mappers';
import type {
  Agent, Assignment, CompetitorRecord, ContentPost, CredentialRef, DomainRecord, FollowerSnapshot, Sim, SocialAccount,
} from '../../src/lib/types';

export * from './statements';

/** Replaces a record's rows in a join table.
 *
 *  Delete-then-insert rather than a diff: these sets are a handful of rows and
 *  the caller is always inside a transaction, so the moment where the set looks
 *  empty is never observable. */
export async function replaceLinks(
  conn: PoolConnection,
  table: string,
  parentColumn: string,
  parentId: string,
  childColumn: string,
  childIds: readonly string[],
): Promise<void> {
  await execute(`DELETE FROM ${table} WHERE ${parentColumn} = ?`, [parentId], conn);
  // A set, so a duplicated id in the request cannot violate the primary key.
  for (const childId of [...new Set(childIds)].filter(Boolean)) {
    await execute(
      `INSERT INTO ${table} (${parentColumn}, ${childColumn}) VALUES (?, ?)`,
      [parentId, childId],
      conn,
    );
  }
}

/** Ordered list replacement — an agent's channel URLs keep their position. */
export async function replaceOrdered(
  conn: PoolConnection,
  table: string,
  parentColumn: string,
  parentId: string,
  valueColumn: string,
  values: readonly string[],
): Promise<void> {
  await execute(`DELETE FROM ${table} WHERE ${parentColumn} = ?`, [parentId], conn);
  for (const [position, value] of values.filter(Boolean).entries()) {
    await execute(
      `INSERT INTO ${table} (${parentColumn}, position, ${valueColumn}) VALUES (?, ?, ?)`,
      [parentId, position, value],
      conn,
    );
  }
}

/* ── Single-record readers ────────────────────────────────────────
 *  Every write answers with the record as stored, read back through the same
 *  mappers the bootstrap payload uses. Echoing the request body instead would
 *  let a column default or a trimmed value disagree with what the client shows
 *  until the next reload. */

const one = (id: string, table: string, conn?: PoolConnection) =>
  queryOne<RowDataPacket>(`SELECT * FROM ${table} WHERE id = ?`, [id], conn);

export async function readSim(id: string, conn?: PoolConnection): Promise<Sim | null> {
  const row = await one(id, 'sims', conn);
  return row ? mapSim(row) : null;
}

export async function readAgent(id: string, conn?: PoolConnection): Promise<Agent | null> {
  const row = await one(id, 'agents', conn);
  if (!row) return null;
  const [brands, projects, channels] = await Promise.all([
    query<RowDataPacket>('SELECT brand_id FROM agent_brands WHERE agent_id = ?', [id], conn),
    query<RowDataPacket>('SELECT project_id FROM agent_projects WHERE agent_id = ?', [id], conn),
    query<RowDataPacket>('SELECT url FROM agent_channels WHERE agent_id = ? ORDER BY position', [id], conn),
  ]);
  return mapAgent(row, {
    brandIds: brands.map((b) => String(b.brand_id)),
    projectIds: projects.map((p) => String(p.project_id)),
    channelUrls: channels.map((c) => String(c.url)),
  });
}

export async function readAccount(id: string, conn?: PoolConnection): Promise<SocialAccount | null> {
  const row = await one(id, 'social_accounts', conn);
  if (!row) return null;
  const sims = await query<RowDataPacket>(
    'SELECT sim_id FROM account_sims WHERE account_id = ?', [id], conn,
  );
  return mapAccount(row, { simIds: sims.map((s) => String(s.sim_id)) });
}

export async function readCredential(id: string, conn?: PoolConnection): Promise<CredentialRef | null> {
  const row = await one(id, 'credentials', conn);
  return row ? mapCredential(row) : null;
}

export async function readAssignment(id: string, conn?: PoolConnection): Promise<Assignment | null> {
  const row = await one(id, 'assignments', conn);
  return row ? mapAssignment(row) : null;
}

export async function readDomain(id: string, conn?: PoolConnection): Promise<DomainRecord | null> {
  const row = await one(id, 'domains', conn);
  return row ? mapDomain(row) : null;
}

export async function readCompetitor(id: string, conn?: PoolConnection): Promise<CompetitorRecord | null> {
  const row = await one(id, 'pakistan_competitors', conn);
  return row ? mapCompetitor(row) : null;
}

export async function readContentPost(id: string, conn?: PoolConnection): Promise<ContentPost | null> {
  const row = await one(id, 'content_posts', conn);
  return row ? mapContentPost(row) : null;
}

export async function readSnapshot(id: string, conn?: PoolConnection): Promise<FollowerSnapshot | null> {
  const row = await one(id, 'follower_snapshots', conn);
  return row ? mapSnapshot(row) : null;
}
