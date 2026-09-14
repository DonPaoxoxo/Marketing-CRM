/** Reading SIM rows from the team's tracking sheet — one rule for browser and server.
 *
 *  The sheet: No. · SIM Number · Created For · Email · Telegram Username · Status ·
 *  Date Checked · Others · Remarks.
 *
 *  The upload preview, the CSV import page and the server's import endpoint all
 *  validate through `validateSimRow`, so a row the preview marks "ready" is a row
 *  the server accepts, and one it refuses is refused for the same stated reason.
 *
 *  Pure: no DOM, no database. */

import type { AllocationStatus, Country, SimCreatedFor, SimForm, SimOperationalStatus } from './types';
import { SIM_CREATED_FOR, SIM_CREATED_FOR_MAX, SIM_OPERATIONAL_STATUS } from './types';
import { emailKey, phoneKey, telegramKey } from './identity';
import { sanitizeText } from './sanitize';
import {
  SHEET_LIMITS, cellText, mapHeaders, readSheetDate, squash, walkSheet,
  type HeaderMapping, type SheetColumn, type SheetResult as GenericSheetResult,
} from './sheet';

// Re-exported for callers that already import them from here.
export { cellText, readSheetDate };

/* ── Columns ─────────────────────────────────────────────────────── */

export type SimImportKey =
  | 'no' | 'phoneNumber' | 'createdFor' | 'email' | 'telegramUsername'
  | 'status' | 'dateChecked' | 'others' | 'remarks';

export type SimImportColumn = SheetColumn<SimImportKey>;

export const SIM_IMPORT_COLUMNS: readonly SimImportColumn[] = [
  { key: 'no', header: 'No.', required: false, aliases: ['number', 'row', '#'], help: 'Your own row counter. Not saved.' },
  {
    key: 'phoneNumber', header: 'SIM Number', required: true,
    aliases: ['full phone number', 'phone number', 'phone', 'mobile', 'mobile number', 'sim', 'msisdn'],
    help: 'e.g. 639175550420. With or without the "+"; a local number like 09175550420 uses the upload\'s default country.',
  },
  {
    key: 'createdFor', header: 'Created For', required: false, aliases: ['created'],
    help: `What the SIM is used for: ${SIM_CREATED_FOR.join(', ')}, or any other purpose such as Serper, Twilio or Discord. Blank if nothing yet.`,
  },
  { key: 'email', header: 'Email', required: false, aliases: ['email address', 'gmail'], help: 'The email account registered with this SIM.' },
  {
    key: 'telegramUsername', header: 'Telegram Username', required: false, aliases: ['telegram', 'tg', 'tg username'],
    help: 'e.g. @demouser. The "@" is optional.',
  },
  {
    key: 'status', header: 'Status', required: false, aliases: ['operational status', 'sim status'],
    help: 'Active, or Dead / Patay (saved as Inactive). Blank means Active.',
  },
  {
    key: 'dateChecked', header: 'Date Checked', required: false, aliases: ['last checked', 'checked', 'last verified', 'date verified'],
    help: 'When the SIM was last checked, e.g. 09/13/2026 or 2026-09-13. Not a future date.',
  },
  { key: 'others', header: 'Others', required: false, aliases: ['other'], help: 'Anything else it was created for. Saved in the notes.' },
  {
    key: 'remarks', header: 'Remarks', required: false, aliases: ['notes', 'note', 'comment', 'comments'],
    help: 'Saved in the notes. Never PINs, PUKs or passwords.',
  },
];

export const SIM_IMPORT_LIMITS = SHEET_LIMITS;

/** Match a header row to the SIM sheet's columns (see sheet.ts). */
export const mapSimHeaders = (headerRow: readonly unknown[]): HeaderMapping<SimImportKey> =>
  mapHeaders(SIM_IMPORT_COLUMNS, headerRow);

/* ── Phone numbers ───────────────────────────────────────────────── */

/** How a mobile number looks *without* its country code, for the countries this
 *  team works in. It is what lets "639175550420" be recognised as Philippine and
 *  a number Excel stripped of its leading "0" be read back, instead of guessed at. */
const NATIONAL_MOBILE: Record<string, { lengths: [number, number]; prefix: RegExp }> = {
  IN: { lengths: [10, 10], prefix: /^[6-9]/ },
  ID: { lengths: [9, 12], prefix: /^8/ },
  PK: { lengths: [10, 10], prefix: /^3/ },
  PH: { lengths: [10, 10], prefix: /^9/ },
};

