/** CSV helpers, shared by the browser and the server.
 *
 *  Export deliberately refuses any column that could carry a secret. Triggering a
 *  browser download lives in `download.ts`, so the API can build a CSV without
 *  importing anything that touches the DOM. */

/** Column names that must never leave the system, in any import or export. */
/** Spellings vary across spreadsheets — "Pass Phrase", "api_key", "recovery-code" —
 *  so every multi-word pattern tolerates spaces, underscores, dots and hyphens. */
export const FORBIDDEN_COLUMN_PATTERNS = [
  /pass[\s_.-]*(word|phrase)/i,
  /\bpwd\b/i,
  /secret/i,
  /token/i,
  /\bapi[\s_.-]*keys?\b/i,
  /cookie/i,
  /session/i,
  /recovery[\s_.-]*codes?/i,
  /backup[\s_.-]*codes?/i,
  /\botp\b/i,
  /2fa[\s_.-]*(code|seed)/i,
  /seed[\s_.-]*phrase/i,
  /private[\s_.-]*key/i,
  /security[\s_.-]*answer/i,
];

export function isForbiddenColumn(name: string): boolean {
  return FORBIDDEN_COLUMN_PATTERNS.some((re) => re.test(name));
}

function escapeCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  // Guard against spreadsheet formula injection in exported files.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface ExportColumn<T> {
  key: string;
  header: string;
  value: (row: T) => unknown;
  /** Carries personal contact detail. Masked unless the export explicitly opts in. */
  sensitive?: boolean;
  /** What to write when the column is masked. Defaults to a fixed placeholder. */
  masked?: (row: T) => unknown;
}

export function toCSV<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  { includeContactDetails = false }: { includeContactDetails?: boolean } = {},
): string {
  const allowed = columns.filter((c) => !isForbiddenColumn(c.key) && !isForbiddenColumn(c.header));
  const read = (c: ExportColumn<T>, row: T) =>
    c.sensitive && !includeContactDetails ? (c.masked?.(row) ?? '[masked]') : c.value(row);
  const head = allowed.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((r) => allowed.map((c) => escapeCell(read(c, r))).join(',')).join('\n');
  return `${head}\n${body}`;
}

/** The same rows as a plain matrix, for Excel and PDF exports: secret-bearing
 *  columns dropped, contact details masked unless explicitly included, and values
 *  flattened to text. No formula guard is needed here, unlike CSV: the Excel
 *  writer stores every value as a text cell, which spreadsheets never evaluate,
 *  and a phone number such as +91… stays exactly as it is. */
export function exportMatrix<T>(
  rows: T[],
  columns: ExportColumn<T>[],
  { includeContactDetails = false }: { includeContactDetails?: boolean } = {},
): { headers: string[]; values: string[][] } {
  const allowed = columns.filter((c) => !isForbiddenColumn(c.key) && !isForbiddenColumn(c.header));
  const text = (v: unknown) => (v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : String(v));
  return {
    headers: allowed.map((c) => c.header),
    values: rows.map((r) => allowed.map((c) => text(c.sensitive && !includeContactDetails ? (c.masked?.(r) ?? '[masked]') : c.value(r)))),
  };
}

/** Minimal RFC-4180 parser — handles quoted cells, embedded commas and newlines. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}
