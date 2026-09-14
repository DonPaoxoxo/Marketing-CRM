/** Reading domains from the registrar export — one rule for browser and server.
 *
 *  The sheet: Domain · Country · UID · Registration Time · Expire Date ·
 *  Registrar · Status · Category · Nameservers.
 *
 *  The upload preview, the server's import endpoint and the mock API all
 *  validate through `validateDomainRow`, so a row the preview marks "ready" is a
 *  row the server accepts, refused for the same stated reason if not.
 *
 *  Pure: no DOM, no database. */

import { DOMAIN_COUNTRY, type DomainCountry, type DomainStatus } from './types';
import { sanitizeText } from './sanitize';
import { DOMAIN_PATTERN, normalizeDomain } from './utils';
import {
  cellText, mapHeaders, readSheetDate, squash, walkSheet,
  type HeaderMapping, type SheetColumn, type SheetResult,
} from './sheet';

export type DomainImportKey =
  | 'domain' | 'country' | 'uid' | 'registrationTime' | 'expireDate'
  | 'registrar' | 'status' | 'category' | 'nameservers';

export const DOMAIN_IMPORT_COLUMNS: readonly SheetColumn<DomainImportKey>[] = [
  { key: 'domain', header: 'Domain', required: true, aliases: ['domain name', 'domains', 'name'], help: 'e.g. samplegamehub.com — without https:// or www.' },
  {
    key: 'country', header: 'Country', required: true, aliases: ['target country'],
    help: `${DOMAIN_COUNTRY.join(', ')}. "Available" means not yet given to a country.`,
  },
  { key: 'uid', header: 'UID', required: false, aliases: ['account', 'account id', 'registrar uid'], help: 'The registrar account the domain sits in, e.g. 241089.' },
  {
    key: 'registrationTime', header: 'Registration Time', required: true,
    aliases: ['registration date', 'registered', 'registered date', 'created'],
    help: 'e.g. 9/8/2026 14:40. The time is not kept.',
  },
  {
    key: 'expireDate', header: 'Expire Date', required: true,
    aliases: ['expiration date', 'expiry date', 'expires', 'expiry', 'expiration'],
    help: 'e.g. 9/8/2027 14:40. On or after the registration date.',
  },
  { key: 'registrar', header: 'Registrar', required: false, aliases: [], help: 'e.g. RealTime, Gname.' },
  {
    key: 'status', header: 'Status', required: false, aliases: ['domain status'],
    help: 'OK is saved as Active; Expired, ClientHold, Redemption and similar as Inactive. Blank means Active.',
  },
  { key: 'category', header: 'Category', required: false, aliases: ['group'], help: 'The registrar\'s grouping, e.g. Ungrouped.' },
  {
    key: 'nameservers', header: 'Nameservers', required: false, aliases: ['name servers', 'ns', 'dns'],
    help: 'Comma-separated, e.g. chad.ns.cloudflare.com,clarissa.ns.cloudflare.com.',
  },
];

export const mapDomainHeaders = (headerRow: readonly unknown[]): HeaderMapping<DomainImportKey> =>
  mapHeaders(DOMAIN_IMPORT_COLUMNS, headerRow);

/* ── Values ──────────────────────────────────────────────────────── */

const COUNTRY: Record<string, DomainCountry> = {
  india: 'India', in: 'India',
  indonesia: 'Indonesia', id: 'Indonesia',
  available: 'Available',
};

/** Registrar statuses onto the register's two. A transfer lock is a normal,
 *  healthy state; the holds, expiry and deletion states mean the domain does
 *  not resolve for visitors. */
const STATUS: Record<string, DomainStatus> = {
  ok: 'Active', active: 'Active', clienttransferprohibited: 'Active', servertransferprohibited: 'Active', locked: 'Active',
  inactive: 'Inactive', expired: 'Inactive', redemption: 'Inactive', redemptionperiod: 'Inactive', pendingdelete: 'Inactive',
  clienthold: 'Inactive', serverhold: 'Inactive', hold: 'Inactive', suspended: 'Inactive',
};

/** Nameservers as one comparable string: split on commas, spaces or semicolons,
 *  lower-cased, trailing dots dropped, repeats removed, joined with commas.
 *  Returns an error naming the first entry that is not a hostname. */
export function readNameservers(raw: string): { value: string } | { error: string } {
  const entries = raw.split(/[\s,;]+/).map((n) => n.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean);
  const bad = entries.find((n) => !DOMAIN_PATTERN.test(n));
  if (bad) return { error: `"${bad}" is not a nameserver hostname.` };
  const value = [...new Set(entries)].join(',');
  if (value.length > 1000) return { error: 'Too many nameservers.' };
  return { value };
}