const isNational = (digits: string, country: Country) => {
  const rule = NATIONAL_MOBILE[country.code];
  return Boolean(rule && digits.length >= rule.lengths[0] && digits.length <= rule.lengths[1] && rule.prefix.test(digits));
};
const dialOf = (country: Country) => country.dialCode.replace(/\D/g, '');

/** A SIM number in E.164 with the country it belongs to, or why it cannot be read.
 *
 *  For a Philippine SIM all of these read as +639175550420:
 *    +639175550420 · 00639175550420 · 639175550420 (the sheet's form)
 *    09175550420 (local) · 9175550420 (Excel dropped the 0)
 *  The last two need to know the country: that is `fallback`.
 *
 *  A number that fits no configured country is refused rather than guessed —
 *  a wrong country code records someone else's number. */
export function readSimNumber(
  raw: string,
  countries: readonly Country[],
  fallback: Country | null,
): { e164: string; country: Country } | { error: string } {
  const text = raw.trim();
  if (!text) return { error: 'Required.' };
  if (/[a-z]/i.test(text)) return { error: 'Contains letters — a SIM number is digits only.' };

  let digits = text.replace(/\D/g, '');
  const international = text.startsWith('+') || text.startsWith('00');
  if (text.startsWith('00')) digits = digits.replace(/^00/, '');

  // Carries a country code: explicit "+", or a known dial code followed by a
  // well-formed mobile number for that country.
  const byDial = countries.filter((c) => digits.startsWith(dialOf(c)) && isNational(digits.slice(dialOf(c).length), c));
  if (byDial.length === 1) return finish(`+${digits}`, byDial[0]);
  if (international) {
    const owner = countries.find((c) => digits.startsWith(dialOf(c)));
    if (!owner) return { error: 'That country code is not one of this workspace\'s countries.' };
    return finish(`+${digits}`, owner);
  }

  // A local number: needs the fallback country.
  if (!fallback) return { error: 'Write it with the country code, e.g. 639175550420.' };
  if (digits.startsWith('0') && isNational(digits.slice(1), fallback)) return finish(`+${dialOf(fallback)}${digits.slice(1)}`, fallback);
  if (isNational(digits, fallback)) return finish(`+${dialOf(fallback)}${digits}`, fallback);
  return { error: `Does not look like a ${fallback.name} mobile number. Write it with the country code, e.g. ${dialOf(fallback)}…` };
}

function finish(e164: string, country: Country): { e164: string; country: Country } | { error: string } {
  const length = e164.length - 1;
  if (length < 8 || length > 15) return { error: 'Not a usable number — a full number has 8 to 15 digits.' };
  return { e164, country };
}

/* ── Other values ────────────────────────────────────────────────── */

const CREATED_FOR: Record<string, SimCreatedFor> = {
  emailtelegram: 'Email + Telegram', telegramemail: 'Email + Telegram', emailandtelegram: 'Email + Telegram',
  email: 'Email', gmail: 'Email',
  telegram: 'Telegram', tg: 'Telegram',
};

/** Created For: the presets however they are spelled, or a custom purpose as
 *  written (Serper, Twilio, Discord). Blank means nothing yet. */
export function readCreatedFor(raw: unknown): { value: SimCreatedFor } | { error: string } {
  const typed = String(raw ?? '').trim();
  if (!typed) return { value: '' };
  const preset = CREATED_FOR[squash(typed)];
  if (preset) return { value: preset };
  if (typed.length > SIM_CREATED_FOR_MAX) return { error: `Keep it to ${SIM_CREATED_FOR_MAX} characters, e.g. Serper, Twilio or Discord.` };
  const text = sanitizeText(typed, SIM_CREATED_FOR_MAX);
  // Case-insensitively the same custom purpose is written the same way: "twilio" and "Twilio" group together.
  return text ? { value: text.charAt(0).toUpperCase() + text.slice(1) } : { value: '' };
}

/** The sheet's own status words, and the CRM's, onto the CRM's statuses.
 *  "Dead / Patay" — patay is Filipino for dead — means the SIM no longer works. */
const STATUS: Record<string, SimOperationalStatus> = {
  ...Object.fromEntries(SIM_OPERATIONAL_STATUS.map((s) => [squash(s), s])),
  dead: 'Inactive', patay: 'Inactive', deadpatay: 'Inactive', pataydead: 'Inactive', alive: 'Active', buhay: 'Active',
};

/** Telegram's own rule: 5–32 characters, letters, digits and underscores,
 *  starting with a letter and not ending in an underscore. */
