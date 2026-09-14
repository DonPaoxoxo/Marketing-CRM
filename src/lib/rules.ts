/** Business rules shared by the dashboard, tables, reserve inventory and reports.
 *  Everything here is a pure function over the dataset so the KPI cards and the
 *  tables they drill into can never disagree. */

import type { Agent, Assignment, ContentPost, DomainRecord, ResourceType, Sim, SocialAccount } from './types';
import { daysSince, daysUntil } from './utils';
import { pageUrlKey, phoneKey, postUrlKey } from './identity';

/* ── Configurable thresholds ──────────────────────────────────── */

export interface Thresholds {
  /** A reserve account must have been access-verified within this many days. */
  accessVerificationWindowDays: number;
  /** SIMs within this many days of plan expiry count as "approaching renewal". */
  simRenewalWindowDays: number;
  /** Agent follow-ups due within this many days appear on the dashboard. */
  followUpWindowDays: number;
  /** A single SIM linked to more than this many accounts is flagged for review. */
  simFanOutReviewThreshold: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  accessVerificationWindowDays: 90,
  simRenewalWindowDays: 30,
  followUpWindowDays: 14,
  simFanOutReviewThreshold: 3,
};

/* ── Reserve readiness ────────────────────────────────────────── */

export interface ReadinessCheck {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
  failed: ReadinessCheck[];
}

