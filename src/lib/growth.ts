/** Social growth and content engagement rules.
 *
 *  Pure functions over the recorded snapshots and posts, in the same style as
 *  `rules.ts`, so the daily-entry grid, the follower table, the content ranking
 *  and the charts all derive their figures the same way and cannot disagree. */

import type { ContentPost, FollowerSnapshot, SocialAccount } from './types';
import { parseISO, toISODate } from './utils';

/* ── Configurable thresholds ──────────────────────────────────── */

export interface GrowthThresholds {
  /** Default reporting window for gain / trend. */
  windowDays: number;
  /** Percent change over the window inside which an account reads as flat. */
  flatBandPercent: number;
  /** An account whose newest snapshot is older than this is not being tracked. */
  staleTrackingDays: number;
  /** Posts below this view count are excluded from the engagement leaderboard —
   *  a 3-view post with 1 like is a 33% rate and would otherwise top the table. */
  leaderboardMinViews: number;
}

export const DEFAULT_GROWTH_THRESHOLDS: GrowthThresholds = {
  windowDays: 30,
  flatBandPercent: 0.5,
  staleTrackingDays: 7,
  leaderboardMinViews: 100,
};

/* ── Follower series ──────────────────────────────────────────── */

export interface SnapshotPoint {
  date: string;
  followerCount: number;
  /** Gain since the previous snapshot. Null on the first point of a series. */
  gain: number | null;
  /** Days the gain spans — greater than 1 when a day was missed. */
  spanDays: number | null;
  /** Gain averaged over the span, so a two-day catch-up is not read as a spike. */
  perDay: number | null;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** One account's snapshots in date order, with gains derived against the previous
 *  point. Recording totals rather than gains is what makes a missed day harmless. */
export function snapshotSeries(snapshots: FollowerSnapshot[], accountId: string): SnapshotPoint[] {
  const byDate = new Map<string, FollowerSnapshot>();
  snapshots
    .filter((s) => s.accountId === accountId)
    .forEach((s) => {
      // Defensive: the API keeps one row per account per day, but if two ever
      // arrive the later recording wins.
      const existing = byDate.get(s.date);
      if (!existing || s.recordedAt >= existing.recordedAt) byDate.set(s.date, s);
    });

  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s, i, all) => {
      const prev = i === 0 ? null : all[i - 1];
      if (!prev) return { date: s.date, followerCount: s.followerCount, gain: null, spanDays: null, perDay: null };
      const spanDays = Math.max(1, daysBetween(prev.date, s.date));
      const gain = s.followerCount - prev.followerCount;
      return { date: s.date, followerCount: s.followerCount, gain, spanDays, perDay: gain / spanDays };
    });
}

export function latestSnapshot(snapshots: FollowerSnapshot[], accountId: string): SnapshotPoint | null {
  const series = snapshotSeries(snapshots, accountId);
  return series.length ? series[series.length - 1] : null;
}

export type GrowthTrend = 'growing' | 'flat' | 'declining' | 'insufficient-data';

export interface GrowthSummary {
  accountId: string;
  points: SnapshotPoint[];
  /** Points inside the reporting window. */
  windowPoints: SnapshotPoint[];
  latest: SnapshotPoint | null;
  startCount: number | null;
  endCount: number | null;
  absoluteGain: number | null;
  percentGain: number | null;
  averagePerDay: number | null;
  trend: GrowthTrend;
  /** Whether this account has ever had a figure recorded. */
  tracked: boolean;
  /** True only for an account that *was* being tracked and has stopped. An account
   *  nobody has ever recorded is untracked, not stale — conflating the two turns a
   *  "we never started" into an alarming "we stopped". */
  trackingStale: boolean;
  daysSinceLastEntry: number | null;
}

export function growthSummary(
  snapshots: FollowerSnapshot[],
  accountId: string,
  options: { windowDays?: number; today?: Date; thresholds?: GrowthThresholds } = {},
): GrowthSummary {
  const thresholds = options.thresholds ?? DEFAULT_GROWTH_THRESHOLDS;
  const windowDays = options.windowDays ?? thresholds.windowDays;
  const today = options.today ?? new Date();
  // Against the same `today` as the window/cutoff below, not the real clock —
  // otherwise a fixed `today` passed in for a test or a re-run stops matching
  // "stale" against the date it was actually computed for.
  const daysSince = (s: string): number => {
    const d = parseISO(s)!;
    const a = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const b = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    return Math.round((a - b) / 86_400_000);
  };

  const points = snapshotSeries(snapshots, accountId);
  const latest = points.length ? points[points.length - 1] : null;
  const cutoff = toISODate(new Date(Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - windowDays,
  )));
  const windowPoints = points.filter((p) => p.date >= cutoff);

  const base: GrowthSummary = {
    accountId,
    points,
    windowPoints,
    latest,
    startCount: null,
    endCount: latest?.followerCount ?? null,
    absoluteGain: null,
    percentGain: null,
    averagePerDay: null,
    trend: 'insufficient-data',
    tracked: latest !== null,
    trackingStale: latest !== null && daysSince(latest.date) > thresholds.staleTrackingDays,
    daysSinceLastEntry: latest ? daysSince(latest.date) : null,
  };

  // A trend needs two points inside the window to compare.
  if (windowPoints.length < 2) return base;

  const first = windowPoints[0];
  const last = windowPoints[windowPoints.length - 1];
  const spanDays = Math.max(1, daysBetween(first.date, last.date));
  const absoluteGain = last.followerCount - first.followerCount;
  const percentGain = first.followerCount === 0 ? null : (absoluteGain / first.followerCount) * 100;

  let trend: GrowthTrend = 'flat';
  if (percentGain !== null) {
    if (percentGain > thresholds.flatBandPercent) trend = 'growing';
    else if (percentGain < -thresholds.flatBandPercent) trend = 'declining';
  } else {
    trend = absoluteGain > 0 ? 'growing' : absoluteGain < 0 ? 'declining' : 'flat';
  }

  return {
    ...base,
    startCount: first.followerCount,
    endCount: last.followerCount,
    absoluteGain,
    percentGain,
    averagePerDay: absoluteGain / spanDays,
    trend,
  };
}