const TELEGRAM_USERNAME = /^[a-z][a-z0-9_]{3,30}[a-z0-9]$/i;

/* ── The same fields on a single save ───────────────────────────── */

/** Created For, Email and Telegram username as the Add SIM form and the SIM
 *  routes accept them — the same rules as a sheet row, so a value refused in an
 *  upload is refused in the form too. Absent fields are left absent (a partial
 *  update); blank means cleared. */
export function checkSimExtras(input: { createdFor?: unknown; email?: unknown; telegramUsername?: unknown }):
  { value: Partial<Pick<SimImportInput, 'createdFor' | 'email' | 'telegramUsername'>> } | { field: string; message: string } {
  const value: Partial<Pick<SimImportInput, 'createdFor' | 'email' | 'telegramUsername'>> = {};

  if (input.createdFor !== undefined) {
    const createdFor = readCreatedFor(input.createdFor);
    if ('error' in createdFor) return { field: 'createdFor', message: createdFor.error };
    value.createdFor = createdFor.value;
  }
  if (input.email !== undefined) {
    const text = String(input.email ?? '').trim();
    const email = emailKey(text);
    if (text && !email) return { field: 'email', message: 'Not a valid email address.' };
    value.email = email;
  }
  if (input.telegramUsername !== undefined) {
    const text = String(input.telegramUsername ?? '').trim();
    const telegram = telegramKey(text);
    if (text && !TELEGRAM_USERNAME.test(telegram)) {
      return { field: 'telegramUsername', message: 'A Telegram username is 5–32 letters, digits or underscores, starting with a letter.' };
    }
    value.telegramUsername = telegram;
  }
  return { value };
}

/* ── Rows ────────────────────────────────────────────────────────── */

/** What a valid row becomes: the fields of a new SIM record. */
export interface SimImportInput {
  phoneNumber: string;
  countryCode: string;
  provider: string;
  form: SimForm;
  createdFor: SimCreatedFor;
  email: string;
  telegramUsername: string;
  operationalStatus: SimOperationalStatus;
  allocationStatus: AllocationStatus;
  lastVerifiedDate: string | null;
  notes: string;
}

export interface SimRowProblem { column: string; message: string }
export interface SimRowResult { value: SimImportInput | null; problems: SimRowProblem[] }

/** Identities already taken, as keys (see identity.ts). */
export interface TakenSims {
  phones: ReadonlySet<string>;
  emails: ReadonlySet<string>;
  telegrams: ReadonlySet<string>;
}

export interface SimValidationContext {
  countries: readonly Country[];
  /** For numbers written without a country code. */
  fallbackCountryCode?: string | null;
  /** Live SIMs already in the register. */
  existing: TakenSims;
  /** Earlier rows of the same file. The caller adds each accepted row. */
  seen: TakenSims;
}

export const noneTaken = (): TakenSims => ({ phones: new Set(), emails: new Set(), telegrams: new Set() });

/** The keys a SIM occupies, for adding to a `TakenSims`. */
export function simKeys(sim: Pick<SimImportInput, 'phoneNumber' | 'email' | 'telegramUsername'>) {
  return { phone: phoneKey(sim.phoneNumber), email: emailKey(sim.email), telegram: telegramKey(sim.telegramUsername) };
}

export function addTaken(taken: TakenSims, sim: Pick<SimImportInput, 'phoneNumber' | 'email' | 'telegramUsername'>): void {
  const k = simKeys(sim);
  if (k.phone) (taken.phones as Set<string>).add(k.phone);
  if (k.email) (taken.emails as Set<string>).add(k.email);
  if (k.telegram) (taken.telegrams as Set<string>).add(k.telegram);
}

/** Identities held by live SIMs, for `SimValidationContext.existing`. */
export function takenBySims(sims: readonly { phoneNumber: string; email?: string; telegramUsername?: string; archived: boolean }[]): TakenSims {
  const taken = noneTaken();
  for (const s of sims) if (!s.archived) addTaken(taken, { phoneNumber: s.phoneNumber, email: s.email ?? '', telegramUsername: s.telegramUsername ?? '' });
  return taken;
}

/** A submitted import row as the rule's raw columns. Accepts the sheet's own
 *  keys (from the CSV import page) and a validated row's keys (from the upload
 *  window), so the server re-checks either without caring which sent it. */
