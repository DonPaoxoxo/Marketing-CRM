import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GROWTH_THRESHOLDS, accountsMissingSnapshot, contentSummary, engagementRate,
  growthSummary, isFutureDate, latestSnapshot, rankContent, snapshotSeries, trackableAccounts,
} from './growth';
import type { ContentPost, FollowerSnapshot, SocialAccount } from './types';

const snap = (accountId: string, date: string, followerCount: number, recordedAt = `${date}T09:00:00.000Z`): FollowerSnapshot => ({
  id: `FSN-${accountId}-${date}`, accountId, date, followerCount,
  recordedById: 'TM-01', recordedAt, note: '',
});

const post = (over: Partial<ContentPost> = {}): ContentPost => ({
  id: 'CNT-0001', accountId: 'ACC-0001', platformId: 'PLT-02', format: 'Reel',
  title: 'A post', url: '', publishedDate: '2026-09-01',
  views: 1000, likes: 80, comments: 15, shares: 5, followerGain: 12,
  metricsMeasuredAt: '2026-09-12', notes: '', archived: false,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('gain is derived from totals, so a missed day cannot break the series', () => {
  const series = [
    snap('A', '2026-09-01', 1000),
    snap('A', '2026-09-02', 1100),
    // 2026-09-03 missed entirely
    snap('A', '2026-09-04', 1400),
  ];

  it('reports the full gain across the gap, spread over the days it spans', () => {
    const points = snapshotSeries(series, 'A');
    expect(points.map((p) => p.gain)).toEqual([null, 100, 300]);
    expect(points.map((p) => p.spanDays)).toEqual([null, 1, 2]);
    // 300 over two days reads as 150/day, not a 300 spike.
    expect(points[2].perDay).toBe(150);
  });

  it('leaves the first point without a gain rather than inventing one', () => {
    expect(snapshotSeries(series, 'A')[0].gain).toBeNull();
  });

  it('orders by date regardless of insertion order', () => {
    const shuffled = [series[2], series[0], series[1]];
    expect(snapshotSeries(shuffled, 'A').map((p) => p.date)).toEqual(['2026-09-01', '2026-09-02', '2026-09-04']);
  });

  it('keeps one point per day, preferring the later recording', () => {
    const corrected = [
      snap('A', '2026-09-01', 1000, '2026-09-01T09:00:00.000Z'),
      snap('A', '2026-09-01', 1050, '2026-09-01T17:00:00.000Z'),
    ];
    const points = snapshotSeries(corrected, 'A');
    expect(points).toHaveLength(1);
    expect(points[0].followerCount).toBe(1050);
  });

  it('ignores other accounts entirely', () => {
    const mixed = [...series, snap('B', '2026-09-02', 99999)];
    expect(snapshotSeries(mixed, 'A').every((p) => p.followerCount < 2000)).toBe(true);
    expect(latestSnapshot(mixed, 'B')?.followerCount).toBe(99999);
  });

  it('returns an empty series for an untracked account', () => {
    expect(snapshotSeries(series, 'ZZZ')).toEqual([]);
    expect(latestSnapshot(series, 'ZZZ')).toBeNull();
  });
});

describe('growth summary and trend', () => {
  const today = new Date('2026-09-12T00:00:00Z');

  it('classifies a clearly rising account as growing', () => {
    const s = [snap('A', '2026-09-01', 1000), snap('A', '2026-09-11', 1200)];
    const g = growthSummary(s, 'A', { today });
    expect(g.trend).toBe('growing');
    expect(g.absoluteGain).toBe(200);
    expect(g.percentGain).toBeCloseTo(20, 5);
    expect(g.averagePerDay).toBe(20);
  });

  it('classifies a falling account as declining', () => {
    const s = [snap('A', '2026-09-01', 1000), snap('A', '2026-09-11', 900)];
    expect(growthSummary(s, 'A', { today }).trend).toBe('declining');
  });

  it('treats movement inside the flat band as flat, not growth', () => {
    // +0.2% over the window, under the 0.5% band.
    const s = [snap('A', '2026-09-01', 10_000), snap('A', '2026-09-11', 10_020)];
    const g = growthSummary(s, 'A', { today });
    expect(g.trend).toBe('flat');
    expect(g.absoluteGain).toBe(20);
  });

  it('refuses to call a trend from a single data point', () => {
    const g = growthSummary([snap('A', '2026-09-10', 1000)], 'A', { today });
    expect(g.trend).toBe('insufficient-data');
    expect(g.absoluteGain).toBeNull();
    expect(g.endCount).toBe(1000);
  });

  it('only measures inside the window', () => {
    const s = [
      snap('A', '2026-01-01', 100),   // far outside a 30-day window
      snap('A', '2026-09-01', 1000),
      snap('A', '2026-09-11', 1100),
    ];
    const g = growthSummary(s, 'A', { today, windowDays: 30 });
    expect(g.startCount).toBe(1000);
    expect(g.absoluteGain).toBe(100);
    expect(g.points).toHaveLength(3);      // full history retained for the chart
    expect(g.windowPoints).toHaveLength(2);
  });

  it('flags an account that has stopped being tracked', () => {
    const stale = growthSummary([snap('A', '2026-08-01', 10), snap('A', '2026-08-02', 20)], 'A', { today });
    expect(stale.trackingStale).toBe(true);
    expect(stale.daysSinceLastEntry).toBeGreaterThan(DEFAULT_GROWTH_THRESHOLDS.staleTrackingDays);

    const fresh = growthSummary([snap('A', '2026-09-10', 10), snap('A', '2026-09-12', 20)], 'A', { today });
    expect(fresh.trackingStale).toBe(false);
  });

  it('handles an account that started from zero followers', () => {
    const g = growthSummary([snap('A', '2026-09-01', 0), snap('A', '2026-09-11', 50)], 'A', { today });
    expect(g.percentGain).toBeNull();     // no sane percentage from a zero base
    expect(g.trend).toBe('growing');      // but the direction is not in doubt
    expect(g.absoluteGain).toBe(50);
  });
});

describe('daily entry gaps', () => {
  const accounts = [
    { id: 'ACC-1', archived: false, operationalStatus: 'Active' },
    { id: 'ACC-2', archived: false, operationalStatus: 'Under Review' },
    { id: 'ACC-3', archived: false, operationalStatus: 'Suspended' },
    { id: 'ACC-4', archived: true, operationalStatus: 'Active' },
  ] as SocialAccount[];

  it('expects a number only from accounts that are actually live', () => {
    expect(trackableAccounts(accounts).map((a) => a.id)).toEqual(['ACC-1', 'ACC-2']);
  });

  it('lists the live accounts with nothing recorded for the date', () => {
    const missing = accountsMissingSnapshot(accounts, [snap('ACC-1', '2026-09-12', 10)], '2026-09-12');
    expect(missing.map((a) => a.id)).toEqual(['ACC-2']);
  });

  it('does not count a different day as covering today', () => {
    const missing = accountsMissingSnapshot(accounts, [snap('ACC-1', '2026-09-11', 10)], '2026-09-12');
    expect(missing.map((a) => a.id)).toEqual(['ACC-1', 'ACC-2']);
  });

  it('rejects a date that has not happened yet', () => {
    const today = new Date('2026-09-12T00:00:00Z');
    expect(isFutureDate('2026-09-13', today)).toBe(true);
    expect(isFutureDate('2026-09-12', today)).toBe(false);
    expect(isFutureDate('2026-09-01', today)).toBe(false);
  });
});

describe('engagement rate', () => {
  it('is engagements over views, as a percentage', () => {
    expect(engagementRate({ views: 1000, likes: 80, comments: 15, shares: 5 })).toBeCloseTo(10, 5);
  });

  it('is null rather than infinite when a post has no views', () => {
    expect(engagementRate({ views: 0, likes: 5, comments: 0, shares: 0 })).toBeNull();
  });
});

describe('content ranking', () => {
  const posts = [
    post({ id: 'CNT-1', title: 'Big hit', views: 50_000, likes: 4000, comments: 500, shares: 500 }),   // 10%
    post({ id: 'CNT-2', title: 'Solid', views: 10_000, likes: 1500, comments: 200, shares: 300 }),     // 20%
    post({ id: 'CNT-3', title: 'Tiny fluke', views: 3, likes: 3, comments: 0, shares: 0 }),            // 100%
    post({ id: 'CNT-4', title: 'Archived', views: 99_999, likes: 90_000, comments: 0, shares: 0, archived: true }),
  ];

  it('excludes posts too small for their rate to mean anything', () => {
    const ranked = rankContent(posts, { by: 'engagementRate' });
    expect(ranked.map((r) => r.post.id)).toEqual(['CNT-2', 'CNT-1']);
    expect(ranked.map((r) => r.post.title)).not.toContain('Tiny fluke');
  });

  it('applies the view floor only to the rate ordering', () => {
    const byViews = rankContent(posts, { by: 'views' });
    expect(byViews.map((r) => r.post.id)).toEqual(['CNT-1', 'CNT-2', 'CNT-3']);
  });

  it('never ranks archived posts', () => {
    for (const by of ['engagementRate', 'views', 'totalEngagements', 'followerGain'] as const) {
      expect(rankContent(posts, { by }).some((r) => r.post.archived)).toBe(false);
    }
  });

  it('ranks by absolute engagements and by attributed follower gain', () => {
    expect(rankContent(posts, { by: 'totalEngagements' })[0].post.id).toBe('CNT-1');
    const gainRanked = rankContent(
      [post({ id: 'a', followerGain: 5 }), post({ id: 'b', followerGain: 90 }), post({ id: 'c', followerGain: null })],
      { by: 'followerGain' },
    );
    expect(gainRanked.map((r) => r.post.id)).toEqual(['b', 'a', 'c']);
  });

  it('honours the limit', () => {
    expect(rankContent(posts, { by: 'views', limit: 2 })).toHaveLength(2);
  });

  it('lets the view floor be overridden', () => {
    const ranked = rankContent(posts, { by: 'engagementRate', minViews: 0 });
    expect(ranked[0].post.id).toBe('CNT-3');
  });
});

describe('content summary', () => {
  it('totals views, engagements and attributed follower gain, and takes a median rate', () => {
    const s = contentSummary([
      post({ views: 100, likes: 10, comments: 0, shares: 0, followerGain: 1 }),   // 10%
      post({ views: 100, likes: 20, comments: 0, shares: 0, followerGain: 2 }),   // 20%
      post({ views: 100, likes: 30, comments: 0, shares: 0, followerGain: null }),// 30%
    ]);
    expect(s.posts).toBe(3);
    expect(s.totalViews).toBe(300);
    expect(s.totalEngagements).toBe(60);
    expect(s.medianRate).toBeCloseTo(20, 5);
    expect(s.totalFollowerGain).toBe(3);
  });

  it('reports no median when nothing has views', () => {
    expect(contentSummary([post({ views: 0 })]).medianRate).toBeNull();
  });
});

describe('never tracked is not the same as tracking gone stale', () => {
  const today = new Date('2026-09-12T00:00:00Z');

  it('reports an account nobody has ever recorded as untracked, not stale', () => {
    const g = growthSummary([], 'ACC-never', { today });
    expect(g.tracked).toBe(false);
    expect(g.trackingStale).toBe(false);
    expect(g.daysSinceLastEntry).toBeNull();
  });

  it('reports an account that was tracked and stopped as stale', () => {
    const g = growthSummary([snap('A', '2026-08-01', 10), snap('A', '2026-08-02', 20)], 'A', { today });
    expect(g.tracked).toBe(true);
    expect(g.trackingStale).toBe(true);
  });

  it('reports a currently tracked account as neither', () => {
    const g = growthSummary([snap('A', '2026-09-11', 10), snap('A', '2026-09-12', 20)], 'A', { today });
    expect(g.tracked).toBe(true);
    expect(g.trackingStale).toBe(false);
  });
});
