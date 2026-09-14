/** Data-quality checks over the whole workspace.
 *
 *  Real registers rot: a brand gets archived while accounts still point at it, an
 *  owner leaves, a snapshot outlives the account it measured. These are pure
 *  functions over the dataset, like `rules.ts`, so the Data quality report and any
 *  future server-side check can share one definition of "wrong". */

import type { Bootstrap } from './types';
import {
  duplicateAccounts, duplicateAgentChannels, duplicateAgentContacts, duplicatePhoneNumbers, duplicatePostUrls,
} from './rules';

export type IssueSeverity = 'error' | 'warning';

export type IssueCategory =
  | 'Broken reference'
  | 'Missing information'
  | 'Duplicate'
  | 'Orphaned record';

export interface IntegrityIssue {
  id: string;
  severity: IssueSeverity;
  category: IssueCategory;
  recordType: string;
  recordId: string;
  recordLabel: string;
  field: string;
  message: string;
  /** Where to go to fix it. */
  to: string;
}

/** A reference that points at a record which is not there. Distinct from a field
 *  that was simply never filled in — that is "missing information". */
function brokenRef(args: {
  severity?: IssueSeverity;
  recordType: string; recordId: string; recordLabel: string;
  field: string; target: string; to: string;
}): IntegrityIssue {
  return {
    id: `${args.recordId}:${args.field}`,
    severity: args.severity ?? 'error',
    category: 'Broken reference',
    recordType: args.recordType,
    recordId: args.recordId,
    recordLabel: args.recordLabel,
    field: args.field,
    message: `Points at ${args.target}, which no longer exists.`,
    to: args.to,
  };
}

function missing(args: {
  severity?: IssueSeverity;
  recordType: string; recordId: string; recordLabel: string;
  field: string; message: string; to: string;
}): IntegrityIssue {
  return {
    id: `${args.recordId}:${args.field}`,
    severity: args.severity ?? 'warning',
    category: 'Missing information',
    recordType: args.recordType,
    recordId: args.recordId,
    recordLabel: args.recordLabel,
    field: args.field,
    message: args.message,
    to: args.to,
  };
}