export function simRawFromRecord(row: Record<string, unknown>): Partial<Record<SimImportKey, string>> {
  return {
    phoneNumber: cellText(row.phoneNumber),
    createdFor: cellText(row.createdFor),
    email: cellText(row.email),
    telegramUsername: cellText(row.telegramUsername),
    status: cellText(row.status ?? row.operationalStatus),
    dateChecked: cellText(row.dateChecked ?? row.lastVerifiedDate),
    others: cellText(row.others),
    remarks: cellText(row.remarks ?? row.notes),
  };
}

const headerOf = (key: SimImportKey) => SIM_IMPORT_COLUMNS.find((c) => c.key === key)!.header;

/** Validate one row. `raw` is keyed by column key, values as text. Every
 *  problem in the row is reported at once, so it is fixed in one pass. */
export function validateSimRow(raw: Partial<Record<SimImportKey, string>>, ctx: SimValidationContext): SimRowResult {
  const problems: SimRowProblem[] = [];
  const say = (key: SimImportKey, message: string) => problems.push({ column: headerOf(key), message });
  const clash = (key: string, existing: ReadonlySet<string>, seen: ReadonlySet<string>, what: string) =>
    existing.has(key) ? `This ${what} is already on a SIM in the register.` : seen.has(key) ? `This ${what} appears earlier in this file.` : null;

  const fallback = ctx.countries.find((c) => c.code === ctx.fallbackCountryCode) ?? null;
  const number = readSimNumber(raw.phoneNumber ?? '', ctx.countries, fallback);
  if ('error' in number) say('phoneNumber', number.error);
  else {
    const taken = clash(phoneKey(number.e164), ctx.existing.phones, ctx.seen.phones, 'SIM number');
    if (taken) say('phoneNumber', `${number.e164}: ${taken}${ctx.existing.phones.has(phoneKey(number.e164)) ? ' Existing records are never overwritten.' : ''}`);
  }

  const createdForRead = readCreatedFor(raw.createdFor);
  const createdFor: SimCreatedFor | undefined = 'error' in createdForRead ? undefined : createdForRead.value;
  if ('error' in createdForRead) say('createdFor', createdForRead.error);

  const emailText = (raw.email ?? '').trim();
  const email = emailKey(emailText);
  if (emailText && !email) say('email', 'Not a valid email address.');
  else if (email) {
    const taken = clash(email, ctx.existing.emails, ctx.seen.emails, 'email');
    if (taken) say('email', taken);
  }

  const tgText = (raw.telegramUsername ?? '').trim();
  const telegram = telegramKey(tgText);
  if (tgText && !TELEGRAM_USERNAME.test(telegram)) {
    say('telegramUsername', 'A Telegram username is 5–32 letters, digits or underscores, starting with a letter.');
  } else if (telegram) {
    const taken = clash(telegram, ctx.existing.telegrams, ctx.seen.telegrams, 'Telegram username');
    if (taken) say('telegramUsername', taken);
  }

  const statusText = squash(raw.status ?? '');
  const operationalStatus = statusText ? STATUS[statusText] : 'Active';
  if (!operationalStatus) say('status', 'Use Active or Dead / Patay.');

  const checked = readSheetDate(raw.dateChecked ?? '');
  if ('error' in checked) say('dateChecked', checked.error);

  const remarks = sanitizeText(raw.remarks ?? '', 4000);
  const others = sanitizeText(raw.others ?? '', 400);
  const notes = [remarks, others && `Others: ${others}`].filter(Boolean).join('\n').slice(0, 4000);

  if (problems.length || 'error' in number || 'error' in checked) return { value: null, problems };
  return {
    value: {
      phoneNumber: number.e164,
      countryCode: number.country.code,
      provider: '',
      form: 'Physical SIM',
      createdFor: createdFor!,
      email,
      telegramUsername: telegram,
      operationalStatus: operationalStatus!,
      allocationStatus: 'Available',
      lastVerifiedDate: checked.date,
      notes,
    },
    problems,
  };
}

/** A whole SIM sheet, walked by the shared reader (sheet.ts). Each accepted
 *  row's number, email and Telegram username are remembered, so a later row
 *  repeating any of them is caught as a duplicate within the file. */
export type SheetResult = GenericSheetResult<SimImportKey, SimImportInput>;

export function validateSimSheet(
  cells: readonly (readonly unknown[])[],
  ctx: Omit<SimValidationContext, 'seen'>,
): SheetResult {
  const seen = noneTaken();
  return walkSheet(cells, SIM_IMPORT_COLUMNS, (raw) => {
    const result = validateSimRow(raw, { ...ctx, seen });
    if (result.value) addTaken(seen, result.value);
    return result;
  }, ['no']);
}
