/** Turning a domain record into SQL — the pure half of the repository.
 *
 *  Separate from `records.ts` so the statement builders can be imported, and
 *  tested, without a database connection: `records.ts` reaches the pool, the
 *  pool reads the validated environment, and requiring credentials to check that
 *  a column name is spelled correctly would mean these rules go untested.
 *
 *  Only fields named in a column map are ever written. A request carrying an
 *  unexpected key cannot reach the database through this path — it is dropped
 *  before any SQL is built, which is the point of building statements from a map
 *  rather than spreading a request body into a query. */

/** A column, plus how an empty value should reach it.
 *
 *  `nullIfEmpty` matters for dates and foreign keys: a cleared date field arrives
 *  as `''` from a form, and `''` in a DATE column is a MySQL error while `''` in
 *  a foreign key is a constraint violation. Both mean "no value". */
type ColumnSpec = string | { col: string; nullIfEmpty: true };

const nullable = (col: string): ColumnSpec => ({ col, nullIfEmpty: true });

export type ColumnMap = Record<string, ColumnSpec>;

/* ── Column maps ──────────────────────────────────────────────── */

export const SIM_COLUMNS: ColumnMap = {
  phoneNumber: 'phone_number',
  countryCode: 'country_code',
  provider: 'provider',
  form: 'form',
  createdFor: 'created_for',
  email: 'email',
  telegramUsername: 'telegram_username',
  assigneeId: nullable('assignee_id'),
  assigneeType: nullable('assignee_type'),
  brandId: nullable('brand_id'),
  projectId: nullable('project_id'),
  operationalStatus: 'operational_status',
  allocationStatus: 'allocation_status',
  planExpiryDate: nullable('plan_expiry_date'),
  lastVerifiedDate: nullable('last_verified_date'),
  notes: 'notes',
  archived: 'archived',
};

export const AGENT_COLUMNS: ColumnMap = {
  name: 'name',
  externalUid: 'external_uid',
  agentType: 'agent_type',
  contactNumber: 'contact_number',
  email: 'email',
  preferredChannel: 'preferred_channel',
  managerId: nullable('manager_id'),
  cooperationStatus: 'cooperation_status',
  startDate: nullable('start_date'),
  lastContactedDate: nullable('last_contacted_date'),
  nextFollowUpDate: nullable('next_follow_up_date'),
  agreementRef: 'agreement_ref',
  notes: 'notes',
  archived: 'archived',
};

export const ACCOUNT_COLUMNS: ColumnMap = {
  platformId: 'platform_id',
  platformAccountId: 'platform_account_id',
  assetType: 'asset_type',
  displayName: 'display_name',
  username: 'username',
  profileUrl: 'profile_url',
  brandId: nullable('brand_id'),
  projectId: nullable('project_id'),
  targetCountryCode: nullable('target_country_code'),
  contentLanguage: 'content_language',
  responsibleTeamMemberId: nullable('responsible_user_id'),
  loginEmailRef: 'login_email_ref',
  credentialId: nullable('credential_id'),
  recoveryMethod: 'recovery_method',
  recoveryRef: 'recovery_ref',
  twoFaEnabled: 'two_fa_enabled',
  twoFaMethod: 'two_fa_method',
  operationalStatus: 'operational_status',
  allocationStatus: 'allocation_status',
  lastAccessVerifiedDate: nullable('last_access_verified_date'),
  lastPostingDate: nullable('last_posting_date'),
  followerCount: nullable('follower_count'),
  followerCountMeasuredAt: nullable('follower_count_measured_at'),
  reservedForProjectId: nullable('reserved_for_project_id'),
  notes: 'notes',
  archived: 'archived',
};

export const CREDENTIAL_COLUMNS: ColumnMap = {
  resourceType: 'resource_type',
  resourceId: 'resource_id',
  provider: 'provider',
  loginIdentifier: 'login_identifier',
  vaultRef: 'vault_ref',
  ownerTeamMemberId: nullable('owner_user_id'),
  accessStatus: 'access_status',
  lastRotationDate: nullable('last_rotation_date'),
  twoFaEnabled: 'two_fa_enabled',
  recoveryReady: 'recovery_ready',
  lastAccessVerifiedDate: nullable('last_access_verified_date'),
  notes: 'notes',
  archived: 'archived',
};

export const ASSIGNMENT_COLUMNS: ColumnMap = {
  resourceType: 'resource_type',
  resourceId: 'resource_id',
  previousAssigneeId: nullable('previous_assignee_id'),
  previousAssigneeType: nullable('previous_assignee_type'),
  newAssigneeId: 'new_assignee_id',
  newAssigneeType: 'new_assignee_type',
  role: 'role',
  brandId: nullable('brand_id'),
  projectId: nullable('project_id'),
  startDate: 'start_date',
  expectedReturnDate: nullable('expected_return_date'),
  purpose: 'purpose',
  handoverStatus: 'handover_status',
  acknowledgedAt: nullable('acknowledged_at'),
  acknowledgedBy: nullable('acknowledged_by'),
  returnedDate: nullable('returned_date'),
  credentialAction: 'credential_action',
  active: 'active',
  notes: 'notes',
};