/* ── The same fields on a single save ───────────────────────────── */

/** Registrar, UID, Category and Nameservers as the domain form and routes accept
 *  them — the same rules as a sheet row. Absent fields stay absent (a partial
 *  update); blank means cleared. */
export function checkDomainExtras(input: {
  targetCountry?: unknown; registrar?: unknown; registrarUid?: unknown; category?: unknown; nameservers?: unknown;
}):
  { value: Partial<Pick<DomainImportInput, 'targetCountry' | 'registrar' | 'registrarUid' | 'category' | 'nameservers'>> } | { field: string; message: string } {
  const value: Partial<Pick<DomainImportInput, 'targetCountry' | 'registrar' | 'registrarUid' | 'category' | 'nameservers'>> = {};
  // The form only offers the allowed countries, but a request can send anything.
  if (input.targetCountry !== undefined) {
    const country = COUNTRY[squash(String(input.targetCountry ?? ''))];
    if (!country) return { field: 'targetCountry', message: `Use ${DOMAIN_COUNTRY.join(', ')}.` };
    value.targetCountry = country;
  }
  if (input.registrar !== undefined) value.registrar = sanitizeText(input.registrar, 80);
  if (input.registrarUid !== undefined) value.registrarUid = sanitizeText(cellText(input.registrarUid), 64);
  if (input.category !== undefined) value.category = sanitizeText(input.category, 80);
  if (input.nameservers !== undefined) {
    const ns = readNameservers(String(input.nameservers ?? ''));
    if ('error' in ns) return { field: 'nameservers', message: ns.error };
    value.nameservers = ns.value;
  }
  return { value };
}

/* ── Rows ────────────────────────────────────────────────────────── */

export interface DomainImportInput {
  domainName: string;
  targetCountry: DomainCountry;
  registeredDate: string;
  expirationDate: string;
  status: DomainStatus;
  registrar: string;
  registrarUid: string;
  category: string;
  nameservers: string;
}

export interface DomainValidationContext {
  /** Every domain name in the register, archived included: the name is unique
   *  across the whole register, so a retired domain keeps it reserved. */
  existing: ReadonlySet<string>;
  /** Names of earlier rows in the same file. The caller adds each accepted row. */
  seen: ReadonlySet<string>;
  /** The person chose to update domains already in the register. Without it an
   *  existing name is a problem: nothing is ever overwritten by default. */
  overwrite?: boolean;
  /** Archived names. Never updated from a sheet, even with `overwrite`. */
  archived?: ReadonlySet<string>;
  today?: Date;
}

const headerOf = (key: DomainImportKey) => DOMAIN_IMPORT_COLUMNS.find((c) => c.key === key)!.header;

/** Validate one row. Every problem is reported at once, by the sheet's column names. */
export function validateDomainRow(
  raw: Partial<Record<DomainImportKey, string>>,
  ctx: DomainValidationContext,
): SheetResult<DomainImportKey, DomainImportInput>['rows'][number]['result'] {
  const problems: { column: string; message: string }[] = [];
  const say = (key: DomainImportKey, message: string) => problems.push({ column: headerOf(key), message });
  const today = ctx.today ?? new Date();

  const domainText = (raw.domain ?? '').trim();
  const domainName = normalizeDomain(domainText);
  if (!domainText) say('domain', 'Required.');
  else if (!DOMAIN_PATTERN.test(domainName)) say('domain', `"${domainText}" is not a domain name.`);
  else if (ctx.seen.has(domainName)) say('domain', `${domainName} appears earlier in this file.`);
  else if (ctx.archived?.has(domainName)) say('domain', `${domainName} is archived. Restore it before updating it from a sheet.`);
  else if (ctx.existing.has(domainName) && !ctx.overwrite) {
    say('domain', `${domainName} is already in the register. Turn on "Update domains already in the register" to replace its details.`);
  }

  const countryText = squash(raw.country ?? '');
  const targetCountry = COUNTRY[countryText];
  if (!countryText) say('country', `Required — ${DOMAIN_COUNTRY.join(', ')}.`);
  else if (!targetCountry) say('country', `Use ${DOMAIN_COUNTRY.join(', ')}.`);

  const registered = raw.registrationTime?.trim()
    ? readSheetDate(raw.registrationTime, today)
    : { error: 'Required.' } as const;
  if ('error' in registered) say('registrationTime', registered.error);

  const expires = raw.expireDate?.trim()
    ? readSheetDate(raw.expireDate, today, { allowFuture: true })
    : { error: 'Required.' } as const;
  if ('error' in expires) say('expireDate', expires.error);
  else if (!('error' in registered) && registered.date && expires.date && expires.date < registered.date) {
    say('expireDate', 'Cannot be before the registration date.');
  }

  const statusText = squash(raw.status ?? '');
  const status = statusText ? STATUS[statusText] : 'Active';
  if (!status) say('status', 'Use OK or Active, or a registrar state such as Expired or ClientHold.');

  const ns = readNameservers(raw.nameservers ?? '');
  if ('error' in ns) say('nameservers', ns.error);

  if (problems.length || 'error' in registered || 'error' in expires || 'error' in ns) return { value: null, problems };
  return {
    value: {
      domainName,
      targetCountry: targetCountry!,
      registeredDate: registered.date!,
      expirationDate: expires.date!,
      status: status!,
      registrar: sanitizeText(raw.registrar ?? '', 80),
      registrarUid: sanitizeText(raw.uid ?? '', 64),
      category: sanitizeText(raw.category ?? '', 80),
      nameservers: ns.value,
    },
    problems,
  };
}

