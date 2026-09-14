/** Shared Spiel Library: one set of rules for the browser, the server and the tests.
 *
 *  Ownership is strict. Only the person who created a record (spiel, document,
 *  comment, version) and the System Owner — the System Administrator — may edit
 *  or delete it. Managers and other administrators get nothing extra. The server
 *  re-checks every rule; hiding a button in the browser is a courtesy. */

import { z } from 'zod';
import { ADMIN_ROLE } from './access';
import { sanitizeText } from './sanitize';
import type { RoleName } from './types';

/* ── Vocabulary ────────────────────────────────────────────────── */

export const SPIEL_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Rejected', 'Changes Requested', 'Archived'] as const;
export type SpielStatus = (typeof SPIEL_STATUSES)[number];
/** Version rows also record a replaced approved version. */
export type SpielVersionStatus = Exclude<SpielStatus, 'Archived'> | 'Superseded';

export const DOCUMENT_STATUSES = ['Draft', 'Pending Review', 'Approved', 'Rejected', 'Archived'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const TARGET_COUNTRIES = ['India', 'Indonesia', 'Both', 'Global'] as const;
export type TargetCountry = (typeof TARGET_COUNTRIES)[number];
export const SPIEL_PLATFORMS = ['Telegram', 'WhatsApp', 'SMS', 'Facebook', 'Email', 'Other'] as const;
export type SpielPlatform = (typeof SPIEL_PLATFORMS)[number];
export const SUGGESTED_LANGUAGES = ['English', 'Hindi', 'Hinglish', 'Indonesian', 'Tamil', 'Telugu', 'Bengali', 'Marathi', 'Filipino'] as const;

export const DEFAULT_CATEGORIES = [
  'Greeting Spiel', 'Introduction Spiel', 'Strategic Spiel', 'Convincing Spiel', 'Follow-up Spiel',
  'Collaboration Spiel', 'Closing Spiel', 'Rejection Spiel', 'Objection Handling', 'Re-engagement Spiel',
  'Payment or Cooperation Spiel', 'Custom Spiel',
] as const;

export const FEEDBACK_MIN = 10;
export const LIMITS = { title: 160, content: 5000, situation: 1000, campaignRef: 160, tags: 12, tag: 40, language: 40, feedback: 2000, comment: 2000, note: 2000, announcement: 1000, category: 80, description: 1000 } as const;

/* ── Records as the API returns them ───────────────────────────── */

export interface SpielCategory { id: string; name: string; sortOrder: number; active: boolean }

export interface SpielVersion {
  id: string;
  versionNo: number;
  title: string;
  categoryId: string;
  categoryName: string;
  content: string;
  situation: string;
  targetCountry: TargetCountry;
  language: string;
  platform: SpielPlatform;
  campaignRef: string;
  tags: string[];
  status: SpielVersionStatus;
  adminFeedback: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedByName: string;
  updatedAt: string;
  submittedAt: string | null;
  reviewedByName: string;
  reviewedAt: string | null;
}

export interface SpielApproval {
  id: string;
  versionNo: number | null;
  action: 'created' | 'submitted' | 'edited' | 'new-version' | 'approved' | 'rejected' | 'changes-requested' | 'archived' | 'restored' | 'edited-by-owner';
  feedback: string;
  changes: string;
  actorName: string;
  createdAt: string;
}

export interface SpielComment { id: string; body: string; createdById: string; createdByName: string; createdAt: string; updatedAt: string; canEdit: boolean }

export interface Spiel {
  id: string;
  status: SpielStatus;
  /** What the shared library shows; null until first approved. */
  approved: SpielVersion | null;
  /** The version being worked on (equal to `approved` when nothing is pending). */
  current: SpielVersion;
  approvedByName: string;
  approvedAt: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  note: string;
  favoriteCount: number;
  canEdit: boolean;
}

export interface SpielDetail extends Spiel {
  versions: SpielVersion[];
  approvals: SpielApproval[];
  comments: SpielComment[];
  documents: SpielDocument[];
}

export interface DocumentVersion {
  id: string;
  versionNo: number;
  fileName: string;
  mimeType: string;
  kind: FileKind;
  sizeBytes: number;
  status: DocumentStatus | 'Superseded';
  adminFeedback: string;
  createdByName: string;
  createdAt: string;
  reviewedByName: string;
  reviewedAt: string | null;
  hasText: boolean;
}

export interface SpielDocument {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string;
  spielId: string | null;
  targetCountry: TargetCountry;
  language: string;
  description: string;
  status: DocumentStatus;
  adminFeedback: string;
  current: DocumentVersion;
  approved: DocumentVersion | null;
  approvedAt: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  outdated: boolean;
  canEdit: boolean;
  versions?: DocumentVersion[];
}

export interface AppNotification { id: string; kind: string; title: string; body: string; link: string; readAt: string | null; createdAt: string }

/* ── Ownership and roles ───────────────────────────────────────── */

export interface SpielPerson { id: string; role: RoleName }

export const SYSTEM_OWNER_ROLE: RoleName = ADMIN_ROLE;
export const isSpielOwner = (p: SpielPerson | null | undefined) => p?.role === SYSTEM_OWNER_ROLE;

/** Creator or System Owner — nobody else, whatever their role. */
export const mayModify = (p: SpielPerson | null | undefined, record: { createdById: string }) =>
  Boolean(p && (isSpielOwner(p) || record.createdById === p.id));

/** Seeing a spiel at all: its creator, the System Owner, or anyone once a version is approved and live. */
export const mayViewSpiel = (p: SpielPerson | null | undefined, s: { createdById: string; status: SpielStatus; hasApproved: boolean }) =>
  Boolean(p && (mayModify(p, s) || (s.hasApproved && s.status !== 'Archived')));

/** Whether this person sees the working (unapproved) version, not just the approved one. */
export const maySeeWorkingVersion = (p: SpielPerson | null | undefined, s: { createdById: string }) => mayModify(p, s);

export const mayViewDocument = (p: SpielPerson | null | undefined, d: { createdById: string; status: DocumentStatus; hasApproved: boolean }) =>
  Boolean(p && (mayModify(p, d) || (d.hasApproved && d.status !== 'Archived')));

/** Whether a particular version file may be sent: approved versions to everyone who can see the document. */
export const mayDownloadVersion = (p: SpielPerson | null | undefined, d: { createdById: string; status: DocumentStatus; approvedVersionId: string | null }, versionId: string) =>
  Boolean(p && (mayModify(p, d) || (d.status !== 'Archived' && d.approvedVersionId === versionId)));

/* ── Workflow ──────────────────────────────────────────────────── */

export type SpielAction = 'submit' | 'approve' | 'reject' | 'request-changes' | 'archive' | 'restore';

/** Allowed transitions. The owner-only ones are checked separately with isSpielOwner. */
export const SPIEL_TRANSITIONS: Record<SpielAction, { from: SpielStatus[]; to: SpielStatus; ownerOnly: boolean; needsFeedback: boolean }> = {
  submit: { from: ['Draft', 'Rejected', 'Changes Requested'], to: 'Pending Approval', ownerOnly: false, needsFeedback: false },
  approve: { from: ['Pending Approval'], to: 'Approved', ownerOnly: true, needsFeedback: false },
  reject: { from: ['Pending Approval'], to: 'Rejected', ownerOnly: true, needsFeedback: true },
  'request-changes': { from: ['Pending Approval'], to: 'Changes Requested', ownerOnly: true, needsFeedback: true },
  archive: { from: ['Approved'], to: 'Archived', ownerOnly: true, needsFeedback: true },
  restore: { from: ['Archived'], to: 'Approved', ownerOnly: true, needsFeedback: true },
};

export function checkTransition(p: SpielPerson, record: { createdById: string; status: SpielStatus; hasApproved?: boolean }, action: SpielAction, feedback: string):
  { ok: true; to: SpielStatus } | { error: string; status: 400 | 403 | 409; field?: string } {
  const rule = SPIEL_TRANSITIONS[action];
  if (rule.ownerOnly && !isSpielOwner(p)) return { error: 'Only the System Administrator can do that.', status: 403 };
  if (!rule.ownerOnly && !mayModify(p, record)) return { error: 'Only the person who created this spiel or the System Owner can submit it.', status: 403 };
  // A spiel that was archived while approved is restorable only if it has an approved version.
  if (action === 'restore' && record.hasApproved === false) return { error: 'Only a spiel with an approved version can be restored.', status: 409 };
  if (!rule.from.includes(record.status)) return { error: `A spiel that is ${record.status} cannot be ${ACTION_PAST[action]}.`, status: 409 };
  if (rule.needsFeedback && feedback.trim().length < FEEDBACK_MIN) {
    return { error: `Write an explanation of at least ${FEEDBACK_MIN} characters.`, status: 400, field: 'feedback' };
  }
  return { ok: true, to: rule.to };
}

const ACTION_PAST: Record<SpielAction, string> = {
  submit: 'submitted', approve: 'approved', reject: 'rejected', 'request-changes': 'sent back for changes', archive: 'archived', restore: 'restored',
};

/** What an edit does: update the working draft in place, or open a new version for review. */
export function editPlan(s: { status: SpielStatus; current: { status: SpielVersionStatus }; approvedVersionId: string | null; currentVersionId: string }):
  'in-place' | 'new-version' | { error: string } {
  if (s.status === 'Archived') return { error: 'Restore this spiel before editing it.' };
  // Only the live approved version is ever copied into a new version.
  if (s.approvedVersionId && s.approvedVersionId === s.currentVersionId) return 'new-version';
  return 'in-place';
}

/** After an in-place edit: rejected or sent-back work becomes a Draft again; pending stays pending. */
export const statusAfterEdit = (status: SpielStatus): SpielStatus =>
  status === 'Rejected' || status === 'Changes Requested' ? 'Draft' : status;

/** Deleting: the System Owner permanently, unless it is live; the creator softly, only if never approved. */
export function checkDelete(p: SpielPerson, s: { createdById: string; status: SpielStatus; hasApproved: boolean }):
  { mode: 'permanent' | 'soft' } | { error: string; status: 403 | 409 } {
  if (isSpielOwner(p)) {
    if (s.status === 'Approved' || s.status === 'Pending Approval' && s.hasApproved) return { error: 'Archive the approved spiel before deleting it permanently.', status: 409 };
    return { mode: 'permanent' };
  }
  if (s.createdById !== p.id) return { error: 'Only the person who created this spiel or the System Owner can delete it.', status: 403 };
  if (s.hasApproved) return { error: 'An approved spiel cannot be deleted by its author. Ask the System Administrator to archive it.', status: 409 };
  return { mode: 'soft' };
}

/* ── Input validation ──────────────────────────────────────────── */

const clean = (max: number) => z.preprocess((v) => sanitizeText(v, max + 1), z.string());

export const spielInputSchema = z.object({
  title: clean(LIMITS.title).pipe(z.string().min(3, 'Give the spiel a title of at least 3 characters.').max(LIMITS.title, `Keep the title under ${LIMITS.title} characters.`)),
  categoryId: z.string().min(1, 'Choose a category.').max(24),
  content: z.preprocess((v) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').replace(/[ --]/g, '').trim() : ''), z.string()
    .min(10, 'Write the script (at least 10 characters).').max(LIMITS.content, `Keep the script under ${LIMITS.content.toLocaleString()} characters.`)),
  situation: clean(LIMITS.situation).pipe(z.string().max(LIMITS.situation)).default(''),
  targetCountry: z.enum(TARGET_COUNTRIES, { errorMap: () => ({ message: 'Choose India, Indonesia, Both or Global.' }) }),
  language: clean(LIMITS.language).pipe(z.string().min(2, 'Enter the language.').max(LIMITS.language)),
  platform: z.enum(SPIEL_PLATFORMS, { errorMap: () => ({ message: 'Choose a communication platform.' }) }),
  campaignRef: clean(LIMITS.campaignRef).pipe(z.string().max(LIMITS.campaignRef)).default(''),
  tags: z.preprocess(normaliseTags, z.array(z.string()).max(LIMITS.tags, `Use up to ${LIMITS.tags} tags.`)).default([]),
});
export type SpielInput = z.infer<typeof spielInputSchema>;

export function normaliseTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const tag = sanitizeText(item, LIMITS.tag).replace(/,/g, ' ').trim().toLowerCase();
    if (tag && !seen.has(tag)) { seen.add(tag); out.push(tag); }
  }
  return out;
}