export const DOMAIN_COLUMNS: ColumnMap = {
  domainName: 'domain_name',
  targetCountry: 'target_country',
  rotationDate: nullable('rotation_date'),
  registeredDate: 'registered_date',
  expirationDate: 'expiration_date',
  status: 'status',
  registrar: 'registrar',
  registrarUid: 'registrar_uid',
  category: 'category',
  nameservers: 'nameservers',
  brandId: nullable('brand_id'),
  notes: 'notes',
  archived: 'archived',
};

export const CONTENT_POST_COLUMNS: ColumnMap = {
  accountId: 'account_id',
  platformId: 'platform_id',
  format: 'format',
  title: 'title',
  url: 'url',
  publishedDate: 'published_date',
  views: 'views',
  likes: 'likes',
  comments: 'comments',
  shares: 'shares',
  followerGain: nullable('follower_gain'),
  metricsMeasuredAt: 'metrics_measured_at',
  notes: 'notes',
  archived: 'archived',
};

export const COMPETITOR_COLUMNS: ColumnMap = {
  platformId: 'platform_id',
  linkOrDomain: 'link_domain',
  whatsapp: 'whatsapp',
  telegram: 'telegram',
  others: 'others',
  notes: 'notes',
  archived: 'archived',
};

/* ── Statement building ───────────────────────────────────────── */

function coerce(value: unknown, spec: ColumnSpec): unknown {
  if (typeof spec !== 'string' && spec.nullIfEmpty && (value === '' || value === undefined)) return null;
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

const columnOf = (spec: ColumnSpec): string => (typeof spec === 'string' ? spec : spec.col);

/** Narrow a request body to the fields this entity actually stores.
 *
 *  Anything not in the map is discarded rather than rejected: the client also
 *  sends `reason`, and a stale build may send a field this server does not know. */
export function pick<T extends object>(body: T, columns: ColumnMap): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(columns)) {
    if (key in body) out[key] = (body as Record<string, unknown>)[key];
  }
  return out as Partial<T>;
}

export interface Statement { sql: string; params: unknown[] }

/** Builds an INSERT for the fields present. `fixed` carries the columns the
 *  server owns rather than the client — the id and the timestamps. */
export function buildInsert(
  table: string,
  columns: ColumnMap,
  record: Record<string, unknown>,
  fixed: Record<string, unknown>,
): Statement {
  const names: string[] = [];
  const params: unknown[] = [];

  for (const [field, spec] of Object.entries(columns)) {
    if (!(field in record)) continue;
    names.push(columnOf(spec));
    params.push(coerce(record[field], spec));
  }
  for (const [name, value] of Object.entries(fixed)) {
    names.push(name);
    params.push(value);
  }

  const placeholders = names.map(() => '?').join(', ');
  return { sql: `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`, params };
}

/** Builds an UPDATE, or null when the patch touches nothing this entity stores
 *  — an empty SET clause is a syntax error, not a no-op. */
export function buildUpdate(
  table: string,
  columns: ColumnMap,
  patch: Record<string, unknown>,
  id: string,
  fixed: Record<string, unknown> = {},
): Statement | null {
  const sets: string[] = [];
  const params: unknown[] = [];

  for (const [field, spec] of Object.entries(columns)) {
    if (!(field in patch)) continue;
    sets.push(`${columnOf(spec)} = ?`);
    params.push(coerce(patch[field], spec));
  }
  for (const [name, value] of Object.entries(fixed)) {
    sets.push(`${name} = ?`);
    params.push(value);
  }
  if (!sets.length) return null;

  params.push(id);
  return { sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, params };
}

/** The field-level diff an audit entry carries.
 *
 *  Compares the patch against the record as it was, so a save that changes
 *  nothing writes no history — the same rule the mock applies, and what keeps
 *  the audit page a list of changes rather than a list of saves. */
export function diffRecords(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): { field: string; from: unknown; to: unknown }[] {
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const [field, next] of Object.entries(patch)) {
    if (next === undefined) continue;
    const prev = before[field];
    const same = Array.isArray(prev) && Array.isArray(next)
      ? prev.length === next.length && prev.every((v, i) => v === next[i])
      : (prev ?? null) === (next ?? null);
    if (!same) changes.push({ field, from: prev ?? null, to: next ?? null });
  }
  return changes;
}
