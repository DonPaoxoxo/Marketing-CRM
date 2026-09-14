/** Live permissions: each role's stored list plus a person's individual grants.
 *
 *  Role lists change rarely and are read on every request, so they are cached in
 *  memory and dropped whenever the editor saves (this app runs as one process).
 *  A short expiry covers a change made by another process, such as a migration. */

import type { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import { resolvePermissions } from '../../src/lib/permissions';
import { ROLES, type Permission, type RoleName } from '../../src/lib/types';

const TTL_MS = 30_000;
let cache: { at: number; roles: Map<RoleName, Permission[]> } | null = null;

export function invalidatePermissionCache(): void {
  cache = null;
}

/** Each editable role's stored permissions. A role with no stored rows at all has
 *  never been saved and keeps its defaults (null); after a save, an empty list
 *  is stored as a single marker row so "nothing" stays nothing. */
export async function loadRolePermissions(): Promise<Map<RoleName, Permission[]>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.roles;
  const rows = await query<RowDataPacket>('SELECT role, permission FROM role_permissions');
  const roles = new Map<RoleName, Permission[]>();
  for (const r of rows) {
    const role = String(r.role) as RoleName;
    if (!ROLES.includes(role)) continue;
    const list = roles.get(role) ?? [];
    if (r.permission !== '') list.push(String(r.permission) as Permission);
    roles.set(role, list);
  }
  cache = { at: Date.now(), roles };
  return roles;
}

export async function loadUserExtras(userId: string): Promise<Permission[]> {
  const rows = await query<RowDataPacket>('SELECT permission FROM user_permissions WHERE user_id = ?', [userId]);
  return rows.map((r) => String(r.permission) as Permission);
}

export async function permissionsFor(userId: string, role: RoleName): Promise<Permission[]> {
  const [roles, extras] = await Promise.all([loadRolePermissions(), loadUserExtras(userId)]);
  return resolvePermissions(role, roles.get(role) ?? null, extras);
}
