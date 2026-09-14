/** Who may open and change what, beyond the plain permission matrix.
 *
 *  Shared by the browser (to hide and disable), the mock API and the real server
 *  (to refuse). The browser side is a courtesy; the server is the authority. */

import { SYSTEM_ADMIN_ROLE, hasPermission, type PermissionHolder } from './permissions';
import type { Agent, Bootstrap, Permission, RoleName } from './types';

export const ADMIN_ROLE: RoleName = SYSTEM_ADMIN_ROLE;

/** The restricted pages and the permission that opens each. Their data is also
 *  left out of the workspace payload for anyone without it. */
export const AREA_PERMISSIONS = {
  '/domains': 'access:domains',
  '/import': 'access:import',
  '/credentials': 'access:credential-refs',
  '/audit': 'access:roles-audit',
} as const satisfies Record<string, Permission>;

/** Audit history that belongs to a restricted area, by record type. */
export const AUDIT_TYPE_PERMISSIONS: Record<string, Permission> = {
  Domain: 'access:domains',
  Import: 'access:import',
  'Credential Reference': 'access:credential-refs',
  User: 'access:roles-audit',
  Role: 'access:roles-audit',
  'Team Report': 'access:roles-audit',
  Spiel: 'access:roles-audit',
  'Spiel Document': 'access:roles-audit',
  'Spiel Category': 'access:roles-audit',
  'AI Assistant': 'access:roles-audit',
  'AI Settings': 'access:roles-audit',
};

export const isAdmin = (role: RoleName | undefined | null) => role === ADMIN_ROLE;

interface Person extends PermissionHolder { id: string }

/** An agent is edited by its assigned manager or by the System Administrator.
 *  An agent with no manager is edited by the System Administrator only, who can
 *  assign one. The person still needs the edit permission for their role. */
export function mayEditAgent(person: Person | null | undefined, agent: Pick<Agent, 'managerId'> | null | undefined): boolean {
  if (!person || !agent) return false;
  if (isAdmin(person.role)) return true;
  if (!hasPermission(person, 'edit:resources')) return false;
  return Boolean(agent.managerId) && agent.managerId === person.id;
}

/** Archiving or restoring an agent is open to every member whose role may archive
 *  records (by default Marketing Staff, Marketing Managers and the System
 *  Administrator), whoever the assigned manager is — the owner's decision on
 *  2026-09-14. Editing the agent's details stays with the manager lock above. */
export function mayArchiveAgent(person: PermissionHolder | null | undefined): boolean {
  if (!person) return false;
  if (isAdmin(person.role)) return true;
  return hasPermission(person, 'edit:resources') && hasPermission(person, 'archive:records');
}

/** A request that only archives or restores: `archived` (and its reason), nothing else.
 *  Anything more is an edit and goes through the manager lock. */
export function isArchiveOnlyChange(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body).filter((k) => k !== 'reason');
  return keys.length === 1 && keys[0] === 'archived' && typeof body.archived === 'boolean';
}

/** Why the edit controls are disabled, in words for a tooltip or a refusal. */
export function agentLockReason(
  person: Person | null | undefined,
  agent: Pick<Agent, 'managerId'>,
  managerName: string,
): string | null {
  if (mayEditAgent(person, agent)) return null;
  if (!agent.managerId) return 'This agent has no manager yet. Only the System Administrator can edit it.';
  return `Only ${managerName} (the assigned manager) or the System Administrator can edit this agent.`;
}

/** The workspace as a person is allowed to see it. */
export function bootstrapFor(data: Bootstrap, holder: PermissionHolder): Bootstrap {
  if (isAdmin(holder.role)) return data;
  return {
    ...data,
    domains: hasPermission(holder, 'access:domains') ? data.domains : [],
    auditEntries: data.auditEntries.filter((a) => {
      const needed = AUDIT_TYPE_PERMISSIONS[a.recordType];
      return !needed || hasPermission(holder, needed);
    }),
  };
}
