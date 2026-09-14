/** Ads Monitoring metrics, calculated from saved daily records.
 *
 *  Rules that keep the numbers honest:
 *   - an unavailable value is null, never zero, and a total over a period says
 *     how many days actually had the value;
 *   - ratios are recalculated from summed inputs, never averaged day by day;
 *   - a denominator of zero, or a missing input, gives N/A (null);
 *   - content interactions are only complete when reactions, comments, shares and
 *     saves were all recorded for the same days; a partial sum is labelled;
 *   - reach is the SUM OF DAILY REACH, not deduplicated unique reach. */

import { SCALE, decimalToUnits, unitsToNumber } from './money';

export const OBJECTIVES = ['Engagement', 'Traffic', 'Awareness', 'Follower Growth', 'App Installs'] as const;
export type Objective = (typeof OBJECTIVES)[number];

export const COUNT_FIELDS = [
  'reach', 'impressions', 'clicksAll', 'linkClicks', 'landingPageViews',
  'reactions', 'comments', 'shares', 'saves', 'newFollowers', 'appInstalls', 'platformPostEngagements',
] as const;
export type CountField = (typeof COUNT_FIELDS)[number];

export const METRIC_LABELS: Record<CountField | 'amountSpent', string> = {
  amountSpent: 'Amount spent', reach: 'Reach', impressions: 'Impressions', clicksAll: 'Clicks (all)', linkClicks: 'Link clicks',
  landingPageViews: 'Landing-page views', reactions: 'Reactions', comments: 'Comments', shares: 'Shares', saves: 'Saves',
  newFollowers: 'New followers', appInstalls: 'App installs', platformPostEngagements: 'Platform-reported post engagements',
};

export const REACH_NOTE = 'Sum of daily reach. This is not deduplicated unique campaign reach.';

/** One saved daily record. Money arrives as the database's DECIMAL string. */
export interface DailyRecord extends Partial<Record<CountField, number | null>> {
  reportDate: string;
  amountSpent: string | null;
}

export interface Total { value: number | null; days: number; of: number }
export interface MoneyTotal { units: bigint | null; days: number; of: number }

export interface Aggregate {
  days: number;
  firstDate: string | null;
  lastDate: string | null;
  spend: MoneyTotal;
  counts: Record<CountField, Total>;
  /** reactions + comments + shares + saves, over the days that have all four. */
  interactions: Total & { complete: boolean };
}

const INTERACTION_PARTS: CountField[] = ['reactions', 'comments', 'shares', 'saves'];

export function aggregate(records: readonly DailyRecord[]): Aggregate {
  const of = records.length;
  const counts = Object.fromEntries(COUNT_FIELDS.map((f) => {
    const present = records.map((r) => r[f]).filter((v): v is number => v !== null && v !== undefined);
    return [f, { value: present.length ? present.reduce((a, b) => a + b, 0) : null, days: present.length, of }];
  })) as Record<CountField, Total>;

  let spendUnits: bigint | null = null;
  let spendDays = 0;
  for (const r of records) {
    const units = decimalToUnits(r.amountSpent);
    if (units === null) continue;
    spendUnits = (spendUnits ?? 0n) + units;
    spendDays++;
  }

  const fullDays = records.filter((r) => INTERACTION_PARTS.every((p) => r[p] !== null && r[p] !== undefined));
  const interactionValue = fullDays.length ? fullDays.reduce((sum, r) => sum + INTERACTION_PARTS.reduce((s, p) => s + (r[p] as number), 0), 0) : null;
  const dates = records.map((r) => r.reportDate).sort();

  return {
    days: of,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    spend: { units: spendUnits, days: spendDays, of },
    counts,
    interactions: { value: interactionValue, days: fullDays.length, of, complete: of > 0 && fullDays.length === of },
  };
}

const ratio = (num: number | null, den: number | null, scale = 1): number | null =>
  num === null || den === null || den === 0 ? null : (num / den) * scale;

/** Money ÷ count, from exact units. */
const costPer = (units: bigint | null, den: number | null): number | null =>
  units === null || den === null || den === 0 ? null : unitsToNumber(units) / den;

/** A ratio is only meaningful when both inputs cover the same days. */
const sameDays = (a: { days: number }, b: { days: number }) => a.days === b.days;

export interface Metrics {
  spend: bigint | null;
  reachSum: number | null;
  impressions: number | null;
  clicksAll: number | null;
  linkClicks: number | null;
  landingPageViews: number | null;
  interactions: number | null;
  interactionsComplete: boolean;
  newFollowers: number | null;
  appInstalls: number | null;
  platformPostEngagements: number | null;
  linkCtr: number | null;
  allClickCtr: number | null;
  costPerLinkClick: number | null;
  allClickCpc: number | null;
  cpm: number | null;
  engagementRate: number | null;
  costPerInteraction: number | null;
  landingPageArrivalRate: number | null;
  costPerLandingPageView: number | null;
  costPerInstall: number | null;
  costPerFollower: number | null;
  averageDailySpend: number | null;
  budgetRemaining: bigint | null;
  budgetUtilization: number | null;
}

