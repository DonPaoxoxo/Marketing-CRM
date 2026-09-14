/** Reading the team's spreadsheets — the parts every bulk upload shares.
 *
 *  Cells, header matching and dates behave the same whether the sheet is SIMs
 *  or domains, so they are defined once. Each register's own rules (what a valid
 *  row is) live beside it: sim-import.ts, domain-import.ts.
 *
 *  Pure: no DOM, no database. */

/** One column a sheet may have. */
export interface SheetColumn<K extends string> {
  key: K;
  /** The header the team's sheet and the template use; error messages name it. */
  header: string;
  required: boolean;
  /** Other headers people plausibly type for the same column. */
  aliases: string[];
  help: string;
}

/** Upper bounds that keep one upload from holding the register hostage. The
 *  server enforces its own row limit too; this is the browser's early answer. */
export const SHEET_LIMITS = { maxRows: 5000, maxFileBytes: 5 * 1024 * 1024 } as const;

/** Lower-case, letters and digits only — how headers and enum values compare. */
export const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9#]/g, '');

export interface HeaderMapping<K extends string> {
  columns: Partial<Record<K, number>>;
  missing: SheetColumn<K>[];
}

/** Match a header row to a sheet's columns, tolerating case, spacing and
 *  punctuation — "Expire Date", "expire_date" and "Expire date :" all match.
 *  A header cell is claimed by at most one column. */
export function mapHeaders<K extends string>(columnsSpec: readonly SheetColumn<K>[], headerRow: readonly unknown[]): HeaderMapping<K> {
  const cells = headerRow.map((c) => squash(String(c ?? '')));
  const columns: Partial<Record<K, number>> = {};
  for (const col of columnsSpec) {
    const names = [col.header, col.key, ...col.aliases].map(squash);
    const taken = Object.values(columns) as number[];
    const index = cells.findIndex((c, i) => c !== '' && names.includes(c) && !taken.includes(i));
    if (index !== -1) columns[col.key] = index;
  }
  return { columns, missing: columnsSpec.filter((c) => c.required && columns[c.key] === undefined) };
}

/** A spreadsheet cell as text. Excel hands numbers back as numbers, so a long
 *  number in a plain cell arrives as 639175550420 — kept whole, never in
 *  exponent form. Date cells arrive as dates, and keep their date part. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? BigInt(value).toString() : String(value);
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  return String(value).trim();
}

export interface SheetDateOptions {
  /** A registration or verification date cannot be in the future; an expiry can. */
  allowFuture?: boolean;
}

/** A date as a spreadsheet holds it: a date cell (arrives as YYYY-MM-DD) or
 *  typed as 2026-09-13 or 09/13/2026 — month first, as Excel shows it for this
 *  team. A time after it ("9/8/2026 14:40", as registrar exports write it) is
 *  accepted and dropped; the register keeps dates. Anything else is refused
 *  rather than read the wrong way round. */
export function readSheetDate(
  raw: string,
  today = new Date(),
  options: SheetDateOptions = {},
): { date: string | null } | { error: string } {
  const text = raw.trim().replace(/[T\s]+\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(\s*[ap]\.?m\.?)?\s*(z|[+-]\d{2}:?\d{2})?$/i, '');
  if (!text) return { date: null };
  let y: number; let m: number; let d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (iso) [, y, m, d] = iso.map(Number) as [number, number, number, number];
  else if (us) [, m, d, y] = us.map(Number) as [number, number, number, number];
  else return { error: 'Use a date like 09/13/2026 or 2026-09-13.' };

  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
    return { error: 'Not a real date.' };
  }
  const iso8601 = parsed.toISOString().slice(0, 10);
  if (!options.allowFuture && iso8601 > today.toISOString().slice(0, 10)) return { error: 'Cannot be in the future.' };
  return { date: iso8601 };
}

/** A row the upload window can show: its spreadsheet row number, the text it
 *  read, and either a validated value or the problems with it. */
export interface SheetRow<K extends string, V> {
  rowNumber: number;
  raw: Partial<Record<K, string>>;
  result: { value: V | null; problems: { column: string; message: string }[] };
}

export interface SheetResult<K extends string, V> {
  missingColumns: SheetColumn<K>[];
  rows: SheetRow<K, V>[];
  tooManyRows: boolean;
}

/** Walk a sheet: find the header row, read every data row into its columns, and
 *  validate each in order. Blank rows are skipped silently — spreadsheets are
 *  full of them — and so are rows holding nothing but ignorable counters such
 *  as "No.". `rowNumber` is the row as Excel numbers it, so people can find it. */
export function walkSheet<K extends string, V>(
  cells: readonly (readonly unknown[])[],
  columnsSpec: readonly SheetColumn<K>[],
  validate: (raw: Partial<Record<K, string>>) => SheetRow<K, V>['result'],
  ignoredForBlank: readonly K[] = [],
): SheetResult<K, V> {
  const headerIndex = cells.findIndex((row) => row.some((c) => cellText(c) !== ''));
  if (headerIndex === -1) return { missingColumns: columnsSpec.filter((c) => c.required), rows: [], tooManyRows: false };

  const { columns, missing } = mapHeaders(columnsSpec, cells[headerIndex]);
  if (missing.length) return { missingColumns: missing, rows: [], tooManyRows: false };

  const rows: SheetRow<K, V>[] = [];
  let dataRows = 0;
  for (let i = headerIndex + 1; i < cells.length; i++) {
    const raw: Partial<Record<K, string>> = {};
    for (const [key, index] of Object.entries(columns) as [K, number][]) {
      raw[key] = cellText(cells[i][index]);
    }
    if ((Object.entries(raw) as [K, string][]).every(([k, v]) => ignoredForBlank.includes(k) || !v)) continue;
    dataRows++;
    if (dataRows > SHEET_LIMITS.maxRows) return { missingColumns: [], rows, tooManyRows: true };
    rows.push({ rowNumber: i + 1, raw, result: validate(raw) });
  }
  return { missingColumns: [], rows, tooManyRows: false };
}
