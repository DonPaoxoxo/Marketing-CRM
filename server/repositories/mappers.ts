/** Row → domain mapping, defined once.
 *
 *  Every read path goes through these: the bootstrap payload, the record returned
 *  after a write, everything. Two mappers for the same table would eventually
 *  disagree, and the disagreement would only show as a field that is right on
 *  reload and wrong right after saving. */

import type { RowDataPacket } from 'mysql2/promise';
import type {
  Agent, Assignment, AuditEntry, Brand, CompetitorRecord, ContentPost, Country, CredentialRef, DomainRecord,
  FollowerSnapshot, Platform, Project, Sim, SocialAccount, TeamMember,
} from '../../src/lib/types';

/* ── Column coercion ──────────────────────────────────────────────
 *  DATE columns arrive as 'YYYY-MM-DD' strings (the pool's `dateStrings`
 *  option); DATETIME columns arrive as Date objects and the domain model wants
 *  an ISO timestamp. */

export const iso = (value: Date | string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
};
export const isoRequired = (value: Date | string | null | undefined): string =>
  iso(value) ?? new Date(0).toISOString();
export const date = (value: string | Date | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value).slice(0, 10);
export const dateRequired = (value: string | Date | null | undefined): string => date(value) ?? '';
export const bool = (value: unknown): boolean => Boolean(Number(value));
export const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
export const id = (value: unknown): string | null =>
  value === null || value === undefined || value === '' ? null : String(value);
export const int = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/** Groups child rows by their parent id in a single pass. */
export function groupBy(rows: RowDataPacket[], key: string): Map<string, RowDataPacket[]> {
  const map = new Map<string, RowDataPacket[]>();
  for (const row of rows) {
    const parent = String(row[key]);
    const list = map.get(parent);
    if (list) list.push(row);
    else map.set(parent, [row]);
  }
  return map;
}

/** The join-table rows a record needs beyond its own row. */
export interface AgentChildren { brandIds: string[]; projectIds: string[]; channelUrls: string[] }
export interface AccountChildren { simIds: string[] }
export interface AuditChildren { changes: AuditEntry['changes'] }

/* ── Configuration ────────────────────────────────────────────── */

export const mapCountry = (r: RowDataPacket): Country => ({
  code: String(r.code),
  name: text(r.name),
  dialCode: text(r.dial_code),
});

export const mapPlatform = (r: RowDataPacket): Platform => ({
  id: String(r.id),
  name: text(r.name),
  slug: text(r.slug),
  // mysql2 parses JSON columns; a server configured otherwise hands back a string.
  supportsAssetTypes: typeof r.supports_asset_types === 'string'
    ? JSON.parse(r.supports_asset_types)
    : (r.supports_asset_types as Platform['supportsAssetTypes']),
  builtIn: bool(r.built_in),
});

export const mapBrand = (r: RowDataPacket, countryCodes: string[]): Brand => ({
  id: String(r.id),
  name: text(r.name),
  code: text(r.code),
  description: text(r.description),
  countryCodes,
  active: bool(r.active),
});

export const mapProject = (r: RowDataPacket): Project => ({
  id: String(r.id),
  name: text(r.name),
  brandId: String(r.brand_id),
  status: r.status as Project['status'],
  startDate: dateRequired(r.start_date),
  endDate: date(r.end_date),
});

/** The team register is a projection of `users` with the authentication columns
 *  left behind — one table, so a person's name and role cannot drift between
 *  who they are in the CRM and who they are at sign-in. */
export const mapTeamMember = (r: RowDataPacket): TeamMember => ({
  id: String(r.id),
  name: text(r.name),
  email: text(r.email),
  role: r.role as TeamMember['role'],
  title: text(r.title),
  active: bool(r.active),
});

/* ── Registers ────────────────────────────────────────────────── */

