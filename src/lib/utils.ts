/** Domain helpers shared by the browser and the server.
 *
 *  Nothing in this module may touch the DOM or import UI libraries — the API
 *  imports it for phone, date and domain normalisation, and those rules must be
 *  identical on both sides. Class-name merging lives in `cn.ts`. */

/* ── Dates ────────────────────────────────────────────────────── */

export const TODAY = () => new Date();

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.length === 10 ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(s: string | null | undefined, fallback = '—'): string {
  const d = parseISO(s);
  if (!d) return fallback;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' });
}

export function formatDateTime(s: string | null | undefined, fallback = '—'): string {
  const d = parseISO(s);
  if (!d) return fallback;
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Whole days from today to `s`. Negative = in the past. */
export function daysUntil(s: string | null | undefined): number | null {
  const d = parseISO(s);
  if (!d) return null;
  const today = new Date();
  const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((b - a) / 86_400_000);
}

export function daysSince(s: string | null | undefined): number | null {
  const n = daysUntil(s);
  return n === null ? null : -n;
}

export function relativeDays(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return 'today';
  if (n > 0) return `in ${n} day${n === 1 ? '' : 's'}`;
  return `${-n} day${n === -1 ? '' : 's'} ago`;
}

export function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setUTCDate(c.getUTCDate() + n);
  return c;
}

/* ── Numbers & text ───────────────────────────────────────────── */

export function formatNumber(n: number | null | undefined, fallback = '—'): string {
  if (n === null || n === undefined) return fallback;
  return n.toLocaleString();
}

export function compactNumber(n: number | null | undefined, fallback = '—'): string {
  if (n === null || n === undefined) return fallback;
  return Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s-])\w/g, (m) => m.toUpperCase());
}

/** Case/diacritic-insensitive substring match used by every table search box. */
export function matches(haystack: unknown, needle: string): boolean {
  if (!needle) return true;
  return String(haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}

/* ── Phone numbers ────────────────────────────────────────────── */

/** Strip everything but digits and a single leading +. Used for dedupe + import. */
export function normalizePhone(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+') || trimmed.startsWith('00');
  const digits = trimmed.replace(/[^\d]/g, '').replace(/^00/, '');
  return digits ? `+${digits}` : hasPlus ? '+' : '';
}

export function formatPhone(e164: string): string {
  if (!e164) return '—';
  const d = e164.replace(/^\+/, '');
  if (d.length <= 6) return e164;
  return `+${d.slice(0, d.length - 10)} ${d.slice(-10, -5)} ${d.slice(-5)}`.replace(/\s+/g, ' ').trim();
}

/** Redacts a phone number for roles without contact-detail permission. */
export function maskPhone(e164: string): string {
  if (!e164) return '—';
  return `${e164.slice(0, Math.min(4, e164.length))}•••••${e164.slice(-2)}`;
}

export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '•••';
  const [local, domain] = email.split('@');
  return `${local.slice(0, 2)}•••@${domain}`;
}

/** A URL as a person reads it: no scheme, no `www.`, no trailing slash. The
 *  link still goes to the full address; this is only what is shown. */
export function displayUrl(url: string): string {
  return url.trim().replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');
}

/* ── Domains ──────────────────────────────────────────────────── */

/** Lowercase, strip scheme / www / trailing slash. Domains are stored normalised. */
export function normalizeDomain(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

export const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/* ── Misc ─────────────────────────────────────────────────────── */

export function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

export function groupCount<T>(xs: T[], key: (x: T) => string): Record<string, number> {
  return xs.reduce<Record<string, number>>((acc, x) => {
    const k = key(x);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
}

export function sortBy<T>(xs: T[], key: (x: T) => string | number | null, dir: 'asc' | 'desc' = 'asc'): T[] {
  return [...xs].sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av === null && bv === null) return 0;
    if (av === null) return 1; // nulls last, regardless of direction
    if (bv === null) return -1;
    const r = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? r : -r;
  });
}
