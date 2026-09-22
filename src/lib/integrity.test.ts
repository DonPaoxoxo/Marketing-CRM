import { describe, expect, it } from 'vitest';
import * as fixtures from '@/mocks/fixtures';
import { findIntegrityIssues, summariseIssues } from './integrity';
import type { Bootstrap } from '@/hooks/useData';

const base = (): Bootstrap => structuredClone({
  countries: fixtures.countries,
  platforms: fixtures.platforms,
  brands: fixtures.brands,
  projects: fixtures.projects,
  teamMembers: fixtures.teamMembers,
  sims: fixtures.sims,
  agents: fixtures.agents,
  socialAccounts: fixtures.socialAccounts,
  credentials: fixtures.credentials,
  assignments: fixtures.assignments,
  domains: fixtures.domains,
  followerSnapshots: fixtures.followerSnapshots,
  contentPosts: fixtures.contentPosts,
  agentProofs: [],
  pakistanCompetitors: fixtures.pakistanCompetitors,
  auditEntries: fixtures.auditEntries,
});

const empty = (): Bootstrap => ({
  countries: fixtures.countries, platforms: fixtures.platforms,
  brands: [], projects: [], teamMembers: [], sims: [], agents: [], socialAccounts: [],
  credentials: [], assignments: [], domains: [], followerSnapshots: [], contentPosts: [],
  agentProofs: [], pakistanCompetitors: [], auditEntries: [],
});

const find = (data: Bootstrap, recordId: string, field: string) =>
  findIntegrityIssues(data).find((i) => i.recordId === recordId && i.field === field);

describe('an empty workspace has nothing to report', () => {
  it('finds no issues', () => {
    expect(findIntegrityIssues(empty())).toHaveLength(0);
  });
});

describe('broken references', () => {
  it('catches an account pointing at a brand that was removed', () => {
    const data = base();
    const account = data.socialAccounts.find((a) => a.brandId)!;
    data.brands = data.brands.filter((b) => b.id !== account.brandId);

    const issue = find(data, account.id, 'brand');
    expect(issue).toBeTruthy();
    expect(issue!.severity).toBe('error');
    expect(issue!.category).toBe('Broken reference');
    expect(issue!.message).toMatch(/no longer exists/);
    expect(issue!.to).toBe(`/accounts/${account.id}`);
  });

  it('catches an account whose responsible employee has left', () => {
    const data = base();
    const account = data.socialAccounts.find((a) => a.responsibleTeamMemberId)!;
    data.teamMembers = data.teamMembers.filter((m) => m.id !== account.responsibleTeamMemberId);
    expect(find(data, account.id, 'responsibleEmployee')?.category).toBe('Broken reference');
  });

  it('catches an account linked to a SIM that was deleted', () => {
    const data = base();
    const account = data.socialAccounts.find((a) => a.simIds.length > 0)!;
    const simId = account.simIds[0];
    data.sims = data.sims.filter((s) => s.id !== simId);
    expect(find(data, account.id, `linkedSim:${simId}`)).toBeTruthy();
  });

  it('catches an assignment whose resource is gone', () => {
    const data = base();
    const asg = data.assignments.find((a) => a.resourceType === 'Social Account')!;
    data.socialAccounts = data.socialAccounts.filter((a) => a.id !== asg.resourceId);
    expect(find(data, asg.id, 'resource')?.severity).toBe('error');
  });

  it('catches a credential reference whose account is gone', () => {
    const data = base();
    const cred = data.credentials[0];
    data.socialAccounts = data.socialAccounts.filter((a) => a.id !== cred.resourceId);
    expect(find(data, cred.id, 'resource')).toBeTruthy();
  });

  it('catches a project whose brand is gone', () => {
    const data = base();
    const project = data.projects[0];
    data.brands = data.brands.filter((b) => b.id !== project.brandId);
    expect(find(data, project.id, 'brand')).toBeTruthy();
  });
});

