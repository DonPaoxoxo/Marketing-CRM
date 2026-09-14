import { describe, expect, it } from 'vitest';
import { GRANTABLE_PERMISSIONS, ROLE_PERMISSIONS, cleanPermissionList, hasPermission, resolvePermissions } from './permissions';

describe('permissions', () => {
  it('always gives the System Administrator everything, and never gives manage:users to anyone else', () => {
    expect(hasPermission({ role: 'System Administrator', permissions: [] }, 'access:domains')).toBe(true);
    expect(hasPermission({ role: 'Marketing Manager', permissions: ['manage:users'] }, 'manage:users')).toBe(false);
    expect(GRANTABLE_PERMISSIONS).not.toContain('manage:users');
  });

  it('lets Marketing Staff archive by default', () => {
    expect(ROLE_PERMISSIONS['Marketing Staff']).toContain('archive:records');
    expect(hasPermission({ role: 'Marketing Staff' }, 'archive:records')).toBe(true);
  });

  it('uses live permissions when present, role defaults otherwise', () => {
    expect(hasPermission({ role: 'Marketing Staff', permissions: [] }, 'edit:resources')).toBe(false);
    expect(hasPermission({ role: 'Marketing Staff' }, 'edit:resources')).toBe(true);
    expect(hasPermission({ role: 'Read-only Reviewer', permissions: ['access:domains'] }, 'access:domains')).toBe(true);
  });

  it('resolves a role list plus individual extras, dropping locked and unknown names', () => {
    expect(resolvePermissions('Marketing Staff', ['edit:resources'], ['access:domains', 'manage:users'])).toEqual(['edit:resources', 'access:domains']);
    expect(resolvePermissions('Read-only Reviewer', null, [])).toEqual([]);
    expect(cleanPermissionList(['export:data', 'root:everything', 'manage:users'])).toEqual(['export:data']);
  });
});
