/** Reading Data Lead rows from a scraper sheet — one rule for browser and server.
 *
 *  The sheet: Platform · Creator · ChannelURL · Subscribers · Tier · Keyword ·
 *  PromoConfidence · EvidenceVideoTitle · EvidenceVideoURL · PublicEmail ·
 *  PublicTelegram · PublicInstagram · Status — the shape of
 *  india_casino_creator_leads_youtube_v2.csv and sheets like it.
 *
 *  Country and Niche are not sheet columns: the team's naming convention
 *  ({country}_{niche}_creator_leads_{platform}_v{n}) puts them in the filename,
 *  so the upload window asks for them once and applies them to every row.
 *  Platform may still vary per row (a mixed-platform sheet), falling back to
 *  the upload's own choice when the cell is blank.
 *
 *  The upload preview and the server's import endpoint both validate through
 *  `validateLeadRow`, so a row the preview marks "ready" is a row the server
 *  accepts. Pure: no DOM, no database. */

import type { DataLeadStatus, Platform } from './types';

/** Only the fields platform resolution needs — callers that load platforms
 *  with a narrower SELECT (the server routes, the seed script) are not forced
 *  to hand over the whole catalogue row. */
type PlatformRef = Pick<Platform, 'id' | 'name' | 'slug'>;
import { DATA_LEAD_STATUS } from './types';
import { postUrlKey } from './identity';
import { sanitizeCount, sanitizeText, sanitizeUrl } from './sanitize';
import {
  cellText, mapHeaders, squash, walkSheet,
  type HeaderMapping, type SheetColumn, type SheetResult as GenericSheetResult,
} from './sheet';

export { cellText };

/* ── Columns ─────────────────────────────────────────────────────── */

export type LeadImportKey =
  | 'platform' | 'creator' | 'channelUrl' | 'subscribers' | 'tier' | 'keyword' | 'promoConfidence'
  | 'evidenceTitle' | 'evidenceUrl' | 'publicEmail' | 'publicTelegram' | 'publicInstagram' | 'status';

export type LeadImportColumn = SheetColumn<LeadImportKey>;

export const LEAD_IMPORT_COLUMNS: readonly LeadImportColumn[] = [
  {
    key: 'platform', header: 'Platform', required: false, aliases: [],
    help: 'Facebook, Instagram, TikTok, YouTube or Twitter/X. Blank uses the platform chosen for this upload.',
  },
  { key: 'creator', header: 'Creator', required: true, aliases: ['name', 'channel', 'creator name'], help: 'Display name or handle.' },
  {
    key: 'channelUrl', header: 'ChannelURL', required: true, aliases: ['channel url', 'profile url', 'url', 'link'],
    help: 'Link to their channel, page or profile.',
  },
  {
    key: 'subscribers', header: 'Subscribers', required: false, aliases: ['followers', 'subscriber count', 'follower count'],
    help: 'Subscriber or follower count at scrape time.',
  },
  { key: 'tier', header: 'Tier', required: false, aliases: [], help: 'e.g. micro-nano (10k-100k).' },
  { key: 'keyword', header: 'Keyword', required: false, aliases: ['search term'], help: 'The search term the evidence post matched.' },
  {
    key: 'promoConfidence', header: 'PromoConfidence', required: false, aliases: ['promo confidence', 'confidence'],
    help: 'How confident the scrape is that this is promotional content, e.g. High, Medium, Low, Review.',
  },
  {
    key: 'evidenceTitle', header: 'EvidenceVideoTitle', required: false, aliases: ['evidence title', 'evidence video title', 'video title'],
    help: 'Title of the post that shows the promotion.',
  },
  {
    key: 'evidenceUrl', header: 'EvidenceVideoURL', required: false, aliases: ['evidence url', 'evidence video url', 'video url'],
    help: 'Link to that post.',
  },
  { key: 'publicEmail', header: 'PublicEmail', required: false, aliases: ['email'], help: 'A public contact email, if one was found. Shown as scraped, never verified.' },
  { key: 'publicTelegram', header: 'PublicTelegram', required: false, aliases: ['telegram'], help: 'A public Telegram reference, if one was found.' },
  { key: 'publicInstagram', header: 'PublicInstagram', required: false, aliases: ['instagram'], help: 'A public Instagram reference, if one was found.' },
  { key: 'status', header: 'Status', required: false, aliases: ['outreach status'], help: 'Blank or "Not contacted" starts the lead fresh.' },
];

/** Match a header row to the lead sheet's columns (see sheet.ts). */
export const mapLeadHeaders = (headerRow: readonly unknown[]): HeaderMapping<LeadImportKey> =>
  mapHeaders(LEAD_IMPORT_COLUMNS, headerRow);

/* ── Platform ────────────────────────────────────────────────────── */

/** Spellings people actually type that this workspace's catalogue names
 *  differently — "Twitter" for the platform configured as "X". */
const PLATFORM_ALIASES: Record<string, string> = { twitter: 'x', 'twitterx': 'x' };

export function resolvePlatform<T extends PlatformRef>(raw: string, platforms: readonly T[]): T | null {
  const key = squash(raw);
  if (!key) return null;
  const aliased = PLATFORM_ALIASES[key] ?? key;
  return platforms.find((p) => squash(p.name) === aliased || squash(p.slug) === aliased) ?? null;
}