/** A readable first problem from a Zod failure. */
export function firstIssue(error: z.ZodError): { error: string; field: string } {
  const issue = error.issues[0];
  return { error: issue?.message ?? 'Check the form.', field: String(issue?.path[0] ?? '') };
}

export function checkFeedback(raw: unknown, required: boolean): { value: string } | { error: string } {
  const value = sanitizeText(raw, LIMITS.feedback);
  if (required && value.length < FEEDBACK_MIN) return { error: `Write an explanation of at least ${FEEDBACK_MIN} characters.` };
  return { value };
}

/** Human summary of what changed between two versions, for the history. */
export function describeChanges(before: Partial<SpielInput> | null, after: SpielInput): string {
  if (!before) return '';
  const labels: [keyof SpielInput, string][] = [
    ['title', 'title'], ['categoryId', 'category'], ['content', 'script'], ['situation', 'situation'], ['targetCountry', 'country'],
    ['language', 'language'], ['platform', 'platform'], ['campaignRef', 'campaign reference'], ['tags', 'tags'],
  ];
  const changed = labels.filter(([k]) => JSON.stringify(before[k] ?? '') !== JSON.stringify(after[k] ?? '')).map(([, l]) => l);
  return changed.length ? `Changed ${changed.join(', ')}` : 'No content changes';
}

