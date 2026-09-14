/** The permission editor's API.
 *
 *  Reading the matrix needs Roles & Audit access; changing anything needs
 *  'manage:users', which only the System Administrator can ever hold. The System
 *  Administrator role itself and 'manage:users' cannot be granted or edited here. */

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { execute, query, queryOne, tx } from '../db/pool';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { invalidatePermissionCache, loadRolePermissions } from '../auth/permissions';
import { asyncHandler, badRequest, notFound } from '../http/errors';
import { actorOf, bodyOf } from './helpers';
import {
  EDITABLE_ROLES, GRANTABLE_PERMISSIONS, LOCKED_PERMISSIONS, ROLE_PERMISSIONS, SYSTEM_ADMIN_ROLE, cleanPermissionList, resolvePermissions,
} from '../../src/lib/permissions';
import type { Permission, RoleName } from '../../src/lib/types';

export const permissionsRouter = Router();

async function snapshot() {
  const stored = await loadRolePermissions();
  const roles = Object.fromEntries(EDITABLE_ROLES.map((r) => [r, stored.get(r) ?? ROLE_PERMISSIONS[r]]));
  const extras = await query<RowDataPacket>('SELECT user_id, permission FROM user_permissions ORDER BY user_id, permission');
  const users: Record<string, Permission[]> = {};
  for (const e of extras) (users[String(e.user_id)] ??= []).push(String(e.permission) as Permission);
  return { grantable: GRANTABLE_PERMISSIONS, locked: LOCKED_PERMISSIONS, editableRoles: EDITABLE_ROLES, roles, users };
}

permissionsRouter.get('/', requirePermission('access:roles-audit'), asyncHandler(async (_req, res) => {
  res.json(await snapshot());
}));

const diff = (before: readonly Permission[], after: readonly Permission[]) => ({
  added: after.filter((p) => !before.includes(p)),
  removed: before.filter((p) => !after.includes(p)),
});

permissionsRouter.put('/roles/:role', requirePermission('manage:users'), asyncHandler(async (req, res) => {
  const role = decodeURIComponent(String(req.params.role)) as RoleName;
  if (role === SYSTEM_ADMIN_ROLE) throw badRequest('The System Administrator always has every permission and cannot be edited.');
  if (!EDITABLE_ROLES.includes(role)) throw notFound('Unknown role.');
  const body = bodyOf<{ permissions?: unknown; reason?: unknown }>(req);
  if (!Array.isArray(body.permissions)) throw badRequest('Send the full list of permissions for the role.', { field: 'permissions' });
  const next = cleanPermissionList(body.permissions);
  const before = (await loadRolePermissions()).get(role) ?? ROLE_PERMISSIONS[role];
  const { added, removed } = diff(before, next);
  const actor = actorOf(req);

  await tx(async (conn) => {
    await execute('DELETE FROM role_permissions WHERE role = ?', [role], conn);
    const rows = next.length ? next : [''];
    for (const permission of rows) {
      await execute('INSERT INTO role_permissions (role, permission, updated_by, updated_at) VALUES (?, ?, ?, ?)', [role, permission, actor.id, new Date()], conn);
    }
    if (added.length || removed.length) {
      await recordAudit(conn, {
        actor, recordType: 'Role', recordId: role, recordLabel: role, action: 'update',
        reason: String(body.reason ?? '').trim().slice(0, 500) || 'Role permissions changed',
        changes: [...added.map((p) => ({ field: p, from: 'not allowed', to: 'allowed' })), ...removed.map((p) => ({ field: p, from: 'allowed', to: 'not allowed' }))],
      });
    }
  });
  invalidatePermissionCache();
  res.json(await snapshot());
}));

permissionsRouter.put('/users/:id', requirePermission('manage:users'), asyncHandler(async (req, res) => {
  const userId = String(req.params.id);
  const user = await queryOne<RowDataPacket>('SELECT id, name, role FROM users WHERE id = ?', [userId]);
  if (!user) throw notFound('User not found.');
  if (user.role === SYSTEM_ADMIN_ROLE) throw badRequest('A System Administrator already has every permission.');
  const body = bodyOf<{ permissions?: unknown; reason?: unknown }>(req);
  if (!Array.isArray(body.permissions)) throw badRequest('Send the full list of extra permissions for this person.', { field: 'permissions' });
  const roleList = (await loadRolePermissions()).get(user.role as RoleName) ?? ROLE_PERMISSIONS[user.role as RoleName] ?? [];
  // Extras are only what the role does not already give.
  const next = cleanPermissionList(body.permissions).filter((p) => !roleList.includes(p));
  const beforeRows = await query<RowDataPacket>('SELECT permission FROM user_permissions WHERE user_id = ?', [userId]);
  const before = beforeRows.map((r) => String(r.permission) as Permission);
  const { added, removed } = diff(before, next);
  const actor = actorOf(req);

  await tx(async (conn) => {
    await execute('DELETE FROM user_permissions WHERE user_id = ?', [userId], conn);
    for (const permission of next) {
      await execute('INSERT INTO user_permissions (user_id, permission, granted_by, granted_at) VALUES (?, ?, ?, ?)', [userId, permission, actor.id, new Date()], conn);
    }
    if (added.length || removed.length) {
      await recordAudit(conn, {
        actor, recordType: 'User', recordId: userId, recordLabel: String(user.name), action: 'update',
        reason: String(body.reason ?? '').trim().slice(0, 500) || 'Individual permissions changed',
        changes: [...added.map((p) => ({ field: p, from: 'not granted', to: 'granted' })), ...removed.map((p) => ({ field: p, from: 'granted', to: 'not granted' }))],
      });
    }
  });
  res.json({ ...(await snapshot()), effective: resolvePermissions(user.role as RoleName, roleList, next) });
}));
