/** Team Reports: daily, weekly and monthly work reports, with reference files
 *  and replies. One rule for the browser, the mock API and the server.
 *
 *  Decisions (owner, 2026-09-13):
 *   - one report per person per period; staff and managers see only their own,
 *     the System Administrator sees everyone's;
 *   - replies from the System Administrator and the report's author only;
 *   - no deadline: for each period a person has either submitted or not;
 *   - images under 1 MB, other documents up to 5 MB, 5 files per report;
 *   - the System Administrator may delete a report permanently — the report, its
 *     files and replies are erased; the audit history keeps one line saying who
 *     deleted which report, when and why, and nothing of its content. */

import { ADMIN_ROLE } from './access';
import { hasPermission, type PermissionHolder } from './permissions';
import { sanitizeText } from './sanitize';
import type { RoleName } from './types';

export const REPORT_PERIODS = ['daily', 'weekly', 'monthly'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_STATUSES = ['Submitted', 'Reviewed', 'Needs changes'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const PERIOD_LABEL: Record<ReportPeriod, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };

export const REPORT_TEXT_MAX = 5000;
export const REPLY_MAX = 2000;
export const REPORT_FILE_LIMITS = { image: 1024 * 1024, document: 5 * 1024 * 1024, perReport: 5 } as const;

export interface ReportFileMeta {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'document';
  uploadedAt: string;
}

export interface ReportReply {
  id: string;
  authorId: string | null;
  authorName: string;
  authorRole: RoleName | '';
  body: string;
  createdAt: string;
}

export interface TeamReport {
  id: string;
  authorId: string;
  authorName: string;
  period: ReportPeriod;
  /** The first day of the period: the date, the Monday, or the 1st. */
  periodStart: string;
  workDone: string;
  results: string;
  blockers: string;
  recommendation: string;
  status: ReportStatus;
  reviewedByName: string;
  reviewedAt: string | null;
  files: ReportFileMeta[];
  replies: ReportReply[];
  createdAt: string;
  updatedAt: string;
}

interface Person extends PermissionHolder { id: string; role: RoleName }

/* ── Periods ─────────────────────────────────────────────────────── */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** The first day of the period containing `date` (YYYY-MM-DD), or null if the date is not real. */
export function periodStartOf(period: ReportPeriod, date: string): string | null {
  if (!ISO.test(date)) return null;
  const d = parse(date);
  if (Number.isNaN(d.getTime()) || toIso(d) !== date) return null;
  if (period === 'weekly') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  if (period === 'monthly') d.setUTCDate(1);
  return toIso(d);
}

/** The last day of the period that starts on `start`. */
export function periodEndOf(period: ReportPeriod, start: string): string {
  const d = parse(start);
  if (period === 'weekly') d.setUTCDate(d.getUTCDate() + 6);
  if (period === 'monthly') { d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); }
  return toIso(d);
}

const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => parse(iso).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });

