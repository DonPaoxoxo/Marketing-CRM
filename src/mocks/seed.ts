/** The workspace as it ships: configuration only, no records.
 *
 *  Every operational register starts empty and is filled by the team. What stays
 *  is the reference configuration the registers depend on — the platforms an
 *  account can belong to and the countries a SIM or account can target. Those are
 *  settings, not demonstration data, and an empty platform list would make the
 *  account form unusable on first run.
 *
 *  Brands, projects and team members start empty too: they are the organisation's
 *  own structure, and nobody should have to delete someone else's example data
 *  before entering their own.
 *
 *  The large synthetic dataset now lives in `fixtures.ts` and is loaded only by
 *  the test suite. */

import type {
  Agent, AgentProof, Assignment, AuditEntry, Brand, CompetitorRecord, ContentPost, Country, CredentialRef, DomainRecord,
  FollowerSnapshot, Platform, Project, Sim, SocialAccount, TeamMember,
} from '../lib/types';

/* ── Configuration ────────────────────────────────────────────── */

export const countries: Country[] = [
  { code: 'IN', name: 'India', dialCode: '+91' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92' },
  { code: 'PH', name: 'Philippines', dialCode: '+63' },
];

export const platforms: Platform[] = [
  { id: 'PLT-01', name: 'Facebook', slug: 'facebook', supportsAssetTypes: ['Profile', 'Page', 'Group', 'Business Account'], builtIn: true },
  { id: 'PLT-02', name: 'Instagram', slug: 'instagram', supportsAssetTypes: ['Profile', 'Business Account'], builtIn: true },
  { id: 'PLT-03', name: 'TikTok', slug: 'tiktok', supportsAssetTypes: ['Profile', 'Business Account'], builtIn: true },
  { id: 'PLT-04', name: 'YouTube', slug: 'youtube', supportsAssetTypes: ['Channel'], builtIn: true },
  { id: 'PLT-05', name: 'X', slug: 'x', supportsAssetTypes: ['Profile'], builtIn: true },
  { id: 'PLT-06', name: 'Telegram', slug: 'telegram', supportsAssetTypes: ['Channel', 'Group', 'Profile'], builtIn: true },
  { id: 'PLT-07', name: 'WhatsApp Business', slug: 'whatsapp-business', supportsAssetTypes: ['Business Account', 'Group'], builtIn: true },
  { id: 'PLT-08', name: 'Threads', slug: 'threads', supportsAssetTypes: ['Profile'], builtIn: false },
];

/* ── Empty registers ──────────────────────────────────────────── */

export const brands: Brand[] = [];
export const projects: Project[] = [];
export const teamMembers: TeamMember[] = [];
export const sims: Sim[] = [];
export const agents: Agent[] = [];
export const socialAccounts: SocialAccount[] = [];
export const credentials: CredentialRef[] = [];
export const assignments: Assignment[] = [];
export const domains: DomainRecord[] = [];
export const followerSnapshots: FollowerSnapshot[] = [];
export const contentPosts: ContentPost[] = [];
export const agentProofs: AgentProof[] = [];
export const pakistanCompetitors: CompetitorRecord[] = [];
export const auditEntries: AuditEntry[] = [];