export const mapSim = (r: RowDataPacket): Sim => ({
  id: String(r.id),
  phoneNumber: text(r.phone_number),
  countryCode: text(r.country_code),
  provider: text(r.provider),
  form: r.form as Sim['form'],
  createdFor: text(r.created_for) as Sim['createdFor'],
  email: text(r.email),
  telegramUsername: text(r.telegram_username),
  assigneeId: id(r.assignee_id),
  assigneeType: (r.assignee_type as Sim['assigneeType']) ?? null,
  brandId: id(r.brand_id),
  projectId: id(r.project_id),
  operationalStatus: r.operational_status as Sim['operationalStatus'],
  allocationStatus: r.allocation_status as Sim['allocationStatus'],
  planExpiryDate: date(r.plan_expiry_date),
  lastVerifiedDate: date(r.last_verified_date),
  notes: text(r.notes),
  archived: bool(r.archived),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapAgent = (r: RowDataPacket, children: AgentChildren): Agent => ({
  id: String(r.id),
  name: text(r.name),
  externalUid: text(r.external_uid),
  agentType: r.agent_type as Agent['agentType'],
  contactNumber: text(r.contact_number),
  email: text(r.email),
  preferredChannel: r.preferred_channel as Agent['preferredChannel'],
  managerId: id(r.manager_id),
  brandIds: children.brandIds,
  projectIds: children.projectIds,
  channelUrls: children.channelUrls,
  cooperationStatus: r.cooperation_status as Agent['cooperationStatus'],
  startDate: date(r.start_date),
  lastContactedDate: date(r.last_contacted_date),
  nextFollowUpDate: date(r.next_follow_up_date),
  agreementRef: text(r.agreement_ref),
  salaryStatus: r.salary_status === 'Hold' || r.salary_status === 'Advance' || r.salary_status === 'Customize' ? r.salary_status : null,
  salaryNote: text(r.salary_note),
  salaryUpdatedByName: text(r.salary_updated_by_name),
  salaryUpdatedAt: iso(r.salary_updated_at),
  notes: text(r.notes),
  archived: bool(r.archived),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapAccount = (r: RowDataPacket, children: AccountChildren): SocialAccount => ({
  id: String(r.id),
  platformId: String(r.platform_id),
  platformAccountId: text(r.platform_account_id),
  assetType: r.asset_type as SocialAccount['assetType'],
  displayName: text(r.display_name),
  username: text(r.username),
  profileUrl: text(r.profile_url),
  brandId: id(r.brand_id),
  projectId: id(r.project_id),
  targetCountryCode: text(r.target_country_code),
  contentLanguage: text(r.content_language),
  responsibleTeamMemberId: id(r.responsible_user_id),
  loginEmailRef: text(r.login_email_ref),
  credentialId: id(r.credential_id),
  recoveryMethod: r.recovery_method as SocialAccount['recoveryMethod'],
  recoveryRef: text(r.recovery_ref),
  twoFaEnabled: bool(r.two_fa_enabled),
  twoFaMethod: r.two_fa_method as SocialAccount['twoFaMethod'],
  operationalStatus: r.operational_status as SocialAccount['operationalStatus'],
  allocationStatus: r.allocation_status as SocialAccount['allocationStatus'],
  simIds: children.simIds,
  lastAccessVerifiedDate: date(r.last_access_verified_date),
  lastPostingDate: date(r.last_posting_date),
  followerCount: int(r.follower_count),
  followerCountMeasuredAt: date(r.follower_count_measured_at),
  reservedForProjectId: id(r.reserved_for_project_id),
  notes: text(r.notes),
  archived: bool(r.archived),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapCredential = (r: RowDataPacket): CredentialRef => ({
  id: String(r.id),
  resourceType: r.resource_type as CredentialRef['resourceType'],
  resourceId: String(r.resource_id),
  provider: text(r.provider),
  loginIdentifier: text(r.login_identifier),
  vaultRef: text(r.vault_ref),
  ownerTeamMemberId: id(r.owner_user_id),
  accessStatus: r.access_status as CredentialRef['accessStatus'],
  lastRotationDate: date(r.last_rotation_date),
  twoFaEnabled: bool(r.two_fa_enabled),
  recoveryReady: bool(r.recovery_ready),
  lastAccessVerifiedDate: date(r.last_access_verified_date),
  notes: text(r.notes),
  archived: bool(r.archived),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapAssignment = (r: RowDataPacket): Assignment => ({
  id: String(r.id),
  resourceType: r.resource_type as Assignment['resourceType'],
  resourceId: String(r.resource_id),
  previousAssigneeId: id(r.previous_assignee_id),
  previousAssigneeType: (r.previous_assignee_type as Assignment['previousAssigneeType']) ?? null,
  newAssigneeId: String(r.new_assignee_id),
  newAssigneeType: r.new_assignee_type as Assignment['newAssigneeType'],
  role: r.role as Assignment['role'],
  brandId: id(r.brand_id),
  projectId: id(r.project_id),
  startDate: dateRequired(r.start_date),
  expectedReturnDate: date(r.expected_return_date),
  purpose: text(r.purpose),
  handoverStatus: r.handover_status as Assignment['handoverStatus'],
  acknowledgedAt: iso(r.acknowledged_at),
  acknowledgedBy: r.acknowledged_by === null ? null : text(r.acknowledged_by),
  returnedDate: date(r.returned_date),
  credentialAction: r.credential_action as Assignment['credentialAction'],
  active: bool(r.active),
  notes: text(r.notes),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapDomain = (r: RowDataPacket): DomainRecord => ({
  id: String(r.id),
  domainName: text(r.domain_name),
  targetCountry: r.target_country as DomainRecord['targetCountry'],
  rotationDate: date(r.rotation_date),
  registeredDate: dateRequired(r.registered_date),
  expirationDate: dateRequired(r.expiration_date),
  status: r.status as DomainRecord['status'],
  registrar: text(r.registrar),
  registrarUid: text(r.registrar_uid),
  category: text(r.category),
  nameservers: text(r.nameservers),
  brandId: id(r.brand_id),
  notes: text(r.notes),
  archived: bool(r.archived),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapCompetitor = (r: RowDataPacket): CompetitorRecord => ({
  id: String(r.id),
  platformId: String(r.platform_id),
  linkOrDomain: text(r.link_domain),
  whatsapp: text(r.whatsapp),
  telegram: text(r.telegram),
  others: text(r.others),
  notes: text(r.notes),
  archived: bool(r.archived),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapSnapshot = (r: RowDataPacket): FollowerSnapshot => ({
  id: String(r.id),
  accountId: String(r.account_id),
  date: dateRequired(r.snapshot_date),
  followerCount: Number(r.follower_count),
  recordedById: id(r.recorded_by_id),
  recordedAt: isoRequired(r.recorded_at),
  note: text(r.note),
});

export const mapContentPost = (r: RowDataPacket): ContentPost => ({
  id: String(r.id),
  accountId: String(r.account_id),
  platformId: String(r.platform_id),
  format: r.format as ContentPost['format'],
  title: text(r.title),
  url: text(r.url),
  publishedDate: dateRequired(r.published_date),
  views: Number(r.views),
  likes: Number(r.likes),
  comments: Number(r.comments),
  shares: Number(r.shares),
  followerGain: int(r.follower_gain),
  metricsMeasuredAt: dateRequired(r.metrics_measured_at),
  notes: text(r.notes),
  archived: bool(r.archived),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export const mapAuditEntry = (r: RowDataPacket, changes: AuditEntry['changes']): AuditEntry => ({
  id: String(r.id),
  // The actor row may since have been removed; the denormalised name and role
  // are what keep the entry readable, so a null id is not a broken entry.
  actorId: text(r.actor_id),
  actorName: text(r.actor_name),
  actorRole: r.actor_role as AuditEntry['actorRole'],
  timestamp: isoRequired(r.occurred_at),
  recordType: text(r.record_type),
  recordId: text(r.record_id),
  recordLabel: text(r.record_label),
  action: r.action as AuditEntry['action'],
  reason: text(r.reason),
  changes,
});

export const mapAuditChange = (r: RowDataPacket): AuditEntry['changes'][number] => ({
  field: text(r.field),
  from: r.value_from === null ? null : String(r.value_from),
  to: r.value_to === null ? null : String(r.value_to),
});