/* ── URLs ────────────────────────────────────────────────────────── */

/** Scraped sheets often drop the scheme ("youtube.com/@handle"); still a page. */
function normalizeLink(raw: string): string {
  const text = raw.trim();
  if (!text) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
}

export const readLeadUrl = (raw: string): string => sanitizeUrl(normalizeLink(raw));

/** The key a lead is deduplicated by — the same shape as the register's own
 *  unique constraint (platform, country, channel URL), so a row the preview
 *  marks "ready" is a row the database will actually accept. Case-sensitive:
 *  a YouTube channel id ("UCvg3kN…") is, same reasoning as a content post's. */
export const leadChannelKey = (countryCode: string, platformId: string, channelUrl: string): string =>
  `${countryCode}::${platformId}::${postUrlKey(channelUrl)}`;

/* ── Status ──────────────────────────────────────────────────────── */

const STATUS_BY_KEY: Record<string, DataLeadStatus> = Object.fromEntries(
  DATA_LEAD_STATUS.map((s) => [squash(s), s]),
);

/** Unrecognised or blank text defaults to "Not contacted" rather than failing
 *  the row — it is incidental metadata from the scrape, not something worth
 *  losing 1,000 other good rows over. */
export const readLeadStatus = (raw: string): DataLeadStatus => STATUS_BY_KEY[squash(raw)] ?? 'Not contacted';

/* ── Rows ────────────────────────────────────────────────────────── */

export interface LeadImportInput {
  platformId: string;
  creator: string;
  channelUrl: string;
  followerCount: number | null;
  tier: string;
  keyword: string;
  promoConfidence: string;
  evidenceTitle: string;
  evidenceUrl: string;
  publicEmail: string;
  publicTelegram: string;
  publicInstagram: string;
  status: DataLeadStatus;
}

export interface LeadRowProblem { column: string; message: string }
export interface LeadRowResult { value: LeadImportInput | null; problems: LeadRowProblem[] }

export interface LeadValidationContext {
  platforms: readonly PlatformRef[];
  /** Used when a row's own Platform cell is blank. */
  defaultPlatformId: string;
  /** Set once for the whole upload — see the module doc. */
  countryCode: string;
  /** Channel keys already in the live register. */
  existing: ReadonlySet<string>;
  /** Keys already accepted earlier in this file. The caller adds each one. */
  seen: Set<string>;
}

const headerOf = (key: LeadImportKey) => LEAD_IMPORT_COLUMNS.find((c) => c.key === key)!.header;

export function validateLeadRow(raw: Partial<Record<LeadImportKey, string>>, ctx: LeadValidationContext): LeadRowResult {
  const problems: LeadRowProblem[] = [];
  const say = (key: LeadImportKey, message: string) => problems.push({ column: headerOf(key), message });

  const creator = sanitizeText(raw.creator ?? '', 160);
  if (!creator) say('creator', 'Required.');

  const platformText = (raw.platform ?? '').trim();
  let platformId = ctx.defaultPlatformId;
  if (platformText) {
    const found = resolvePlatform(platformText, ctx.platforms);
    if (!found) say('platform', `"${platformText}" is not a configured platform.`);
    else platformId = found.id;
  }

  const channelUrl = readLeadUrl(raw.channelUrl ?? '');
  if (!channelUrl) say('channelUrl', 'A valid link is required.');

  if (channelUrl && platformId) {
    const channelKey = leadChannelKey(ctx.countryCode, platformId, channelUrl);
    if (ctx.existing.has(channelKey)) say('channelUrl', 'Already a lead in the register for this platform and country. Existing leads are never overwritten.');
    else if (ctx.seen.has(channelKey)) say('channelUrl', 'Duplicated earlier in this file.');
  }

  if (problems.length) return { value: null, problems };

  return {
    value: {
      platformId,
      creator,
      channelUrl,
      followerCount: sanitizeCount(raw.subscribers),
      tier: sanitizeText(raw.tier ?? '', 160),
      keyword: sanitizeText(raw.keyword ?? '', 160),
      promoConfidence: sanitizeText(raw.promoConfidence ?? '', 40),
      evidenceTitle: sanitizeText(raw.evidenceTitle ?? '', 600),
      evidenceUrl: readLeadUrl(raw.evidenceUrl ?? ''),
      publicEmail: sanitizeText(raw.publicEmail ?? '', 160),
      publicTelegram: sanitizeText(raw.publicTelegram ?? '', 160),
      publicInstagram: sanitizeText(raw.publicInstagram ?? '', 160),
      status: readLeadStatus(raw.status ?? ''),
    },
    problems,
  };
}

export type LeadSheetResult = GenericSheetResult<LeadImportKey, LeadImportInput>;

export function validateLeadSheet(
  cells: readonly (readonly unknown[])[],
  ctx: Omit<LeadValidationContext, 'seen'>,
): LeadSheetResult {
  const seen = new Set<string>();
  return walkSheet(cells, LEAD_IMPORT_COLUMNS, (raw) => {
    const result = validateLeadRow(raw, { ...ctx, seen });
    if (result.value) seen.add(leadChannelKey(ctx.countryCode, result.value.platformId, result.value.channelUrl));
    return result;
  });
}
