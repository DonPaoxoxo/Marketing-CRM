/** Core domain model for the Marketing Resource CRM.
 *  All records in this phase are synthetic. No real credentials are ever modelled —
 *  only *references* to an external vault. */

export type ID = string;

/* ── Shared enums ─────────────────────────────────────────────── */

export const SIM_OPERATIONAL_STATUS = ['Active', 'Inactive', 'Lost', 'Expired', 'Retired'] as const;
export type SimOperationalStatus = (typeof SIM_OPERATIONAL_STATUS)[number];

export const ALLOCATION_STATUS = ['Available', 'Reserved', 'Assigned'] as const;
export type AllocationStatus = (typeof ALLOCATION_STATUS)[number];

export const ACCOUNT_ALLOCATION_STATUS = ['Unassigned', 'Reserved', 'Assigned'] as const;
export type AccountAllocationStatus = (typeof ACCOUNT_ALLOCATION_STATUS)[number];

export const ACCOUNT_OPERATIONAL_STATUS = ['Active', 'Under Review', 'Restricted', 'Suspended', 'Closed'] as const;
export type AccountOperationalStatus = (typeof ACCOUNT_OPERATIONAL_STATUS)[number];

export const COOPERATION_STATUS = ['Prospect', 'Onboarding', 'Active', 'Paused', 'Ended'] as const;
export type CooperationStatus = (typeof COOPERATION_STATUS)[number];

export const AGENT_TYPE = ['Individual', 'Agency'] as const;
export type AgentType = (typeof AGENT_TYPE)[number];

export const ASSET_TYPE = ['Profile', 'Page', 'Channel', 'Group', 'Business Account'] as const;
export type AssetType = (typeof ASSET_TYPE)[number];

export const SIM_FORM = ['Physical SIM', 'eSIM'] as const;
export type SimForm = (typeof SIM_FORM)[number];

/** What a SIM was used to create, as the team's tracking sheet records it.
 *  Empty when nothing has been created with it yet. */
/** The usual purposes, offered as choices. Anything else is written in as a
 *  custom purpose — Serper, Twilio, Discord — so the type is open text. */
export const SIM_CREATED_FOR = ['Email + Telegram', 'Email', 'Telegram'] as const;
export const SIM_CREATED_FOR_MAX = 80;
export type SimCreatedFor = string;

export const COMMS_CHANNEL = ['Email', 'WhatsApp', 'Telegram', 'Phone', 'In-person'] as const;
export type CommsChannel = (typeof COMMS_CHANNEL)[number];

export const HANDOVER_STATUS = ['Pending', 'In Progress', 'Acknowledged', 'Completed', 'Returned', 'Cancelled'] as const;
export type HandoverStatus = (typeof HANDOVER_STATUS)[number];

export const CREDENTIAL_ACCESS_STATUS = ['Not Requested', 'Requested', 'Approved', 'Revoked', 'Expired'] as const;
export type CredentialAccessStatus = (typeof CREDENTIAL_ACCESS_STATUS)[number];

export const RECOVERY_METHOD = ['Recovery Email', 'Recovery Phone', 'Authenticator App', 'Backup Codes', 'Security Key', 'None'] as const;
export type RecoveryMethod = (typeof RECOVERY_METHOD)[number];

export const TWO_FA_METHOD = ['SMS', 'Authenticator App', 'Security Key', 'Email', 'None'] as const;
export type TwoFaMethod = (typeof TWO_FA_METHOD)[number];

export const RESOURCE_TYPE = ['SIM', 'Social Account', 'Domain'] as const;
export type ResourceType = (typeof RESOURCE_TYPE)[number];

export const CONTENT_FORMAT = ['Reel', 'Short', 'TikTok'] as const;
export type ContentFormat = (typeof CONTENT_FORMAT)[number];

/** Where a domain is used. "Available" means not yet given to a country — kept
 *  ready for the next rotation. */
export const DOMAIN_COUNTRY = ['India', 'Indonesia', 'Available'] as const;
export type DomainCountry = (typeof DOMAIN_COUNTRY)[number];

export const DOMAIN_STATUS = ['Active', 'Inactive'] as const;
export type DomainStatus = (typeof DOMAIN_STATUS)[number];

/* ── Records ──────────────────────────────────────────────────── */

