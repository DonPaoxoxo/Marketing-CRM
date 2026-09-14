/** When are two phone numbers, or two URLs, the same thing?
 *
 *  Every duplicate check in the app — form warnings, the server's refusal,
 *  CSV import, the duplicate report — compares through these, so all of them
 *  agree on the answer. A check that compared raw strings would let
 *  `https://www.facebook.com/xBrightgamers` and `facebook.com/xbrightgamers/`
 *  through as two different pages.
 *
 *  Browser- and server-safe: no DOM, no Node APIs beyond WHATWG `URL`. */

import { normalizePhone } from './utils';

/** A phone number in the one form duplicates are compared in (E.164-style).
 *  Empty when there is nothing to compare, so a blank is never a duplicate. */
export function phoneKey(raw: string | null | undefined): string {
  const e164 = normalizePhone(raw ?? '');
  return e164.replace(/^\+/, '').length >= 5 ? e164 : '';
}

/** An email address in comparable form: trimmed and lower-cased. Mail providers
 *  treat the address case-insensitively, so Demo@Gmail.com is demo@gmail.com. */
export function emailKey(raw: string | null | undefined): string {
  const email = String(raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

/** A Telegram username in comparable form: no "@", lower-cased. Telegram
 *  usernames are unique and case-insensitive, so @DemoChannel is @demochannel. */
/** The public Telegram link for a username, e.g. https://t.me/cedarhillwanderer.
 *  Empty when there is no username. */
export function telegramUrl(username: string | null | undefined): string {
  const key = telegramKey(username);
  return key ? `https://t.me/${key}` : '';
}

export function telegramKey(raw: string | null | undefined): string {
  return String(raw ?? '').trim().replace(/^@+/, '').replace(/^(https?:\/\/)?(www\.)?t\.me\//i, '').toLowerCase();
}

/** Query parameters that say where a link was shared from, not what it points
 *  at. Stripped so a page shared from WhatsApp matches the same page typed in. */
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'igshid', 'igsh', 'mibextid', 'si', 'ref', 'ref_src', 'ref_url',
  'feature', 'app', 'is_from_webapp', 'sender_device', 'share_app_id', 's', 't',
]);

/** Host prefixes that serve the same content as the bare host. */
const HOST_ALIASES = /^(www|m|mobile|web)\./;

export interface UrlKeyOptions {
  /** Keep the path's letter case. Needed where the path carries a case-sensitive
   *  ID — a YouTube video `AbC123` and `abc123` are different videos — but not
   *  for profile and page URLs, where `/xBrightgamers` and `/xbrightgamers` are
   *  the same page on every platform this team uses. */
  caseSensitivePath?: boolean;
}

/** The comparable form of a URL, or `''` if it is not a usable web address.
 *
 *  Ignores scheme (http/https), `www.`/`m.` prefixes, a trailing slash, the
 *  fragment, tracking parameters and parameter order. Keeps meaningful query
 *  parameters — `facebook.com/profile.php?id=123` and `?id=456` are different
 *  people. YouTube's three URL shapes for one video collapse to one key. */
export function urlKey(raw: string | null | undefined, options: UrlKeyOptions = {}): string {
  let text = String(raw ?? '').trim();
  if (!text) return '';
  // A non-web scheme without slashes (mailto:, tel:, javascript:) is not a page.
  // A digit after the colon is a port on a bare host instead, e.g. "site.com:8080".
  if (/^[a-z][a-z0-9+.-]*:(?!\/\/|\d)/i.test(text)) return '';
  // People paste "facebook.com/page" without a scheme; that is still a page.
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return '';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
  // "https://facebook.com@evil.com/page" is evil.com wearing a disguise; the
  // part before @ is a username, not the site. Never a page this team records.
  if (url.username || url.password) return '';

  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  while (HOST_ALIASES.test(host)) host = host.replace(HOST_ALIASES, '');
  if (!host.includes('.')) return '';

  let path = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const params = new URLSearchParams();
  [...url.searchParams.entries()]
    .filter(([name]) => !TRACKING_PARAMS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('utm_'))
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([name, value]) => params.append(name, value));

  // youtu.be/ID, youtube.com/shorts/ID and youtube.com/watch?v=ID are one video.
  if (host === 'youtu.be' && path.length > 1) {
    params.set('v', path.slice(1));
    host = 'youtube.com';
    path = '/watch';
  } else if (host === 'youtube.com' && /^\/shorts\/[^/]+$/.test(path)) {
    params.set('v', path.split('/')[2]);
    path = '/watch';
  }

  if (!options.caseSensitivePath) path = path.toLowerCase();
  const query = params.toString();
  return `${host}${path}${query ? `?${query}` : ''}`;
}

/** Keys for a list, dropping blanks — for fields that hold several URLs. */
export function urlKeys(values: readonly string[], options?: UrlKeyOptions): string[] {
  return values.map((v) => urlKey(v, options)).filter(Boolean);
}

/** The first value in a list that repeats an earlier one, compared by key. */
export function firstRepeat(values: readonly string[], key: (v: string) => string): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    const k = key(value);
    if (!k) continue;
    if (seen.has(k)) return value;
    seen.add(k);
  }
  return null;
}

/** Content post URLs point at individual videos, whose IDs are case-sensitive. */
export const postUrlKey = (url: string | null | undefined) => urlKey(url, { caseSensitivePath: true });
/** Profile, page and channel URLs, where the path's case does not matter. */
export const pageUrlKey = (url: string | null | undefined) => urlKey(url);