export function findIntegrityIssues(data: Bootstrap): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  const brandIds = new Set(data.brands.map((b) => b.id));
  const projectIds = new Set(data.projects.map((p) => p.id));
  const memberIds = new Set(data.teamMembers.map((m) => m.id));
  const agentIds = new Set(data.agents.map((a) => a.id));
  const simIds = new Set(data.sims.map((s) => s.id));
  const accountIds = new Set(data.socialAccounts.map((a) => a.id));
  const credentialIds = new Set(data.credentials.map((c) => c.id));
  const platformIds = new Set(data.platforms.map((p) => p.id));
  const countryCodes = new Set(data.countries.map((c) => c.code));
  const domainIds = new Set(data.domains.map((d) => d.id));

  /* ── Social accounts ──────────────────────────────────────── */
  data.socialAccounts.filter((a) => !a.archived).forEach((a) => {
    const base = { recordType: 'Social Account', recordId: a.id, recordLabel: `@${a.username}`, to: `/accounts/${a.id}` };
    if (!platformIds.has(a.platformId)) issues.push(brokenRef({ ...base, field: 'platform', target: `platform ${a.platformId}` }));
    if (a.brandId && !brandIds.has(a.brandId)) issues.push(brokenRef({ ...base, field: 'brand', target: `brand ${a.brandId}` }));
    if (a.projectId && !projectIds.has(a.projectId)) issues.push(brokenRef({ ...base, field: 'project', target: `project ${a.projectId}` }));
    if (a.reservedForProjectId && !projectIds.has(a.reservedForProjectId)) {
      issues.push(brokenRef({ ...base, field: 'reservedForProject', target: `project ${a.reservedForProjectId}` }));
    }
    if (a.responsibleTeamMemberId && !memberIds.has(a.responsibleTeamMemberId)) {
      issues.push(brokenRef({ ...base, field: 'responsibleEmployee', target: `team member ${a.responsibleTeamMemberId}` }));
    }
    if (a.credentialId && !credentialIds.has(a.credentialId)) {
      issues.push(brokenRef({ ...base, field: 'credentialReference', target: `credential ${a.credentialId}` }));
    }
    if (a.targetCountryCode && !countryCodes.has(a.targetCountryCode)) {
      issues.push(brokenRef({ ...base, severity: 'warning', field: 'targetCountry', target: `country ${a.targetCountryCode}` }));
    }
    a.simIds.filter((id) => !simIds.has(id)).forEach((id) => {
      issues.push(brokenRef({ ...base, field: `linkedSim:${id}`, target: `SIM ${id}` }));
    });

    if (!a.responsibleTeamMemberId) {
      issues.push(missing({ ...base, field: 'responsibleEmployee', message: 'No responsible employee. Ownership must be documented before this can be treated as a ready reserve.' }));
    }
    if (!a.credentialId) {
      issues.push(missing({ ...base, field: 'credentialReference', message: 'No credential reference recorded.' }));
    }
    if (a.recoveryMethod === 'None' || !a.recoveryRef.trim()) {
      issues.push(missing({ ...base, field: 'recovery', message: 'No account-recovery method or reference recorded.' }));
    }
  });

  /* ── SIMs ─────────────────────────────────────────────────── */
  data.sims.filter((s) => !s.archived).forEach((s) => {
    const base = { recordType: 'SIM', recordId: s.id, recordLabel: s.id, to: `/sims/${s.id}` };
    if (s.brandId && !brandIds.has(s.brandId)) issues.push(brokenRef({ ...base, field: 'brand', target: `brand ${s.brandId}` }));
    if (s.projectId && !projectIds.has(s.projectId)) issues.push(brokenRef({ ...base, field: 'project', target: `project ${s.projectId}` }));
    if (s.countryCode && !countryCodes.has(s.countryCode)) {
      issues.push(brokenRef({ ...base, severity: 'warning', field: 'country', target: `country ${s.countryCode}` }));
    }
    if (s.assigneeId) {
      const pool = s.assigneeType === 'Agent' ? agentIds : memberIds;
      if (!pool.has(s.assigneeId)) {
        issues.push(brokenRef({ ...base, field: 'assignee', target: `${s.assigneeType ?? 'assignee'} ${s.assigneeId}` }));
      }
    }
    // An allocation state that contradicts itself is worse than a blank field.
    if (s.allocationStatus === 'Assigned' && !s.assigneeId) {
      issues.push({
        id: `${s.id}:allocation`, severity: 'error', category: 'Missing information',
        ...base, field: 'allocationStatus',
        message: 'Marked Assigned but no assignee is recorded.',
      });
    }
    if (!s.provider.trim()) issues.push(missing({ ...base, field: 'provider', message: 'No network provider recorded.' }));
  });

  /* ── Agents ───────────────────────────────────────────────── */
  data.agents.filter((a) => !a.archived).forEach((a) => {
    const base = { recordType: 'Agent', recordId: a.id, recordLabel: a.name, to: `/agents/${a.id}` };
    if (a.managerId && !memberIds.has(a.managerId)) issues.push(brokenRef({ ...base, field: 'manager', target: `team member ${a.managerId}` }));
    a.brandIds.filter((id) => !brandIds.has(id)).forEach((id) => issues.push(brokenRef({ ...base, field: `brand:${id}`, target: `brand ${id}` })));
    a.projectIds.filter((id) => !projectIds.has(id)).forEach((id) => issues.push(brokenRef({ ...base, field: `project:${id}`, target: `project ${id}` })));
    if (a.cooperationStatus !== 'Prospect' && !a.agreementRef.trim()) {
      issues.push(missing({ ...base, field: 'agreementRef', message: 'Working relationship with no agreement or document reference.' }));
    }
  });

  /* ── Assignments ──────────────────────────────────────────── */
  data.assignments.forEach((asg) => {
    const base = { recordType: 'Assignment', recordId: asg.id, recordLabel: asg.id, to: '/assignments' };
    const pool = asg.resourceType === 'SIM' ? simIds : asg.resourceType === 'Domain' ? domainIds : accountIds;
    if (!pool.has(asg.resourceId)) {
      issues.push(brokenRef({ ...base, field: 'resource', target: `${asg.resourceType} ${asg.resourceId}` }));
    }
    const people = asg.newAssigneeType === 'Agent' ? agentIds : memberIds;
    if (!people.has(asg.newAssigneeId)) {
      issues.push(brokenRef({ ...base, field: 'assignee', target: `${asg.newAssigneeType} ${asg.newAssigneeId}` }));
    }
    if (asg.brandId && !brandIds.has(asg.brandId)) issues.push(brokenRef({ ...base, field: 'brand', target: `brand ${asg.brandId}` }));
    if (asg.projectId && !projectIds.has(asg.projectId)) issues.push(brokenRef({ ...base, field: 'project', target: `project ${asg.projectId}` }));
  });

  /* ── Credential references ────────────────────────────────── */
  data.credentials.filter((c) => !c.archived).forEach((c) => {
    const base = { recordType: 'Credential Reference', recordId: c.id, recordLabel: c.id, to: '/credentials' };
    if (!accountIds.has(c.resourceId)) issues.push(brokenRef({ ...base, field: 'resource', target: `account ${c.resourceId}` }));
    if (c.ownerTeamMemberId && !memberIds.has(c.ownerTeamMemberId)) {
      issues.push(brokenRef({ ...base, field: 'owner', target: `team member ${c.ownerTeamMemberId}` }));
    }
    if (!c.vaultRef.trim()) issues.push(missing({ ...base, field: 'vaultRef', message: 'No vault item reference recorded.' }));
  });

  /* ── Domains, projects ────────────────────────────────────── */
  data.domains.filter((d) => !d.archived).forEach((d) => {
    if (d.brandId && !brandIds.has(d.brandId)) {
      issues.push(brokenRef({ recordType: 'Domain', recordId: d.id, recordLabel: d.domainName, field: 'brand', target: `brand ${d.brandId}`, to: '/domains' }));
    }
  });
  data.projects.forEach((p) => {
    if (!brandIds.has(p.brandId)) {
      issues.push(brokenRef({ recordType: 'Project', recordId: p.id, recordLabel: p.name, field: 'brand', target: `brand ${p.brandId}`, to: '/brands' }));
    }
  });

  /* ── Growth records outliving their account ───────────────── */
  const orphanSnapshots = new Map<string, number>();
  data.followerSnapshots.forEach((s) => {
    if (!accountIds.has(s.accountId)) orphanSnapshots.set(s.accountId, (orphanSnapshots.get(s.accountId) ?? 0) + 1);
  });
  orphanSnapshots.forEach((count, accountId) => {
    issues.push({
      id: `snapshots:${accountId}`, severity: 'warning', category: 'Orphaned record',
      recordType: 'Follower Snapshot', recordId: accountId, recordLabel: accountId, field: 'account',
      message: `${count} follower snapshot${count === 1 ? '' : 's'} for an account that no longer exists.`,
      to: '/growth',
    });
  });

  data.contentPosts.filter((p) => !p.archived).forEach((p) => {
    if (!accountIds.has(p.accountId)) {
      issues.push({
        id: `${p.id}:account`, severity: 'warning', category: 'Orphaned record',
        recordType: 'Content Post', recordId: p.id, recordLabel: p.title, field: 'account',
        message: `Posted from account ${p.accountId}, which no longer exists.`,
        to: '/growth?tab=content',
      });
    }
  });

  /* ── Duplicates, reusing the existing detectors ───────────── */
  const platformName = (id: string) => data.platforms.find((p) => p.id === id)?.name ?? id;
  duplicatePhoneNumbers(data.sims).forEach((group) => {
    group.records.forEach((s) => {
      issues.push({
        id: `${s.id}:duplicate-number`, severity: 'error', category: 'Duplicate',
        recordType: 'SIM', recordId: s.id, recordLabel: s.id, field: 'phoneNumber',
        message: `Shares a phone number with ${group.records.filter((r) => r.id !== s.id).map((r) => r.id).join(', ')}.`,
        to: `/sims/${s.id}`,
      });
    });
  });
  duplicateAccounts(data.socialAccounts, platformName).forEach((group) => {
    group.records.forEach((a) => {
      issues.push({
        id: `${a.id}:duplicate:${group.key}`, severity: 'error', category: 'Duplicate',
        recordType: 'Social Account', recordId: a.id, recordLabel: `@${a.username}`, field: 'identity',
        message: `Duplicate ${group.label} — also ${group.records.filter((r) => r.id !== a.id).map((r) => r.id).join(', ')}.`,
        to: `/accounts/${a.id}`,
      });
    });
  });

  // Agents sharing a number or a channel, and posts recorded twice. Saving now
  // refuses all three; these catch what was entered before that, or what two
  // people saved in the same instant.
  [...duplicateAgentContacts(data.agents), ...duplicateAgentChannels(data.agents)].forEach((group) => {
    group.records.forEach((a) => {
      issues.push({
        id: `${a.id}:duplicate:${group.key}`, severity: 'error', category: 'Duplicate',
        recordType: 'Agent', recordId: a.id, recordLabel: a.name, field: group.key.startsWith('phone::') ? 'contactNumber' : 'channelUrls',
        message: `Duplicate ${group.label} — also ${group.records.filter((r) => r.id !== a.id).map((r) => r.id).join(', ')}.`,
        to: `/agents/${a.id}`,
      });
    });
  });
  duplicatePostUrls(data.contentPosts).forEach((group) => {
    group.records.forEach((post) => {
      issues.push({
        id: `${post.id}:duplicate:${group.key}`, severity: 'error', category: 'Duplicate',
        recordType: 'Content Post', recordId: post.id, recordLabel: post.title, field: 'url',
        message: `Duplicate ${group.label} — also ${group.records.filter((r) => r.id !== post.id).map((r) => r.id).join(', ')}. Its engagement is counted twice.`,
        to: '/growth',
      });
    });
  });

  return issues;
}

export interface IntegritySummary {
  total: number;
  errors: number;
  warnings: number;
  byCategory: Record<string, number>;
}

export function summariseIssues(issues: IntegrityIssue[]): IntegritySummary {
  return {
    total: issues.length,
    errors: issues.filter((i) => i.severity === 'error').length,
    warnings: issues.filter((i) => i.severity === 'warning').length,
    byCategory: issues.reduce<Record<string, number>>((acc, i) => {
      acc[i.category] = (acc[i.category] ?? 0) + 1;
      return acc;
    }, {}),
  };
}