export function computeMetrics(agg: Aggregate, budget: string | null = null): Metrics {
  const c = agg.counts;
  const spend = agg.spend.units;
  // Spend must cover the same days as the denominator, or the cost is not comparable.
  const spendFor = (t: Total) => (sameDays(agg.spend, t) ? spend : null);
  const interactionsTotal = agg.interactions.complete ? agg.interactions.value : null;
  const budgetUnits = decimalToUnits(budget);

  return {
    spend,
    reachSum: c.reach.value,
    impressions: c.impressions.value,
    clicksAll: c.clicksAll.value,
    linkClicks: c.linkClicks.value,
    landingPageViews: c.landingPageViews.value,
    interactions: agg.interactions.value,
    interactionsComplete: agg.interactions.complete,
    newFollowers: c.newFollowers.value,
    appInstalls: c.appInstalls.value,
    platformPostEngagements: c.platformPostEngagements.value,
    linkCtr: sameDays(c.linkClicks, c.impressions) ? ratio(c.linkClicks.value, c.impressions.value, 100) : null,
    allClickCtr: sameDays(c.clicksAll, c.impressions) ? ratio(c.clicksAll.value, c.impressions.value, 100) : null,
    costPerLinkClick: costPer(spendFor(c.linkClicks), c.linkClicks.value),
    allClickCpc: costPer(spendFor(c.clicksAll), c.clicksAll.value),
    cpm: ((cost) => (cost === null ? null : cost * 1000))(costPer(spendFor(c.impressions), c.impressions.value)),
    engagementRate: interactionsTotal !== null && sameDays(agg.interactions, c.reach) ? ratio(interactionsTotal, c.reach.value, 100) : null,
    costPerInteraction: interactionsTotal !== null && sameDays(agg.spend, agg.interactions) ? costPer(spend, interactionsTotal) : null,
    landingPageArrivalRate: sameDays(c.landingPageViews, c.linkClicks) ? ratio(c.landingPageViews.value, c.linkClicks.value, 100) : null,
    costPerLandingPageView: costPer(spendFor(c.landingPageViews), c.landingPageViews.value),
    costPerInstall: costPer(spendFor(c.appInstalls), c.appInstalls.value),
    costPerFollower: costPer(spendFor(c.newFollowers), c.newFollowers.value),
    averageDailySpend: spend === null || agg.spend.days === 0 ? null : unitsToNumber(spend) / agg.spend.days,
    budgetRemaining: budgetUnits === null || spend === null ? budgetUnits : budgetUnits - spend,
    budgetUtilization: budgetUnits === null || budgetUnits === 0n || spend === null ? null : Number((spend * 10_000n) / budgetUnits) / 100,
  };
}

/** The result an objective is judged by, and what it costs. */
export function primaryResult(objective: Objective, m: Metrics): { label: string; value: number | null; costLabel: string; cost: number | null } {
  switch (objective) {
    case 'Traffic': return { label: 'Link clicks', value: m.linkClicks, costLabel: 'Cost per link click', cost: m.costPerLinkClick };
    case 'Awareness': return { label: 'Impressions', value: m.impressions, costLabel: 'CPM', cost: m.cpm };
    case 'Follower Growth': return { label: 'New followers', value: m.newFollowers, costLabel: 'Cost per follower', cost: m.costPerFollower };
    case 'App Installs': return { label: 'App installs', value: m.appInstalls, costLabel: 'Cost per install', cost: m.costPerInstall };
    default: return { label: m.interactionsComplete ? 'Content interactions' : 'Content interactions (incomplete)', value: m.interactionsComplete ? m.interactions : null, costLabel: 'Cost per interaction', cost: m.costPerInteraction };
  }
}

/** Which metrics are worth showing for an objective. */
export const OBJECTIVE_METRICS: Record<Objective, (keyof Metrics)[]> = {
  Engagement: ['interactions', 'engagementRate', 'costPerInteraction', 'reachSum', 'impressions', 'cpm'],
  Traffic: ['linkClicks', 'linkCtr', 'costPerLinkClick', 'landingPageViews', 'landingPageArrivalRate', 'costPerLandingPageView'],
  Awareness: ['reachSum', 'impressions', 'cpm', 'allClickCtr'],
  'Follower Growth': ['newFollowers', 'costPerFollower', 'reachSum', 'interactions', 'engagementRate'],
  'App Installs': ['appInstalls', 'costPerInstall', 'linkClicks', 'costPerLinkClick', 'linkCtr'],
};

/** Daily series for charts: one point per recorded date, null when not recorded. */
export function dailySeries(records: readonly DailyRecord[], pick: (m: Metrics) => number | null) {
  return [...records].sort((a, b) => a.reportDate.localeCompare(b.reportDate))
    .map((r) => ({ date: r.reportDate, value: pick(computeMetrics(aggregate([r]))) }));
}

/** Cumulative spend by recorded date (money as numbers for charting). */
export function cumulativeSpend(records: readonly DailyRecord[]): { date: string; value: number }[] {
  let running = 0n;
  return [...records].sort((a, b) => a.reportDate.localeCompare(b.reportDate)).flatMap((r) => {
    const units = decimalToUnits(r.amountSpent);
    if (units === null) return [];
    running += units;
    return [{ date: r.reportDate, value: unitsToNumber(running) }];
  });
}

export { SCALE };