export interface Sim {
  id: ID;                       // SIM record ID e.g. SIM-0104
  phoneNumber: string;          // E.164 e.g. +919876543210
  countryCode: string;          // ISO-2 e.g. IN
  provider: string;
  form: SimForm;
  createdFor: SimCreatedFor;
  /** The email account registered with this SIM. A contact detail: masked for
   *  roles without contact access and never written to the audit history. */
  email: string;
  /** Stored without the leading "@"; shown with it. */
  telegramUsername: string;
  assigneeId: ID | null;        // team member or agent
  assigneeType: 'Team Member' | 'Agent' | null;
  brandId: ID | null;
  projectId: ID | null;
  operationalStatus: SimOperationalStatus;
  allocationStatus: AllocationStatus;
  planExpiryDate: string | null;   // ISO date — renewal / validity
  lastVerifiedDate: string | null;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: ID;                       // Agent UID e.g. AGT-014
  name: string;
  /** The agent's own UID, typed in by the team (e.g. their player or platform
   *  UID). Unique among live agents when filled in. */
  externalUid: string;
  agentType: AgentType;
  contactNumber: string;
  email: string;
  preferredChannel: CommsChannel;
  managerId: ID | null;         // team member
  brandIds: ID[];
  projectIds: ID[];
  channelUrls: string[];
  cooperationStatus: CooperationStatus;
  startDate: string | null;
  lastContactedDate: string | null;
  nextFollowUpDate: string | null;
  agreementRef: string;         // document reference, not a file
  /** Set only by the System Administrator (src/lib/salary.ts). Null until set. */
  salaryStatus: 'Hold' | 'Advance' | 'Customize' | null;
  /** The typed-in status when salaryStatus is Customize; empty otherwise. */
  salaryNote: string;
  salaryUpdatedByName: string;
  salaryUpdatedAt: string | null;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SocialAccount {
  id: ID;                       // internal account ID e.g. ACC-0231
  platformId: ID;               // FK -> Platform
  platformAccountId: string;    // the platform own numeric/string ID
  assetType: AssetType;
  displayName: string;
  username: string;
  profileUrl: string;
  brandId: ID | null;
  projectId: ID | null;
  targetCountryCode: string;
  contentLanguage: string;
  responsibleTeamMemberId: ID | null;   // ownership
  loginEmailRef: string;                // reference only, e.g. ops+acc231@example-internal
  credentialId: ID | null;              // FK -> CredentialRef
  recoveryMethod: RecoveryMethod;
  recoveryRef: string;                  // masked reference, never a secret
  twoFaEnabled: boolean;
  twoFaMethod: TwoFaMethod;
  operationalStatus: AccountOperationalStatus;
  allocationStatus: AccountAllocationStatus;
  simIds: ID[];                         // a SIM may serve several accounts
  lastAccessVerifiedDate: string | null;
  lastPostingDate: string | null;
  followerCount: number | null;
  followerCountMeasuredAt: string | null;
  reservedForProjectId: ID | null;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  id: ID;                       // ASG-0042
  resourceType: ResourceType;
  resourceId: ID;
  previousAssigneeId: ID | null;
  previousAssigneeType: 'Team Member' | 'Agent' | null;
  newAssigneeId: ID;
  newAssigneeType: 'Team Member' | 'Agent';
  role: 'Primary Custodian' | 'Collaborator';
  brandId: ID | null;
  projectId: ID | null;
  startDate: string;
  expectedReturnDate: string | null;
  purpose: string;
  handoverStatus: HandoverStatus;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  returnedDate: string | null;
  /** Credential handover outcome — never the secret itself. */
  credentialAction: 'None' | 'Access Granted' | 'Access Revoked' | 'Credential Rotated';
  active: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialRef {
  id: ID;                       // CRD-0101
  resourceType: ResourceType;
  resourceId: ID;
  provider: string;             // platform / provider name
  loginIdentifier: string;      // authorised login reference, synthetic
  vaultRef: string;             // e.g. vault://marketing/acc-0231  (NOT CONNECTED)
  ownerTeamMemberId: ID | null;
  accessStatus: CredentialAccessStatus;
  lastRotationDate: string | null;
  twoFaEnabled: boolean;
  recoveryReady: boolean;
  lastAccessVerifiedDate: string | null;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Brand { id: ID; name: string; code: string; description: string; countryCodes: string[]; active: boolean; }
export interface Project { id: ID; name: string; brandId: ID; status: 'Planning' | 'Running' | 'Paused' | 'Complete'; startDate: string; endDate: string | null; }
export interface Country { code: string; name: string; dialCode: string; }
export interface Platform { id: ID; name: string; slug: string; supportsAssetTypes: AssetType[]; builtIn: boolean; }
export interface TeamMember { id: ID; name: string; email: string; role: RoleName; title: string; active: boolean; }

export interface DomainRecord {
  id: ID;                       // DOM-0031
  domainName: string;           // normalised lowercase, unique
  targetCountry: DomainCountry;
  rotationDate: string | null;  // null => "Not rotated"
  registeredDate: string;
  expirationDate: string;       // must be >= registeredDate
  status: DomainStatus;
  /** From the registrar's export: who the domain is registered with, */
  registrar: string;
  /** the registrar account it sits in (the export's "UID"), */
  registrarUid: string;
  /** the registrar's own grouping, */
  category: string;
  /** and its nameservers — lower-case, comma-separated. */
  nameservers: string;
  brandId: ID | null;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One observed follower total for one account on one day.
 *
 *  The *total* is recorded, never the gain — gain is derived against the previous
 *  snapshot, so a missed day yields a correct multi-day gain instead of a broken
 *  series. Unique per (accountId, date). */
export interface FollowerSnapshot {
  id: ID;                       // FSN-00001
  accountId: ID;
  date: string;                 // YYYY-MM-DD
  followerCount: number;        // absolute total as observed that day
  recordedById: ID | null;      // team member who entered it
  recordedAt: string;
  note: string;
}

/** A short-form video post with its manually read engagement figures. */
export interface ContentPost {
  id: ID;                       // CNT-0001
  accountId: ID;
  platformId: ID;               // denormalised from the account so the table can filter on it
  format: ContentFormat;
  title: string;
  url: string;
  publishedDate: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  /** Follows attributed to this post. Not every platform reports it. */
  followerGain: number | null;
  /** When these numbers were read — they are manual, never synced. */
  metricsMeasuredAt: string;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ── Roles, permissions, audit ────────────────────────────────── */

export const ROLES = ['System Administrator', 'Marketing Manager', 'Marketing Staff', 'Read-only Reviewer'] as const;
export type RoleName = (typeof ROLES)[number];

export const PERMISSIONS = [
  'view:contact-details',
  'edit:resources',
  'assign:resources',
  /** Bring many records in at once — CSV import, SIM bulk upload. Split from
   *  exporting because they carry different risk: an import adds what the role
   *  could already add one by one, while an export takes the register away. */
  'import:records',
  'export:data',
  'manage:credential-refs',
  'request:credential-access',
  'archive:records',
  /** Create, invite, re-role and deactivate the people who can sign in. Added
   *  when real accounts arrived — the earlier matrix had no permission covering
   *  it, which only became visible once there was a server to enforce against. */
  'manage:users',
  /** Open the Domains register. Leaving it out also removes domain data from
   *  that person's workspace payload, so the page is not the only lock. */
  'access:domains',
  /** Open the Import page (CSV imports of agents, accounts and domains). */
  'access:import',
  /** Open Credential Refs. */
  'access:credential-refs',
  /** Open Roles & Audit (the permission matrix and the audit history). */
  'access:roles-audit',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface AuditEntry {
  id: ID;
  actorId: ID;
  actorName: string;
  actorRole: RoleName;
  timestamp: string;
  recordType: string;
  recordId: ID;
  recordLabel: string;
  action: 'create' | 'update' | 'status-change' | 'assign' | 'archive' | 'import' | 'export' | 'credential-request' | 'rotation' | 'delete'
    | 'approve' | 'reject' | 'restore' | 'upload' | 'download' | 'ai-request';
  reason: string;
  /** Field-level diff. Values are always safe — secret fields are redacted upstream. */
  changes: { field: string; from: string | null; to: string | null }[];
}

/** Everything the client loads in one go. Lives here rather than beside the
 *  data-fetching hook so the server can describe its own response without
 *  importing anything from the browser app. */
/** A screenshot proving an agent's post, with the Post URL. The image itself is
 *  fetched separately from `/api/agent-proofs/:id/image`, never carried in the
 *  workspace payload. */
export interface AgentProof {
  id: ID;
  agentId: ID;
  postUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: ID | null;
  uploadedByName: string;
  /** Null until the System Administrator reviews it. */
  verdict: 'Accepted' | 'Rejected' | null;
  /** Why it was rejected; empty otherwise. */
  verdictReason: string;
  reviewedByName: string;
  reviewedAt: string | null;
  payment: 'Paid' | 'Not paid';
  paidByName: string;
  paidAt: string | null;
  archived: boolean;
  createdAt: string;
}

export interface Bootstrap {
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
  auditEntries: AuditEntry[];
}

export interface SavedView {
  id: ID;
  name: string;
  route: string;
  state: Record<string, unknown>;
  createdAt: string;
}
