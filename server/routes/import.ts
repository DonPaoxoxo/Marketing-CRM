/** Committing a validated CSV import.
 *
 *  The browser validates and previews; this decides. Rows arrive having never
 *  touched a form, so they are sanitised here as they land, and anything that
 *  would duplicate a live record is skipped rather than overwriting it — an
 *  import must not be able to silently replace a register entry.
 *
 *  The one exception is explicit: a domain upload sent with `overwrite: true`
 *  (the person ticked "Update domains already in the register" and saw every
 *  change in the preview) updates live domains, and each update is written to
 *  that domain's audit history with its old and new values. */

import { Router } from 'express';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { Agent, SocialAccount } from '../../src/lib/types';
import { sanitizeText, sanitizeUrl } from '../../src/lib/sanitize';
import { normalizePhone } from '../../src/lib/utils';
import { execute, query, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { requirePermission } from '../auth/middleware';
import { asyncHandler, badRequest, forbidden } from '../http/errors';
import { hasPermission } from '../../src/lib/permissions';
import {
  ACCOUNT_COLUMNS, AGENT_COLUMNS, DOMAIN_COLUMNS, SIM_COLUMNS, buildInsert, buildUpdate, readDomain,
} from '../repositories/records';
import {
  domainRawFromRecord, domainSheetChanges, domainUpdateFields, validateDomainRow,
} from '../../src/lib/domain-import';
import { actorOf, bodyOf, nowDate } from './helpers';
import { pageUrlKey, phoneKey } from '../../src/lib/identity';
import {
  addTaken, noneTaken, simRawFromRecord, takenBySims, validateSimRow, type TakenSims,
} from '../../src/lib/sim-import';
import type { Country } from '../../src/lib/types';

export const importRouter = Router();

const ENTITIES = ['sims', 'agents', 'social-accounts', 'domains'] as const;
type Entity = (typeof ENTITIES)[number];

/** A ceiling on one commit. Large imports are a real need, but an unbounded
 *  one is a way to hold a transaction open across the whole register. */
const MAX_ROWS = 5000;

const clean = (value: unknown, max: number) => sanitizeText(value, max);

/** Identities already taken, loaded once per import and grown as rows land.
 *
 *  Comparison goes through the same keys as a form save, so an import cannot
 *  sneak in what the form would refuse — and because each inserted row adds its
 *  own keys, a value repeated *within* the file is caught on its second line. */
interface Seen {
  countries: Country[];
  /** For SIM numbers written without a country code; chosen in the upload. */
  fallbackCountryCode: string | null;
  sims: TakenSims;
  /** Every domain name, archived included — the name is unique register-wide. */
  domainNames: Set<string>;
  archivedDomains: Set<string>;
  domainIds: Map<string, string>;
  /** Names already created or updated by this import: a second row for the same
   *  domain is refused, never applied twice. */
  domainsInFile: Set<string>;
  /** Update live domains instead of skipping them (domain uploads only). */
  overwrite: boolean;
  actor: ReturnType<typeof actorOf>;
  reason: string;
  accountIds: Set<string>;
  accountUrls: Set<string>;
  agentPhones: Set<string>;
}

async function loadSeen(
  conn: PoolConnection,
  fallbackCountryCode: string | null,
  extra: Pick<Seen, 'overwrite' | 'actor' | 'reason'>,
): Promise<Seen> {
  const [countryRows, sims, accounts, agents, domains] = await Promise.all([
    query<RowDataPacket>('SELECT code, name, dial_code FROM countries', [], conn),
    query<RowDataPacket>('SELECT phone_number, email, telegram_username FROM sims WHERE archived = 0', [], conn),
    query<RowDataPacket>('SELECT platform_id, platform_account_id, profile_url FROM social_accounts WHERE archived = 0', [], conn),
    query<RowDataPacket>("SELECT contact_number FROM agents WHERE archived = 0 AND contact_number <> ''", [], conn),
    query<RowDataPacket>('SELECT id, domain_name, archived FROM domains', [], conn),
  ]);
  return {
    countries: countryRows.map((c) => ({ code: String(c.code), name: String(c.name), dialCode: String(c.dial_code) })),
    fallbackCountryCode,
    // Live SIMs only, as for a single save: an archived SIM's number can come back.
    sims: takenBySims(sims.map((r) => ({
      phoneNumber: String(r.phone_number), email: String(r.email ?? ''), telegramUsername: String(r.telegram_username ?? ''), archived: false,
    }))),
    accountIds: new Set(accounts.filter((a) => String(a.platform_account_id).trim())
      .map((a) => `${a.platform_id}::${String(a.platform_account_id).trim()}`)),
    accountUrls: new Set(accounts.map((a) => pageUrlKey(String(a.profile_url))).filter(Boolean)),
    agentPhones: new Set(agents.map((a) => phoneKey(String(a.contact_number))).filter(Boolean)),
    domainNames: new Set(domains.map((d) => String(d.domain_name))),
    archivedDomains: new Set(domains.filter((d) => Boolean(d.archived)).map((d) => String(d.domain_name))),
    domainIds: new Map(domains.map((d) => [String(d.domain_name), String(d.id)])),
    domainsInFile: new Set(),
    ...extra,
  };
}

/** An importer's verdict on one row: `true` created, `{ updated }` an existing
 *  record updated (or already identical), a string the reason it was skipped.
 *  A reason is returned, not thrown: one bad row is skipped and named, and the
 *  rest of the file still goes in. */
type RowOutcome = true | { updated: boolean } | string;

async function importSim(conn: PoolConnection, row: Record<string, unknown>, seen: Seen): Promise<RowOutcome> {
  // The same rule as the upload preview, so a row the preview called ready is
  // refused here only if the register changed in between. `seen.sims` holds the
  // live register plus every row already added by this import.
  const { value, problems } = validateSimRow(simRawFromRecord(row), {
    countries: seen.countries, fallbackCountryCode: seen.fallbackCountryCode, existing: seen.sims, seen: noneTaken(),
  });
  if (!value) return problems.map((p) => `${p.column}: ${p.message}`).join(' ');

  const id = await nextId('SIM', conn);
  const now = nowDate();
  const insert = buildInsert('sims', SIM_COLUMNS, {
    ...value,
    assigneeId: null,
    assigneeType: null,
    brandId: null,
    projectId: null,
    planExpiryDate: null,
    archived: false,
  }, { id, created_at: now, updated_at: now });
  await execute(insert.sql, insert.params, conn);
  addTaken(seen.sims, value);
  return true;
}

async function importAgent(conn: PoolConnection, row: Record<string, unknown>, seen: Seen): Promise<RowOutcome> {
  const name = clean(row.name, 160);
  if (!name) return 'Name is required.';

  const contactNumber = normalizePhone(String(row.contactNumber ?? ''));
  const phone = phoneKey(contactNumber);
  if (phone && seen.agentPhones.has(phone)) return 'Another agent already has this contact number.';

  const id = await nextId('AGT', conn);
  const now = nowDate();
  const insert = buildInsert('agents', AGENT_COLUMNS, {
    name,
    externalUid: '',
    agentType: (row.agentType as Agent['agentType']) ?? 'Individual',
    contactNumber,
    email: clean(row.email, 160),
    preferredChannel: (row.preferredChannel as Agent['preferredChannel']) ?? 'Email',
    managerId: null,
    cooperationStatus: (row.cooperationStatus as Agent['cooperationStatus']) ?? 'Prospect',
    startDate: (row.startDate as string) || null,
    lastContactedDate: null,
    nextFollowUpDate: null,
    agreementRef: clean(row.agreementRef, 200),
    notes: clean(row.notes, 4000),
    archived: false,
  }, { id, created_at: now, updated_at: now });
  await execute(insert.sql, insert.params, conn);
  if (phone) seen.agentPhones.add(phone);
  return true;
}

async function importAccount(conn: PoolConnection, row: Record<string, unknown>, seen: Seen): Promise<RowOutcome> {
  const username = clean(row.username, 160);
  if (!username) return 'Username or handle is required.';

  // The CSV names a platform, not an id — an unknown one is skipped rather than
  // quietly creating a platform the configuration does not have.
  const platform = await queryOne<RowDataPacket>(
    'SELECT id FROM platforms WHERE LOWER(name) = LOWER(?) LIMIT 1',
    [String(row.platform ?? '')],
    conn,
  );
  if (!platform) return 'Unknown platform.';

  // Handles may repeat (see social-accounts.ts). The platform ID and the profile
  // URL may not, and each is checked on its own: a row can clash on either.
  const platformAccountId = clean(row.platformAccountId, 200);
  const profileUrl = sanitizeUrl(row.profileUrl);
  const idKey = platformAccountId ? `${platform.id}::${platformAccountId}` : '';
  const urlKey = pageUrlKey(profileUrl);
  if (idKey && seen.accountIds.has(idKey)) return 'An account with this platform ID already exists.';
  if (urlKey && seen.accountUrls.has(urlKey)) return 'An account with this profile URL already exists.';

  const id = await nextId('ACC', conn);
  const now = nowDate();
  const insert = buildInsert('social_accounts', ACCOUNT_COLUMNS, {
    platformId: String(platform.id),
    platformAccountId,
    assetType: (row.assetType as SocialAccount['assetType']) ?? 'Profile',
    displayName: clean(row.displayName, 160) || username,
    username,
    profileUrl,
    brandId: (row.brandId as string) || null,
    projectId: null,
    targetCountryCode: String(row.targetCountryCode ?? 'IN'),
    contentLanguage: clean(row.contentLanguage, 160) || 'English',
    responsibleTeamMemberId: null,
    loginEmailRef: clean(row.loginEmailRef, 200),
    credentialId: null,
    recoveryMethod: 'None',
    recoveryRef: '',
    twoFaEnabled: false,
    twoFaMethod: 'None',
    operationalStatus: (row.operationalStatus as SocialAccount['operationalStatus']) ?? 'Active',
    allocationStatus: (row.allocationStatus as SocialAccount['allocationStatus']) ?? 'Unassigned',
    lastAccessVerifiedDate: null,
    lastPostingDate: null,
    followerCount: null,
    followerCountMeasuredAt: null,
    reservedForProjectId: null,
    notes: clean(row.notes, 4000),
    archived: false,
  }, { id, created_at: now, updated_at: now });
  await execute(insert.sql, insert.params, conn);
  if (idKey) seen.accountIds.add(idKey);
  if (urlKey) seen.accountUrls.add(urlKey);
  return true;
}

async function importDomain(conn: PoolConnection, row: Record<string, unknown>, seen: Seen): Promise<RowOutcome> {
  // The same rule as the upload preview; `seen.domainNames` holds the register
  // plus every domain already added by this import.
  const raw = domainRawFromRecord(row);
  const { value, problems } = validateDomainRow(raw, {
    existing: seen.domainNames, archived: seen.archivedDomains, seen: seen.domainsInFile, overwrite: seen.overwrite,
  });
  if (!value) return problems.map((p) => `${p.column}: ${p.message}`).join(' ');
  seen.domainsInFile.add(value.domainName);

  const existingId = seen.domainIds.get(value.domainName);
  if (existingId) {
    const before = await readDomain(existingId, conn);
    if (!before) return 'Domain: not found.';
    const fields = domainUpdateFields(raw, value);
    const changes = domainSheetChanges(before, fields);
    if (!changes.length) return { updated: false };
    const patch = Object.fromEntries(changes.map((c) => [c.field, c.to]));
    const update = buildUpdate('domains', DOMAIN_COLUMNS, patch, existingId, { updated_at: nowDate() });
    if (update) await execute(update.sql, update.params, conn);
    await recordAudit(conn, {
      actor: seen.actor, recordType: 'Domain', recordId: existingId, recordLabel: value.domainName,
      action: changes.some((c) => c.field === 'status') ? 'status-change' : 'update',
      reason: seen.reason, changes,
    });
    return { updated: true };
  }

  const id = await nextId('DOM', conn);
  const now = nowDate();
  const insert = buildInsert('domains', DOMAIN_COLUMNS, {
    ...value,
    rotationDate: null,
    brandId: null,
    notes: '',
    archived: false,
  }, { id, created_at: now, updated_at: now });
  await execute(insert.sql, insert.params, conn);
  seen.domainNames.add(value.domainName);
  return true;
}

const IMPORTERS: Record<Entity, (conn: PoolConnection, row: Record<string, unknown>, seen: Seen) => Promise<RowOutcome>> = {
  sims: importSim,
  agents: importAgent,
  'social-accounts': importAccount,
  domains: importDomain,
};

importRouter.post('/:entity', requirePermission('import:records'), asyncHandler(async (req, res) => {
  const entity = String(req.params.entity) as Entity;
  if (!ENTITIES.includes(entity)) throw badRequest(`"${entity}" cannot be imported.`);

  const { rows, reason, fallbackCountryCode, overwrite } =
    bodyOf<{ rows?: Record<string, unknown>[]; reason?: string; fallbackCountryCode?: string; overwrite?: boolean }>(req);
  const updating = entity === 'domains' && overwrite === true;
  // SIM bulk upload lives on the SIMs page; domain uploads on Domains; agents and
  // accounts on the Import page. Each needs that page's permission.
  const pagePermission = entity === 'domains' ? 'access:domains' : entity === 'sims' ? null : 'access:import';
  if (pagePermission && !hasPermission(req.user, pagePermission)) {
    throw forbidden(`You do not have access to import ${entity}.`);
  }
  // Replacing a record's details is an edit, so it needs the edit permission too.
  if (updating && !hasPermission(req.user, 'edit:resources')) {
    throw forbidden(`Your role (${req.user!.role}) cannot update existing domains.`);
  }
  if (!Array.isArray(rows) || !rows.length) throw badRequest('No rows were submitted.');
  if (rows.length > MAX_ROWS) {
    throw badRequest(`An import is limited to ${MAX_ROWS} rows. Split the file and run it again.`);
  }

  const actor = actorOf(req);
  const importRow = IMPORTERS[entity];

  const { created, updated, unchanged, problems } = await tx(async (conn) => {
    let count = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const skipped: { row: number; reason: string }[] = [];
    const seen = await loadSeen(conn, typeof fallbackCountryCode === 'string' ? fallbackCountryCode : null, {
      overwrite: updating, actor, reason: reason ?? 'Bulk upload',
    });
    for (const [index, row] of rows.entries()) {
      // The client sends the spreadsheet's own row number, so a skip can be found.
      const rowNumber = Number((row as { rowNumber?: unknown })?.rowNumber) || index + 1;
      const outcome = row && typeof row === 'object' ? await importRow(conn, row, seen) : 'Not a row.';
      if (outcome === true) count++;
      else if (typeof outcome === 'object') {
        if (outcome.updated) updatedCount++;
        else unchangedCount++;
      } else skipped.push({ row: rowNumber, reason: outcome });
    }
    await recordAudit(conn, {
      actor, recordType: 'Import', recordId: entity, recordLabel: `${entity} CSV import`, action: 'import',
      reason: reason ?? 'CSV import committed',
      changes: [
        { field: 'rowsCreated', from: null, to: count },
        ...(updating ? [{ field: 'rowsUpdated', from: null, to: updatedCount }] : []),
        { field: 'rowsSubmitted', from: null, to: rows.length },
      ],
    });
    return { created: count, updated: updatedCount, unchanged: unchangedCount, problems: skipped.slice(0, 200) };
  });

  // Reasons are capped: a file of five thousand identical mistakes needs the
  // first few, not a five-megabyte response.
  res.json({ created, updated, unchanged, skipped: rows.length - created - updated - unchanged, problems });
}));