/** "Sep 13, 2026", "Sep 7 – 13, 2026", "September 2026". */
export function periodLabel(period: ReportPeriod, start: string): string {
  if (period === 'daily') return fmt(start, { month: 'short', day: 'numeric', year: 'numeric' });
  if (period === 'monthly') return fmt(start, { month: 'long', year: 'numeric' });
  const end = periodEndOf(period, start);
  const endDay = String(Number(end.slice(8, 10)));
  const endText = start.slice(5, 7) === end.slice(5, 7) ? `${endDay}, ${end.slice(0, 4)}` : fmt(end, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${fmt(start, { month: 'short', day: 'numeric' })} – ${endText}`;
}

/** A report cannot be filed for a period that has not started yet. */
export function checkPeriod(period: unknown, date: unknown, today: string): { period: ReportPeriod; start: string } | { error: string } {
  if (!REPORT_PERIODS.includes(period as ReportPeriod)) return { error: 'Choose daily, weekly or monthly.' };
  const start = periodStartOf(period as ReportPeriod, String(date ?? ''));
  if (!start) return { error: 'Choose a valid date.' };
  if (start > today) return { error: 'You cannot report on a period that has not started yet.' };
  return { period: period as ReportPeriod, start };
}

/* ── Who may do what ─────────────────────────────────────────────── */

const isAdmin = (p: Person | null | undefined) => p?.role === ADMIN_ROLE;

/** Anyone who can edit records files their own reports; a read-only reviewer does not. */
export const mayFileReports = (p: Person | null | undefined) =>
  Boolean(p && hasPermission(p, 'edit:resources'));

export const mayViewReport = (p: Person | null | undefined, r: Pick<TeamReport, 'authorId'>) =>
  Boolean(p && (isAdmin(p) || r.authorId === p.id));

/** The author changes the content and files until the report is reviewed. */
export const mayEditReport = (p: Person | null | undefined, r: Pick<TeamReport, 'authorId' | 'status'>) =>
  Boolean(p && r.authorId === p.id && r.status !== 'Reviewed' && mayFileReports(p));

export const mayReply = mayViewReport;
export const mayReview = (p: Person | null | undefined) => isAdmin(p);
export const mayDeleteReport = (p: Person | null | undefined) => isAdmin(p);

/* ── Content ─────────────────────────────────────────────────────── */

export type ReportContent = Pick<TeamReport, 'workDone' | 'results' | 'blockers' | 'recommendation'>;

/** Sanitised report text. What was done is required; the rest may be blank. */
export function checkReportContent(input: Partial<Record<keyof ReportContent, unknown>>, partial = false):
  { value: Partial<ReportContent> } | { field: keyof ReportContent; error: string } {
  const value: Partial<ReportContent> = {};
  for (const field of ['workDone', 'results', 'blockers', 'recommendation'] as const) {
    if (input[field] === undefined) continue;
    const raw = String(input[field] ?? '');
    if (raw.length > REPORT_TEXT_MAX) return { field, error: `Keep it under ${REPORT_TEXT_MAX.toLocaleString()} characters.` };
    value[field] = sanitizeText(raw, REPORT_TEXT_MAX);
  }
  if (!partial && !value.workDone) return { field: 'workDone', error: 'Write what you did in this period.' };
  if (partial && value.workDone !== undefined && !value.workDone) return { field: 'workDone', error: 'Write what you did in this period.' };
  return { value };
}

/* ── Files ───────────────────────────────────────────────────────── */

const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv',
  txt: 'text/plain',
};
export const REPORT_FILE_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx,.csv,.txt';

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** A file name safe to store and to send back in a download header. */
export function safeFileName(name: unknown): string {
  const cleaned = sanitizeText(name, 180).replace(/[\\/:*?"<>| -]/g, '_').replace(/^\.+/, '').trim();
  return cleaned || 'file';
}

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`);

/** What a file really is, by its bytes, and whether its size is allowed.
 *  Images: PNG, JPEG, WebP under 1 MB. Documents: PDF, Word, Excel, PowerPoint
 *  (the macro-free formats), CSV and plain text, up to 5 MB. */
export function classifyReportFile(name: string, bytes: Uint8Array):
  { mimeType: string; kind: 'image' | 'document'; fileName: string } | { error: string } {
  const fileName = safeFileName(name);
  if (!bytes.length) return { error: `${fileName} is empty.` };
  const ext = fileName.toLowerCase().split('.').pop() ?? '';

  let image: string | null = null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) image = 'image/png';
  else if (startsWith(bytes, [0xff, 0xd8, 0xff])) image = 'image/jpeg';
  else if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])) image = 'image/webp';
  if (image) {
    return bytes.length >= REPORT_FILE_LIMITS.image
      ? { error: `${fileName} is ${formatBytes(bytes.length)}. Images must be under 1 MB — crop it or save it as JPEG.` }
      : { mimeType: image, kind: 'image', fileName };
  }

  const mimeType = DOCUMENT_TYPES[ext];
  if (!mimeType) return { error: `${fileName}: only images (PNG, JPEG, WebP), PDF, Word, Excel, PowerPoint, CSV or text files can be attached.` };
  const ok =
    ext === 'pdf' ? startsWith(bytes, [0x25, 0x50, 0x44, 0x46]) // %PDF
      : ext === 'csv' || ext === 'txt' ? !bytes.slice(0, 8192).includes(0)
        : startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]); // Office files are zip packages
  if (!ok) return { error: `${fileName} is not really a .${ext} file.` };
  if (bytes.length > REPORT_FILE_LIMITS.document) {
    return { error: `${fileName} is ${formatBytes(bytes.length)}. Documents can be up to 5 MB — share a larger file as a link in the report instead.` };
  }
  return { mimeType, kind: 'document', fileName };
}

/** "Gordon's daily report for Sep 13, 2026" — the only thing kept after a permanent delete. */
export const reportLabel = (r: Pick<TeamReport, 'authorName' | 'period' | 'periodStart'>) =>
  `${r.authorName}'s ${r.period} report for ${periodLabel(r.period, r.periodStart)}`;
