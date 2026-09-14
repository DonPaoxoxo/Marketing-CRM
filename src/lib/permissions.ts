import { PERMISSIONS, ROLES, type Permission, type RoleName } from './types';

/** Permissions.
 *
 *  `ROLE_PERMISSIONS` holds the DEFAULTS: what each role starts with. The live
 *  workspace stores each role's permissions, and extra permissions for individual
 *  people, in the database (migration 008), and the System Administrator edits
 *  them in Roles & Audit. The server resolves every signed-in person's effective
 *  permissions and checks them on every request; the browser receives the same
 *  list so it can hide what the server would refuse.
 *
 *  Two things never move:
 *   - the System Administrator always has every permission;
 *   - LOCKED_PERMISSIONS (managing users, and with it the permission editor) can
 *     be held by no one else, so nobody can be locked out of their own workspace. */

export const SYSTEM_ADMIN_ROLE: RoleName = 'System Administrator';

export const LOCKED_PERMISSIONS: readonly Permission[] = ['manage:users'];

/** What a role may be given in the editor. */
export const GRANTABLE_PERMISSIONS: readonly Permission[] = PERMISSIONS.filter((p) => !LOCKED_PERMISSIONS.includes(p));

/** Roles whose permissions can be edited. */
export const EDITABLE_ROLES: readonly RoleName[] = ROLES.filter((r) => r !== SYSTEM_ADMIN_ROLE);

export const ROLE_PERMISSIONS: Record<RoleName, Permission[]> = {
  'System Administrator': [...PERMISSIONS],
  'Marketing Manager': [
    'view:contact-details',
    'edit:resources',
    'assign:resources',
    'import:records',
    'export:data',
    'request:credential-access',
    'archive:records',
  ],
  // Staff can add SIMs, accounts and agents one at a time, so importing them in
  // bulk gives no new reach. Exporting would, and stays with managers. Archiving
  // was added at the owner's request (2026-09-14); the agent edit lock still limits
  // it to the agents a person manages.
  'Marketing Staff': ['view:contact-details', 'edit:resources', 'import:records', 'request:credential-access', 'archive:records'],
  'Read-only Reviewer': [],
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  'view:contact-details': 'View contact details',
  'edit:resources': 'Edit resources',
  'assign:resources': 'Assign resources',
  'import:records': 'Import records in bulk (SIM bulk upload)',
  'export:data': 'Export data',
  'manage:credential-refs': 'Manage credential references',
  'request:credential-access': 'Request credential access',
  'archive:records': 'Archive and restore records',
  'manage:users': 'Manage user accounts and permissions',
  'access:domains': 'Open Domains',
  'access:import': 'Open Import',
  'access:credential-refs': 'Open Credential Refs',
  'access:roles-audit': 'Open Roles & Audit',
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  'System Administrator': 'Everything, always — including user accounts and this permission editor, which no other role can be given.',
  'Marketing Manager': 'Manages resources and assignments. Edits only the agents assigned to them; can archive or restore any agent.',
  'Marketing Staff': 'Day-to-day editing, SIM bulk uploads and archiving. Edits only the agents assigned to them; can archive or restore any agent.',
  'Read-only Reviewer': 'Can browse records. Contact details are masked; no mutations.',
};

/** Someone whose permissions are being checked. `permissions` is their resolved
 *  list; without it (the mock preview, a test) the role's defaults apply. */
export interface PermissionHolder {
  role: RoleName;
  permissions?: readonly Permission[] | null;
}

export function hasPermission(holder: PermissionHolder | null | undefined, permission: Permission): boolean {
  if (!holder) return false;
  if (holder.role === SYSTEM_ADMIN_ROLE) return true;
  if (LOCKED_PERMISSIONS.includes(permission)) return false;
  return (holder.permissions ?? ROLE_PERMISSIONS[holder.role] ?? []).includes(permission);
}

/** A person's effective permissions: their role's (stored, or the defaults when
 *  nothing is stored) plus any granted to them individually. */
export function resolvePermissions(role: RoleName, rolePermissions: readonly Permission[] | null | undefined, extras: readonly Permission[] = []): Permission[] {
  if (role === SYSTEM_ADMIN_ROLE) return [...PERMISSIONS];
  const base = rolePermissions ?? ROLE_PERMISSIONS[role] ?? [];
  return PERMISSIONS.filter((p) => !LOCKED_PERMISSIONS.includes(p) && (base.includes(p) || extras.includes(p)));
}

/** Only real, grantable permission names survive; anything else sent is ignored. */
export const cleanPermissionList = (list: unknown): Permission[] =>
  Array.isArray(list) ? GRANTABLE_PERMISSIONS.filter((p) => list.includes(p)) : [];

export function roleCan(role: RoleName, permission: Permission): boolean {
  return hasPermission({ role }, permission);
}
