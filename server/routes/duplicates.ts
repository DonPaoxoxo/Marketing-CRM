/** Is this phone number or URL already on another live record?
 *
 *  URL comparison has to go through `urlKey`, which SQL cannot do — so the live
 *  candidates are read and compared here. Registers are hundreds to a few
 *  thousand rows, so this is a small read; if they grow far beyond that, store
 *  the key in its own indexed column instead.
 *
 *  Only *live* records count. An archived record keeps its number and URL for
 *  history, and a SIM or page can legitimately come back on a new record.
 *
 *  Like the other uniqueness checks, two saves arriving in the same instant can
 *  both pass; the duplicate report catches the rare result. */

import type { RowDataPacket } from 'mysql2/promise';
import { query, queryOne } from '../db/pool';
import { conflict, badRequest } from '../http/errors';
import { firstRepeat, pageUrlKey, phoneKey, postUrlKey } from '../../src/lib/identity';

export interface Holder { id: string; label: string }

/** A value only needs checking when it is new or its key actually changed —
 *  otherwise a record that already clashes with an older one (from before these
 *  checks existed) could never be edited at all, even to fix the clash. */
export const keyChanged = (key: (v: string) => string, before: string | undefined, after: string) =>
  key(after) !== '' && key(after) !== key(before ?? '');

/** A live SIM already holding this email or Telegram username. The sheet
 *  treats each as belonging to one SIM, and so does the register. */
export async function simExtraHolder(
  column: 'email' | 'telegram_username', key: string, exceptId?: string,
): Promise<Holder | null> {
  if (!key) return null;
  const rows = await query<RowDataPacket>(
    `SELECT id FROM sims WHERE archived = 0 AND LOWER(${column}) = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`,
    exceptId ? [key, exceptId] : [key],
  );
  return rows.length ? { id: String(rows[0].id), label: String(rows[0].id) } : null;
}

export async function profileUrlHolder(url: string, exceptId?: string): Promise<Holder | null> {
  const key = pageUrlKey(url);
  if (!key) return null;
  const rows = await query<RowDataPacket>(
    `SELECT id, username, profile_url FROM social_accounts
      WHERE archived = 0 AND profile_url <> '' ${exceptId ? 'AND id <> ?' : ''}`,
    exceptId ? [exceptId] : [],
  );
  const hit = rows.find((r) => pageUrlKey(String(r.profile_url)) === key);
  return hit ? { id: String(hit.id), label: `${hit.id} (@${hit.username})` } : null;
}

export async function postUrlHolder(url: string, exceptId?: string): Promise<Holder | null> {
  const key = postUrlKey(url);
  if (!key) return null;
  const rows = await query<RowDataPacket>(
    `SELECT id, title, url FROM content_posts
      WHERE archived = 0 AND url <> '' ${exceptId ? 'AND id <> ?' : ''}`,
    exceptId ? [exceptId] : [],
  );
  const hit = rows.find((r) => postUrlKey(String(r.url)) === key);
  return hit ? { id: String(hit.id), label: `${hit.id} (“${hit.title}”)` } : null;
}

export async function agentPhoneHolder(phone: string, exceptId?: string): Promise<Holder | null> {
  const key = phoneKey(phone);
  if (!key) return null;
  const rows = await query<RowDataPacket>(
    `SELECT id, name, contact_number FROM agents
      WHERE archived = 0 AND contact_number <> '' ${exceptId ? 'AND id <> ?' : ''}`,
    exceptId ? [exceptId] : [],
  );
  const hit = rows.find((r) => phoneKey(String(r.contact_number)) === key);
  return hit ? { id: String(hit.id), label: `${hit.id} (${hit.name})` } : null;
}

/** Another live agent already holding this typed-in UID. */
export async function agentUidHolder(uid: string, exceptId?: string): Promise<Holder | null> {
  const value = uid.trim();
  if (!value) return null;
  const row = await queryOne<RowDataPacket>(
    `SELECT id, name FROM agents WHERE archived = 0 AND external_uid = ? ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`,
    exceptId ? [value, exceptId] : [value],
  );
  return row ? { id: String(row.id), label: `${row.id} (${row.name})` } : null;
}

/** The first of these channel URLs already listed on another live agent. */
export async function agentChannelHolder(urls: readonly string[], exceptId?: string): Promise<(Holder & { url: string }) | null> {
  const wanted = new Map(urls.map((u) => [pageUrlKey(u), u] as const).filter(([k]) => k));
  if (!wanted.size) return null;
  const rows = await query<RowDataPacket>(
    `SELECT c.agent_id, a.name, c.url FROM agent_channels c
       JOIN agents a ON a.id = c.agent_id
      WHERE a.archived = 0 ${exceptId ? 'AND a.id <> ?' : ''}`,
    exceptId ? [exceptId] : [],
  );
  for (const r of rows) {
    const url = wanted.get(pageUrlKey(String(r.url)));
    if (url) return { id: String(r.agent_id), label: `${r.agent_id} (${r.name})`, url };
  }
  return null;
}

/** Refuses a list that names the same page twice. */
export function assertNoRepeatedUrl(urls: readonly string[], field: string): void {
  const repeat = firstRepeat(urls, pageUrlKey);
  if (repeat) throw badRequest(`${repeat} is listed twice.`, { field });
}

export const taken = (what: string, holder: Holder, field: string) =>
  conflict(`This ${what} is already registered on ${holder.label}.`, { field, conflictId: holder.id });