/* ── Duplicates and similarity ─────────────────────────────────── */

export function normaliseForCompare(text: string): string {
  return text.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** A stable key for exact-duplicate detection (whitespace, case and punctuation ignored). */
export function contentKey(text: string): string {
  // FNV-1a over the normalised text, twice with different seeds, as hex. Not cryptographic; just a lookup key.
  const s = normaliseForCompare(text);
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ s.charCodeAt(s.length - 1 - i), 0x01000193) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}${s.length.toString(16)}`;
}

const shingles = (text: string) => {
  const words = normaliseForCompare(text).split(' ').filter(Boolean);
  const set = new Set<string>();
  for (let i = 0; i < words.length; i++) set.add(words.slice(i, i + 2).join(' '));
  return set;
};

/** 0–1 overlap of word pairs. */
export function similarity(a: string, b: string): number {
  const x = shingles(a), y = shingles(b);
  if (!x.size || !y.size) return 0;
  let common = 0;
  for (const s of x) if (y.has(s)) common++;
  return common / (x.size + y.size - common);
}

export const SIMILAR_THRESHOLD = 0.6;

export function findSimilar<T extends { id: string; content: string; title: string }>(content: string, candidates: T[], exceptId?: string) {
  const key = contentKey(content);
  return candidates
    .filter((c) => c.id !== exceptId)
    .map((c) => ({ id: c.id, title: c.title, score: contentKey(c.content) === key ? 1 : similarity(content, c.content) }))
    .filter((c) => c.score >= SIMILAR_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

/* ── Messaging helpers ─────────────────────────────────────────── */

const GSM7 = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const GSM7_EXT = new Set('^{}\\[~]|€');

/** Characters and SMS segments: GSM-7 (160 / 153) or Unicode (70 / 67). */
export function smsInfo(text: string): { characters: number; encoding: 'GSM-7' | 'Unicode'; segments: number; perSegment: number } {
  let units = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM7.has(ch)) units += 1;
    else if (GSM7_EXT.has(ch)) units += 2;
    else { unicode = true; break; }
  }
  const characters = [...text].length;
  if (unicode) {
    const len = [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    return { characters, encoding: 'Unicode', segments: len <= 70 ? (len ? 1 : 0) : Math.ceil(len / 67), perSegment: len <= 70 ? 70 : 67 };
  }
  return { characters, encoding: 'GSM-7', segments: units <= 160 ? (units ? 1 : 0) : Math.ceil(units / 153), perSegment: units <= 160 ? 160 : 153 };
}

/** Soft length guidance per platform (not enforced). */
export const PLATFORM_LIMITS: Record<SpielPlatform, number | null> = { SMS: 160, WhatsApp: 4096, Telegram: 4096, Facebook: 2000, Email: null, Other: null };

/** Plain text: markdown-style emphasis removed, for SMS and plain channels. */
export function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1').replace(/(^|\s)[*_~](\S.*?\S|\S)[*_~](?=\s|$)/g, '$1$2');
}

/** Formatted for the platform: WhatsApp and Telegram use *bold*; others get plain text. */
export function formattedFor(platform: SpielPlatform, text: string): string {
  if (platform === 'WhatsApp') return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  if (platform === 'Telegram') return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
  if (platform === 'Email') return text;
  return plainText(text);
}

/** A few approved spiels picked for today — stable through the day, different tomorrow. */
export function recommendedForToday<T extends { id: string; usageCount: number }>(items: T[], today: string, count = 4): T[] {
  const score = (id: string) => {
    let h = 2166136261;
    for (const ch of `${today}:${id}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h;
  };
  return [...items].sort((a, b) => score(a.id) - score(b.id)).slice(0, count);
}