describe('contradictory state is an error, not a blank field', () => {
  it('flags a SIM marked Assigned with nobody assigned', () => {
    const data = base();
    const sim = data.sims[0];
    sim.allocationStatus = 'Assigned';
    sim.assigneeId = null;
    const issue = find(data, sim.id, 'allocationStatus');
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toMatch(/no assignee/i);
  });
});

describe('orphaned growth records', () => {
  it('reports snapshots left behind by a deleted account, counted once', () => {
    const data = base();
    const accountId = data.followerSnapshots[0].accountId;
    const count = data.followerSnapshots.filter((s) => s.accountId === accountId).length;
    data.socialAccounts = data.socialAccounts.filter((a) => a.id !== accountId);

    const issues = findIntegrityIssues(data).filter((i) => i.recordType === 'Follower Snapshot');
    expect(issues).toHaveLength(1);                        // one row, not one per snapshot
    expect(issues[0].message).toContain(String(count));
    expect(issues[0].category).toBe('Orphaned record');
  });

  it('reports a content post whose account is gone', () => {
    const data = base();
    const post = data.contentPosts[0];
    data.socialAccounts = data.socialAccounts.filter((a) => a.id !== post.accountId);
    expect(find(data, post.id, 'account')?.category).toBe('Orphaned record');
  });
});

describe('missing information', () => {
  it('flags an account with no owner, credential or recovery', () => {
    const data = empty();
    data.socialAccounts = [{
      ...base().socialAccounts[0],
      id: 'ACC-TEST', responsibleTeamMemberId: null, credentialId: null,
      recoveryMethod: 'None', recoveryRef: '', brandId: null, projectId: null,
      reservedForProjectId: null, simIds: [], targetCountryCode: 'IN', platformId: 'PLT-02',
    }];
    const fields = findIntegrityIssues(data).filter((i) => i.recordId === 'ACC-TEST').map((i) => i.field);
    expect(fields).toContain('responsibleEmployee');
    expect(fields).toContain('credentialReference');
    expect(fields).toContain('recovery');
  });

  it('does not demand an agreement reference from a prospect', () => {
    const data = empty();
    const agent = { ...base().agents[0], id: 'AGT-TEST', agreementRef: '', managerId: null, brandIds: [], projectIds: [] };
    data.agents = [{ ...agent, cooperationStatus: 'Prospect' }];
    expect(find(data, 'AGT-TEST', 'agreementRef')).toBeUndefined();

    data.agents = [{ ...agent, cooperationStatus: 'Active' }];
    expect(find(data, 'AGT-TEST', 'agreementRef')).toBeTruthy();
  });
});

describe('duplicates are surfaced here too', () => {
  it('reports both sides of a duplicate phone number', () => {
    const issues = findIntegrityIssues(base()).filter((i) => i.category === 'Duplicate' && i.recordType === 'SIM');
    expect(issues.length).toBeGreaterThanOrEqual(2);
    expect(issues[0].message).toMatch(/Shares a phone number with SIM-/);
  });

  it('reports duplicate account identities', () => {
    const issues = findIntegrityIssues(base()).filter((i) => i.category === 'Duplicate' && i.recordType === 'Social Account');
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('archived records are not nagged about', () => {
  it('skips an archived account with every field missing', () => {
    const data = empty();
    data.socialAccounts = [{
      ...base().socialAccounts[0],
      id: 'ACC-GONE', archived: true, responsibleTeamMemberId: null, credentialId: null,
      recoveryMethod: 'None', recoveryRef: '',
    }];
    expect(findIntegrityIssues(data).filter((i) => i.recordId === 'ACC-GONE')).toHaveLength(0);
  });
});

describe('summary', () => {
  it('counts by severity and category', () => {
    const s = summariseIssues(findIntegrityIssues(base()));
    expect(s.total).toBe(s.errors + s.warnings);
    expect(Object.values(s.byCategory).reduce((a, b) => a + b, 0)).toBe(s.total);
  });
});