export const TREND_LABELS: Record<GrowthTrend, string> = {
  growing: 'Growing',
  flat: 'Flat',
  declining: 'Declining',
  'insufficient-data': 'Not enough data',
};

/* ── Daily entry ──────────────────────────────────────────────── */

/** Accounts that should have a number for this date but do not. Only live accounts
 *  are expected — a closed or suspended account is not a tracking gap. */
export function accountsMissingSnapshot(
  accounts: SocialAccount[],
  snapshots: FollowerSnapshot[],
  date: string,
): SocialAccount[] {
  const recorded = new Set(snapshots.filter((s) => s.date === date).map((s) => s.accountId));
  return trackableAccounts(accounts).filter((a) => !recorded.has(a.id));
}

export function trackableAccounts(accounts: SocialAccount[]): SocialAccount[] {
  return accounts.filter(
    (a) => !a.archived && a.operationalStatus !== 'Closed' && a.operationalStatus !== 'Suspended',
  );
}

/** A future date cannot have been observed yet.
 *
 *  Compares ISO strings directly rather than going through `daysUntil`, which
 *  always reads the wall clock and so ignored the `today` argument — the two
 *  halves of the old condition disagreed whenever a caller injected a date. */
export function isFutureDate(date: string, today = new Date()): boolean {
  return date > toISODate(today);
}

/* ── Content engagement ───────────────────────────────────────── */

/** (likes + comments + shares) ÷ views, as a percentage. Null when views is zero —
 *  a rate over no views is not a number anyone should act on. */
export function engagementRate(post: Pick<ContentPost, 'views' | 'likes' | 'comments' | 'shares'>): number | null {
  if (!post.views) return null;
  return ((post.likes + post.comments + post.shares) / post.views) * 100;
}

export function totalEngagements(post: Pick<ContentPost, 'likes' | 'comments' | 'shares'>): number {
  return post.likes + post.comments + post.shares;
}

export type ContentRankBy = 'engagementRate' | 'views' | 'totalEngagements' | 'followerGain';

export interface RankedPost {
  post: ContentPost;
  rate: number | null;
  engagements: number;
}

/** Ranks content, excluding posts too small for their rate to mean anything. */
export function rankContent(
  posts: ContentPost[],
  options: { by?: ContentRankBy; limit?: number; minViews?: number; thresholds?: GrowthThresholds } = {},
): RankedPost[] {
  const thresholds = options.thresholds ?? DEFAULT_GROWTH_THRESHOLDS;
  const by = options.by ?? 'engagementRate';
  const minViews = options.minViews ?? thresholds.leaderboardMinViews;

  const eligible = posts
    .filter((p) => !p.archived)
    // The view floor only guards the *rate*; the other orderings are absolute
    // counts that a small post cannot game.
    .filter((p) => (by === 'engagementRate' ? p.views >= minViews : true))
    .map((p) => ({ post: p, rate: engagementRate(p), engagements: totalEngagements(p) }));

  const value = (r: RankedPost) => {
    switch (by) {
      case 'views': return r.post.views;
      case 'totalEngagements': return r.engagements;
      case 'followerGain': return r.post.followerGain ?? -1;
      default: return r.rate ?? -1;
    }
  };

  const sorted = eligible.sort((a, b) => value(b) - value(a));
  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

export interface ContentSummary {
  posts: number;
  totalViews: number;
  totalEngagements: number;
  medianRate: number | null;
  totalFollowerGain: number;
}

export function contentSummary(posts: ContentPost[]): ContentSummary {
  const live = posts.filter((p) => !p.archived);
  const rates = live.map(engagementRate).filter((r): r is number => r !== null).sort((a, b) => a - b);
  const mid = Math.floor(rates.length / 2);
  return {
    posts: live.length,
    totalViews: live.reduce((n, p) => n + p.views, 0),
    totalEngagements: live.reduce((n, p) => n + totalEngagements(p), 0),
    medianRate: rates.length === 0 ? null : rates.length % 2 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2,
    totalFollowerGain: live.reduce((n, p) => n + (p.followerGain ?? 0), 0),
  };
}