/** The single definition of "ready to assign", shown verbatim in the UI. */
export function evaluateReserveReadiness(
  account: SocialAccount,
  activeAssignments: Assignment[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): ReadinessResult {
  const hasActiveAssignment = activeAssignments.some(
    (a) => a.resourceType === 'Social Account' && a.resourceId === account.id && a.active && a.role === 'Primary Custodian',
  );
  const sinceVerified = daysSince(account.lastAccessVerifiedDate);

  const checks: ReadinessCheck[] = [
    {
      key: 'operational',
      label: 'Operational status is Active',
      passed: account.operationalStatus === 'Active',
      detail: account.operationalStatus,
    },
    {
      key: 'allocation',
      label: 'Allocation status is Reserved',
      passed: account.allocationStatus === 'Reserved',
      detail: account.allocationStatus,
    },
    {
      key: 'no-assignment',
      label: 'No active assignment exists',
      passed: !hasActiveAssignment,
      detail: hasActiveAssignment ? 'Active custodian on record' : 'No active custodian',
    },
    {
      key: 'ownership',
      label: 'Ownership is documented',
      passed: account.responsibleTeamMemberId !== null,
      detail: account.responsibleTeamMemberId ? 'Responsible employee set' : 'No responsible employee',
    },
    {
      key: 'credential',
      label: 'Credential reference exists',
      passed: Boolean(account.credentialId),
      detail: account.credentialId ? account.credentialId : 'No vault reference',
    },
    {
      key: 'recovery',
      label: 'Recovery reference exists',
      passed: account.recoveryMethod !== 'None' && account.recoveryRef.trim() !== '',
      detail: account.recoveryMethod === 'None' ? 'No recovery method' : account.recoveryMethod,
    },
    {
      key: 'verification',
      label: `Access verified within ${thresholds.accessVerificationWindowDays} days`,
      passed: sinceVerified !== null && sinceVerified <= thresholds.accessVerificationWindowDays,
      detail: sinceVerified === null ? 'Never verified' : `${sinceVerified} days ago`,
    },
  ];

  const failed = checks.filter((c) => !c.passed);
  return { ready: failed.length === 0, checks, failed };
}

/** Reserve inventory is a *view* of the account register, never a second copy. */
export function reserveAccounts(accounts: SocialAccount[]): SocialAccount[] {
  return accounts.filter(
    (a) =>
      !a.archived &&
      a.allocationStatus === 'Reserved' &&
      a.operationalStatus !== 'Suspended' &&
      a.operationalStatus !== 'Restricted' &&
      a.operationalStatus !== 'Closed',
  );
}

/* ── Duplicate detection ──────────────────────────────────────── */

export interface DuplicateGroup<T> {
  key: string;
  label: string;
  records: T[];
}

export function duplicatePhoneNumbers(sims: Sim[]): DuplicateGroup<Sim>[] {
  return groupBy(sims.filter((s) => !s.archived), (s) => [phoneKey(s.phoneNumber)])
    .map(([key, records]) => ({ key, label: `Phone number ${records[0].phoneNumber}`, records }));
}

/** Groups records under each key they carry, keeping groups of two or more.
 *  A record appears once per group however many times it repeats a key. */
function groupBy<T extends { id: string }>(records: readonly T[], keys: (r: T) => string[]): [string, T[]][] {
  const groups = new Map<string, Map<string, T>>();
  for (const record of records) {
    for (const key of keys(record)) {
      if (!key) continue;
      const group = groups.get(key) ?? new Map<string, T>();
      group.set(record.id, record);
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([key, byId]) => [key, [...byId.values()]] as [string, T[]])
    .filter(([, list]) => list.length > 1);
}

/** Accounts recorded twice: the same platform ID on the same platform, or the
 *  same profile URL however it was written (see `pageUrlKey`).
 *
 *  Handles are not compared. Team members manage many pages and reuse a handle
 *  or name across them, so a shared handle is normal, not a data-quality fault.
 *  Blank IDs and URLs are skipped rather than grouped together: an empty value
 *  says nothing about identity. */
export function duplicateAccounts(accounts: SocialAccount[], platformName: (id: string) => string): DuplicateGroup<SocialAccount>[] {
  const live = accounts.filter((a) => !a.archived);
  const byId = groupBy(live, (a) => {
    const id = a.platformAccountId.trim().toLowerCase();
    return [id ? `${a.platformId}::${id}` : ''];
  }).map(([key, records]) => ({
    key, label: `${platformName(records[0].platformId)} platform ID ${records[0].platformAccountId}`, records,
  }));
  const byUrl = groupBy(live, (a) => [pageUrlKey(a.profileUrl)]).map(([key, records]) => ({
    key: `url::${key}`, label: `profile URL ${records[0].profileUrl}`, records,
  }));
  return [...byId, ...byUrl];
}

/** Agents sharing a contact number — usually one person entered twice. */
export function duplicateAgentContacts(agents: Agent[]): DuplicateGroup<Agent>[] {
  return groupBy(agents.filter((a) => !a.archived), (a) => [phoneKey(a.contactNumber)])
    .map(([key, records]) => ({ key: `phone::${key}`, label: `contact number ${records[0].contactNumber}`, records }));
}

/** Agents listing the same channel or profile URL. */
export function duplicateAgentChannels(agents: Agent[]): DuplicateGroup<Agent>[] {
  return groupBy(agents.filter((a) => !a.archived), (a) => a.channelUrls.map((u) => pageUrlKey(u)))
    .map(([key, records]) => ({ key: `channel::${key}`, label: `channel URL ${key}`, records }));
}

/** The same short-form post recorded twice, which would double its engagement
 *  in every total and leaderboard. */
export function duplicatePostUrls(posts: ContentPost[]): DuplicateGroup<ContentPost>[] {
  return groupBy(posts.filter((p) => !p.archived), (p) => [postUrlKey(p.url)])
    .map(([key, records]) => ({ key: `post::${key}`, label: `post URL ${records[0].url}`, records }));
}

/** A shared SIM is normal; an unusually high fan-out is worth a human look. */
export function simFanOutReview(
  accounts: SocialAccount[],
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): { simId: string; accounts: SocialAccount[] }[] {
  const bySim = new Map<string, SocialAccount[]>();
  accounts.filter((a) => !a.archived).forEach((a) => {
    a.simIds.forEach((sid) => bySim.set(sid, [...(bySim.get(sid) ?? []), a]));
  });
  return [...bySim.entries()]
    .filter(([, list]) => list.length > thresholds.simFanOutReviewThreshold)
    .map(([simId, list]) => ({ simId, accounts: list }));
}

/* ── Assignment conflicts ─────────────────────────────────────── */

export interface ConflictResult {
  conflict: boolean;
  message: string;
  existing?: Assignment;
}

/** Only one active Primary Custodian per resource. Collaborators are unlimited. */
export function checkAssignmentConflict(
  all: Assignment[],
  candidate: Pick<Assignment, 'resourceType' | 'resourceId' | 'role'> & { id?: string },
): ConflictResult {
  if (candidate.role === 'Collaborator') {
    return { conflict: false, message: 'Collaborators may be recorded alongside the primary custodian.' };
  }
  const existing = all.find(
    (a) =>
      a.active &&
      a.role === 'Primary Custodian' &&
      a.resourceType === candidate.resourceType &&
      a.resourceId === candidate.resourceId &&
      a.id !== candidate.id,
  );
  if (existing) {
    return {
      conflict: true,
      message: `${candidate.resourceId} already has an active primary custodian (${existing.id}). Close or return that assignment first, or record this person as a collaborator.`,
      existing,
    };
  }
  return { conflict: false, message: 'No conflicting active assignment.' };
}

/** The custodian a new assignment takes over from, for the "previous assignee" field.
 *
 *  Only a *primary custodian* hands over to another primary custodian. A collaborator
 *  is added alongside the custodian and replaces nobody, so it never has a previous
 *  assignee — recording one would misstate the handover chain.
 *
 *  Closed assignments count: the usual flow is to return the old assignment first and
 *  then create the new one, at which point the outgoing holder is no longer active. */
export function previousCustodianFor(
  all: Assignment[],
  resourceType: ResourceType,
  resourceId: string,
  role: Assignment['role'],
): Assignment | null {
  if (role !== 'Primary Custodian') return null;
  const candidates = all
    .filter((a) => a.role === 'Primary Custodian' && a.resourceType === resourceType && a.resourceId === resourceId)
    .sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
  return candidates[0] ?? null;
}

/* ── Dashboard-facing predicates ──────────────────────────────── */

export const simApproachingRenewal = (s: Sim, t: Thresholds = DEFAULT_THRESHOLDS) => {
  const d = daysUntil(s.planExpiryDate);
  return !s.archived && d !== null && d <= t.simRenewalWindowDays;
};

export const accountUnderReviewOrRestricted = (a: SocialAccount) =>
  !a.archived && (a.operationalStatus === 'Under Review' || a.operationalStatus === 'Restricted');

export const accountMissingOwner = (a: SocialAccount) => !a.archived && a.responsibleTeamMemberId === null;

export const accountMissingCredential = (a: SocialAccount) => !a.archived && !a.credentialId;

export const accountAwaitingVerification = (a: SocialAccount, t: Thresholds = DEFAULT_THRESHOLDS) => {
  const since = daysSince(a.lastAccessVerifiedDate);
  return !a.archived && (since === null || since > t.accessVerificationWindowDays);
};

/* ── Domain helpers ───────────────────────────────────────────── */

export type DomainExpiryBucket = 'expired' | 'expiring-7' | 'expiring-30' | 'healthy';

export function domainExpiryBucket(d: DomainRecord): DomainExpiryBucket {
  const n = daysUntil(d.expirationDate);
  if (n === null) return 'healthy';
  if (n < 0) return 'expired';
  if (n <= 7) return 'expiring-7';
  if (n <= 30) return 'expiring-30';
  return 'healthy';
}

export const DOMAIN_EXPIRY_LABELS: Record<DomainExpiryBucket, string> = {
  expired: 'Expired',
  'expiring-7': 'Expiring within 7 days',
  'expiring-30': 'Expiring within 30 days',
  healthy: 'Not due soon',
};