export const DOCUMENT_OUTDATED_DAYS = 180;
export const isOutdated = (approvedAt: string | null, now = Date.now()) =>
  Boolean(approvedAt && now - Date.parse(approvedAt) > DOCUMENT_OUTDATED_DAYS * 86400_000);

/* ── Documents: types, limits and content checks ───────────────── */

export type FileKind = 'excel' | 'word' | 'powerpoint' | 'pdf' | 'text' | 'image';

const MB = 1024 * 1024;
export const DOCUMENT_LIMITS: Record<FileKind, number> = { excel: 10 * MB, word: 10 * MB, text: 10 * MB, powerpoint: 20 * MB, pdf: 20 * MB, image: 1 * MB };
export const DOCUMENT_MAX_BYTES = 20 * MB;

type Signature = 'zip' | 'ole' | 'pdf' | 'text' | 'png' | 'jpeg' | 'webp';
export const DOCUMENT_TYPES: Record<string, { kind: FileKind; mime: string; signature: Signature }> = {
  xlsx: { kind: 'excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: 'zip' },
  xls: { kind: 'excel', mime: 'application/vnd.ms-excel', signature: 'ole' },
  csv: { kind: 'excel', mime: 'text/csv', signature: 'text' },
  docx: { kind: 'word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: 'zip' },
  doc: { kind: 'word', mime: 'application/msword', signature: 'ole' },
  pptx: { kind: 'powerpoint', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', signature: 'zip' },
  ppt: { kind: 'powerpoint', mime: 'application/vnd.ms-powerpoint', signature: 'ole' },
  pdf: { kind: 'pdf', mime: 'application/pdf', signature: 'pdf' },
  txt: { kind: 'text', mime: 'text/plain', signature: 'text' },
  md: { kind: 'text', mime: 'text/markdown', signature: 'text' },
  jpg: { kind: 'image', mime: 'image/jpeg', signature: 'jpeg' },
  jpeg: { kind: 'image', mime: 'image/jpeg', signature: 'jpeg' },
  png: { kind: 'image', mime: 'image/png', signature: 'png' },
  webp: { kind: 'image', mime: 'image/webp', signature: 'webp' },
};
export const DOCUMENT_ACCEPT = Object.keys(DOCUMENT_TYPES).map((e) => `.${e}`).join(',');

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const EXECUTABLE_SEGMENTS = /\.(exe|dll|bat|cmd|com|msi|scr|ps1|vbs|js|jse|wsf|sh|jar|apk|app|hta|lnk|reg|php|html?|svg|xlsm|docm|pptm)(\.|$)/i;

const formatMb = (n: number) => (n >= MB ? `${(n / MB).toFixed(n % MB ? 1 : 0)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`);
export { formatMb as formatFileSize };

/** A name safe to store and to put in a download header: no paths, controls or reserved characters. */
export function safeDocumentName(name: unknown): string {
  const base = String(name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = sanitizeText(base, 180).replace(/[ -"*:<>?|]/g, '_').replace(/^\.+/, '').replace(/\s+/g, ' ').trim();
  return cleaned || 'file';
}

function signatureMatches(sig: Signature, b: Uint8Array): boolean {
  switch (sig) {
    case 'zip': return startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
    case 'ole': return startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'pdf': return startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case 'png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'jpeg': return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'webp': return b.length >= 12 && startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
    case 'text': {
      const head = b.subarray(0, 64 * 1024);
      if (head.includes(0)) return false;
      try { new TextDecoder('utf-8', { fatal: true }).decode(head.length === b.length ? head : head.subarray(0, lastUtf8Boundary(head))); return true; } catch { return false; }
    }
  }
}

function lastUtf8Boundary(b: Uint8Array): number {
  let i = b.length;
  // Step back over a possibly cut multi-byte sequence at the end of the sample.
  for (let k = 1; k <= 3 && i - k >= 0; k++) if ((b[i - k] & 0xc0) === 0xc0) return i - k;
  return i;
}

/** Extension, declared type, real content and size — all must agree. */
export function classifyDocument(name: string, bytes: Uint8Array, declaredMime?: string):
  { fileName: string; kind: FileKind; mimeType: string; sizeBytes: number } | { error: string } {
  const fileName = safeDocumentName(name);
  if (!bytes.length) return { error: `${fileName} is empty.` };
  if (EXECUTABLE_SEGMENTS.test(fileName)) return { error: `${fileName}: executable, script, web page and macro-enabled files are not accepted.` };
  const ext = fileName.toLowerCase().includes('.') ? fileName.toLowerCase().split('.').pop()! : '';
  const type = DOCUMENT_TYPES[ext];
  if (!type) return { error: `${fileName}: only Excel (.xlsx, .xls, .csv), Word (.docx, .doc), PowerPoint (.pptx, .ppt), PDF, text (.txt, .md) and images (.jpg, .png, .webp) are accepted.` };
  if (declaredMime && declaredMime !== 'application/octet-stream' && !mimeAgrees(type.mime, declaredMime)) {
    return { error: `${fileName} says it is ${declaredMime}, which does not match a .${ext} file.` };
  }
  if (!signatureMatches(type.signature, bytes)) return { error: `${fileName} is not really a .${ext} file.` };
  const limit = DOCUMENT_LIMITS[type.kind];
  if (bytes.length > limit) {
    return { error: `${fileName} is ${formatMb(bytes.length)}. ${KIND_LABEL[type.kind]} files can be up to ${formatMb(limit)}.` };
  }
  return { fileName, kind: type.kind, mimeType: type.mime, sizeBytes: bytes.length };
}

const KIND_LABEL: Record<FileKind, string> = { excel: 'Excel and CSV', word: 'Word', text: 'Text', powerpoint: 'PowerPoint', pdf: 'PDF', image: 'Reference image' };

function mimeAgrees(expected: string, declared: string): boolean {
  const d = declared.toLowerCase().split(';')[0].trim();
  if (d === expected) return true;
  // Browsers and operating systems disagree on these; accept the common aliases only.
  const aliases: Record<string, string[]> = {
    'text/csv': ['application/vnd.ms-excel', 'text/plain', 'application/csv'],
    'text/markdown': ['text/plain', 'text/x-markdown', ''],
    'text/plain': [''],
    'image/jpeg': ['image/jpg', 'image/pjpeg'],
  };
  return (aliases[expected] ?? []).includes(d);
}

export const DOCUMENT_TRANSITIONS: Record<'submit' | 'approve' | 'reject' | 'archive' | 'restore', { from: DocumentStatus[]; to: DocumentStatus; ownerOnly: boolean; needsFeedback: boolean }> = {
  submit: { from: ['Draft', 'Rejected'], to: 'Pending Review', ownerOnly: false, needsFeedback: false },
  approve: { from: ['Pending Review'], to: 'Approved', ownerOnly: true, needsFeedback: false },
  reject: { from: ['Pending Review'], to: 'Rejected', ownerOnly: true, needsFeedback: true },
  archive: { from: ['Approved', 'Rejected', 'Draft'], to: 'Archived', ownerOnly: true, needsFeedback: true },
  restore: { from: ['Archived'], to: 'Approved', ownerOnly: true, needsFeedback: true },
};

export const documentMetaSchema = z.object({
  title: clean(LIMITS.title).pipe(z.string().min(3, 'Give the document a title of at least 3 characters.').max(LIMITS.title)),
  categoryId: z.string().max(24).nullable().default(null),
  spielId: z.string().max(24).nullable().default(null),
  targetCountry: z.enum(TARGET_COUNTRIES, { errorMap: () => ({ message: 'Choose India, Indonesia, Both or Global.' }) }),
  language: clean(LIMITS.language).pipe(z.string().min(2, 'Enter the language.').max(LIMITS.language)),
  description: clean(LIMITS.description).pipe(z.string().max(LIMITS.description)).default(''),
});
export type DocumentMeta = z.infer<typeof documentMetaSchema>;
