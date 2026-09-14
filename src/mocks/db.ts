/** In-memory mock database backing the MSW handlers.
 *  Lives for the lifetime of the browser tab. Nothing is persisted — and in
 *  particular nothing is written to localStorage, which must never hold
 *  credential material. */

import * as seed from './seed';
import * as fixtures from './fixtures';
import type {
  Agent, AgentProof, Assignment, AuditEntry, Brand, ContentPost, Country, CredentialRef, DomainRecord,
  FollowerSnapshot, Platform, Project, RoleName, Sim, SocialAccount, TeamMember,
} from '@/lib/types';

export interface Database {
  countries: Country[];
  platforms: Platform[];
  brands: Brand[];
  projects: Project[];
  teamMembers: TeamMember[];
  sims: Sim[];
  agents: Agent[];
  socialAccounts: SocialAccount[];
  credentials: CredentialRef[];
  assignments: Assignment[];
  domains: DomainRecord[];
  followerSnapshots: FollowerSnapshot[];
  contentPosts: ContentPost[];
  agentProofs: AgentProof[];
  /** Proof images by proof id, as data: URLs. Memory only. */
  proofImages: Record<string, { mime: string; base64: string }>;
  auditEntries: AuditEntry[];
}

function fresh(): Database {
  return snapshotOf(seed);
}

function snapshotOf(source: typeof seed | typeof fixtures): Database {
  return structuredClone({
    countries: source.countries,
    platforms: source.platforms,
    brands: source.brands,
    projects: source.projects,
    teamMembers: source.teamMembers,
    sims: source.sims,
    agents: source.agents,
    socialAccounts: source.socialAccounts,
    credentials: source.credentials,
    assignments: source.assignments,
    domains: source.domains,
    followerSnapshots: source.followerSnapshots,
    contentPosts: source.contentPosts,
    agentProofs: source.agentProofs,
    proofImages: {},
    auditEntries: source.auditEntries,
  });
}

export const db: Database = fresh();

/** Back to the shipped state: configuration, no records. */
export function resetDb() {
  Object.assign(db, fresh());
}

/** Load the large synthetic dataset. **Tests only** — the application never calls
 *  this, which is what keeps demonstration data out of the shipped workspace. */
export function loadFixtures() {
  Object.assign(db, snapshotOf(fixtures));
}

/* ── ID allocation ────────────────────────────────────────────── */

export function nextId(prefix: string, existing: { id: string }[], width = 4): string {
  const max = existing.reduce((m, r) => {
    const n = Number(r.id.split('-')[1]);
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

/* ── Audit ────────────────────────────────────────────────────── */

/** Fields whose *values* must never appear in an audit entry. */
/** Values never written into an audit entry.
 *  Two groups: credential material, which must not exist anywhere; and personal
 *  contact details, which are legitimate in the register but do not belong in a
 *  permanent, widely-read history. The change is still recorded — only the value
 *  is withheld. */
const REDACTED_FIELDS =
  /pass|secret|token|cookie|session|recovery_?code|backup_?code|otp|seed|phone|contactNumber|email|recoveryRef/i;

export function recordAudit(entry: {
  actor: TeamMember;
  recordType: string;
  recordId: string;
  recordLabel: string;
  action: AuditEntry['action'];
  reason: string;
  changes: { field: string; from: unknown; to: unknown }[];
}): AuditEntry {
  const audit: AuditEntry = {
    id: nextId('AUD', db.auditEntries),
    actorId: entry.actor.id,
    actorName: entry.actor.name,
    actorRole: entry.actor.role as RoleName,
    timestamp: new Date().toISOString(),
    recordType: entry.recordType,
    recordId: entry.recordId,
    recordLabel: entry.recordLabel,
    action: entry.action,
    reason: entry.reason,
    changes: entry.changes.map((c) => ({
      field: c.field,
      from: REDACTED_FIELDS.test(c.field) ? '[redacted]' : stringify(c.from),
      to: REDACTED_FIELDS.test(c.field) ? '[redacted]' : stringify(c.to),
    })),
  };
  db.auditEntries.unshift(audit);
  return audit;
}

function stringify(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

/** Diff two records, ignoring bookkeeping fields. */
export function diffRecords<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const skip = new Set(['updatedAt', 'createdAt', 'id']);
  return Object.keys(after)
    .filter((k) => !skip.has(k))
    .filter((k) => stringify(before[k]) !== stringify(after[k as keyof T]))
    .map((k) => ({ field: k, from: before[k], to: after[k as keyof T] }));
}