/** A submitted import row as the rule's raw columns. Accepts the sheet's keys
 *  and a validated row's keys, so the server re-checks either. */
export function domainRawFromRecord(row: Record<string, unknown>): Partial<Record<DomainImportKey, string>> {
  return {
    domain: cellText(row.domain ?? row.domainName),
    country: cellText(row.country ?? row.targetCountry),
    uid: cellText(row.uid ?? row.registrarUid),
    registrationTime: cellText(row.registrationTime ?? row.registeredDate),
    expireDate: cellText(row.expireDate ?? row.expirationDate),
    registrar: cellText(row.registrar),
    status: cellText(row.status),
    category: cellText(row.category),
    nameservers: cellText(row.nameservers),
  };
}

/* ── Updating a domain already in the register ─────────────────── */

/** What a sheet row replaces on an existing domain. Country and both dates are
 *  required columns, so they always apply; an optional cell left blank keeps the
 *  register's current value rather than wiping it. Rotation date, brand and notes
 *  are not in the sheet and are never touched. */
export function domainUpdateFields(
  raw: Partial<Record<DomainImportKey, string>>,
  value: DomainImportInput,
): Partial<DomainImportInput> {
  const filled = (key: DomainImportKey) => Boolean((raw[key] ?? '').trim());
  const fields: Partial<DomainImportInput> = {
    targetCountry: value.targetCountry,
    registeredDate: value.registeredDate,
    expirationDate: value.expirationDate,
  };
  if (filled('status')) fields.status = value.status;
  if (filled('registrar')) fields.registrar = value.registrar;
  if (filled('uid')) fields.registrarUid = value.registrarUid;
  if (filled('category')) fields.category = value.category;
  if (filled('nameservers')) fields.nameservers = value.nameservers;
  return fields;
}

/** The fields that would actually change, with their old and new values — shown
 *  in the preview and written to the audit history. */
export function domainSheetChanges(
  before: Partial<Record<keyof DomainImportInput, unknown>>,
  fields: Partial<DomainImportInput>,
): { field: keyof DomainImportInput; from: string; to: string }[] {
  return (Object.entries(fields) as [keyof DomainImportInput, string][])
    .filter(([field, to]) => String(before[field] ?? '') !== to)
    .map(([field, to]) => ({ field, from: String(before[field] ?? ''), to }));
}

export const DOMAIN_FIELD_LABELS: Record<keyof DomainImportInput, string> = {
  domainName: 'Domain', targetCountry: 'Country', registeredDate: 'Registered', expirationDate: 'Expires',
  status: 'Status', registrar: 'Registrar', registrarUid: 'UID', category: 'Category', nameservers: 'Nameservers',
};

export type DomainSheetResult = SheetResult<DomainImportKey, DomainImportInput>;

/** A whole registrar export, walked by the shared reader. Each accepted row's
 *  name is remembered, so a repeat later in the file is caught. */
export function validateDomainSheet(
  cells: readonly (readonly unknown[])[],
  ctx: Omit<DomainValidationContext, 'seen'>,
): DomainSheetResult {
  const seen = new Set<string>();
  return walkSheet(cells, DOMAIN_IMPORT_COLUMNS, (raw) => {
    const result = validateDomainRow(raw, { ...ctx, seen });
    if (result.value) seen.add(result.value.domainName);
    return result;
  });
}
