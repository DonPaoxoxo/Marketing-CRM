/** Social Media Posting rules: date-window resolution and the dashboard
 *  summary. Pure functions over an already-loaded array, in the same style as
 *  `growth.ts`, so the page and its tests compute figures the same way. */

import { SOCIAL_POST_PLATFORM, SOCIAL_POST_PURPOSE, type SocialMediaPost, type SocialPostPurpose } from './types';
import { addDays, groupCount, parseISO, toISODate } from './utils';

export const DATE_FILTER_PRESET = ['today', 'yesterday', 'custom', 'range'] as const;
export type DateFilterPreset = (typeof DATE_FILTER_PRESET)[number];

export interface DateWindow { from: string; to: string }

/** The inclusive [from, to] window (YYYY-MM-DD) a preset resolves to.
 *  `custom`/`range` fall back to `today` for any date the caller has not
 *  picked yet, so the page never computes against an empty window. A reversed
 *  range (to before from) is swapped rather than treated as empty — a typo in
 *  either box should not silently produce "no posts". */
export function resolveDateWindow(
  preset: DateFilterPreset,
  today: string,
  custom?: string,
  rangeFrom?: string,
  rangeTo?: string,
): DateWindow {
  if (preset === 'yesterday') {
    const y = toISODate(addDays(parseISO(today)!, -1));
    return { from: y, to: y };
  }
  if (preset === 'custom') {
    const d = custom || today;
    return { from: d, to: d };
  }
  if (preset === 'range') {
    const from = rangeFrom || today;
    const to = rangeTo || today;
    return from <= to ? { from, to } : { from: to, to: from };
  }
  return { from: today, to: today };
}

export const inWindow = (postDate: string, window: DateWindow): boolean =>
  postDate >= window.from && postDate <= window.to;

/** What a post counts as for the platform breakdown: the typed-in name when
 *  "Others" was picked, the preset otherwise. Purpose stays bucketed to the
 *  three presets everywhere — only the platform breakdown opens up to
 *  individual custom values (see section 5 vs 7 of the spec this followed). */
export const effectivePlatform = (post: Pick<SocialMediaPost, 'platform' | 'customPlatform'>): string =>
  (post.platform === 'Others' && post.customPlatform.trim()) ? post.customPlatform.trim() : post.platform;

export interface PostingSummary {
  totalPosts: number;
  /** Of `expectedMembers`, how many have at least one post in the set. */
  activeMarketers: number;
  /** Distinct platforms (custom values counted individually) with at least one post. */
  platformsUsed: number;
  eventPosts: number;
  byPlatform: { label: string; count: number }[];
  byMember: { memberId: string; label: string; count: number }[];
  byPurpose: { purpose: SocialPostPurpose; count: number }[];
}

const STANDARD_PLATFORMS = SOCIAL_POST_PLATFORM.filter((p) => p !== 'Others');

/** The dashboard summary for a set of posts the caller has already filtered
 *  down to — by date window, and to `status === 'active'` (archived posts
 *  never feed the normal dashboard; see ARCHIVE RULES). Every standard
 *  platform and every expected member appears even at zero, so a quiet day
 *  reads as "nobody posted" rather than an empty table. */
export function summarisePosts(
  posts: SocialMediaPost[],
  expectedMembers: { id: string; name: string }[],
): PostingSummary {
  const platformCounts = groupCount(posts, effectivePlatform);
  const memberCounts = groupCount(posts, (p) => p.marketingMemberId);
  const purposeCounts = groupCount(posts, (p) => p.purpose);
  const customPlatforms = Object.keys(platformCounts)
    .filter((p) => !(STANDARD_PLATFORMS as readonly string[]).includes(p))
    .sort((a, b) => a.localeCompare(b));

  return {
    totalPosts: posts.length,
    activeMarketers: expectedMembers.filter((m) => (memberCounts[m.id] ?? 0) > 0).length,
    platformsUsed: Object.keys(platformCounts).length,
    eventPosts: purposeCounts.Event ?? 0,
    byPlatform: [
      ...STANDARD_PLATFORMS.map((label) => ({ label, count: platformCounts[label] ?? 0 })),
      ...customPlatforms.map((label) => ({ label, count: platformCounts[label] })),
    ],
    byMember: expectedMembers.map((m) => ({ memberId: m.id, label: m.name, count: memberCounts[m.id] ?? 0 })),
    byPurpose: SOCIAL_POST_PURPOSE.map((purpose) => ({ purpose, count: purposeCounts[purpose] ?? 0 })),
  };
}
