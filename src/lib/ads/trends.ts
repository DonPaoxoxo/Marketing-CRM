/** Trend comparisons for Ads Monitoring.
 *
 *  A comparison only happens when both windows are complete: every date in each
 *  window has a record with the inputs the metric needs. The current day is never
 *  complete, so the default windows end yesterday in the campaign's reporting
 *  timezone. Nothing here claims statistical significance — a change is described,
 *  not explained. */

import { aggregate, computeMetrics, type DailyRecord, type Metrics } from './metrics';

export type TrendMode = 'last7' | 'previousDay' | 'custom';

export interface Window { from: string; to: string }

const DAY = 86_400_000;
const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number) => toIso(new Date(toDate(iso).getTime() + n * DAY));
export const daysBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY) + 1;
export const datesIn = (w: Window): string[] => {
  const n = daysBetween(w.from, w.to);
  return n <= 0 ? [] : Array.from({ length: n }, (_, i) => addDaysIso(w.from, i));
};

/** Today's date where the campaign reports (e.g. Asia/Manila). */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return toIso(now);
  }
}

/** The two windows to compare, both made only of complete (past) days. */
export function trendWindows(mode: TrendMode, today: string, custom?: Window): { current: Window; previous: Window } | { error: string } {
  if (mode === 'previousDay') {
    const d = addDaysIso(today, -1);
    return { current: { from: d, to: d }, previous: { from: addDaysIso(d, -1), to: addDaysIso(d, -1) } };
  }
  if (mode === 'custom') {
    if (!custom || custom.from > custom.to) return { error: 'Choose a start date on or before the end date.' };
    if (custom.to >= today) return { error: 'The selected period must end before today — today is not complete yet.' };
    const length = daysBetween(custom.from, custom.to);
    return { current: custom, previous: { from: addDaysIso(custom.from, -length), to: addDaysIso(custom.from, -1) } };
  }
  const end = addDaysIso(today, -1);
  return { current: { from: addDaysIso(end, -6), to: end }, previous: { from: addDaysIso(end, -13), to: addDaysIso(end, -7) } };
}

export type Polarity = 'higher' | 'lower' | 'neutral';

export interface TrendMetric {
  key: keyof Metrics;
  label: string;
  /** Which daily inputs must be present on every day for the metric to be complete. */
  needs: ('amountSpent' | 'reach' | 'impressions' | 'clicksAll' | 'linkClicks' | 'landingPageViews' | 'reactions' | 'comments' | 'shares' | 'saves' | 'newFollowers' | 'appInstalls')[];
  polarity: Polarity;
  kind: 'money' | 'count' | 'percent';
}

const INTERACTIONS = ['reactions', 'comments', 'shares', 'saves'] as const;

export const TREND_METRICS: TrendMetric[] = [
  { key: 'spend', label: 'Spend', needs: ['amountSpent'], polarity: 'neutral', kind: 'money' },
  { key: 'reachSum', label: 'Sum of daily reach', needs: ['reach'], polarity: 'neutral', kind: 'count' },
  { key: 'impressions', label: 'Impressions', needs: ['impressions'], polarity: 'neutral', kind: 'count' },
  { key: 'interactions', label: 'Content interactions', needs: [...INTERACTIONS], polarity: 'neutral', kind: 'count' },
  { key: 'engagementRate', label: 'Engagement rate (by summed daily reach)', needs: [...INTERACTIONS, 'reach'], polarity: 'higher', kind: 'percent' },
  { key: 'costPerInteraction', label: 'Cost per interaction', needs: [...INTERACTIONS, 'amountSpent'], polarity: 'lower', kind: 'money' },
  { key: 'linkCtr', label: 'Link CTR', needs: ['linkClicks', 'impressions'], polarity: 'higher', kind: 'percent' },
  { key: 'costPerLinkClick', label: 'Cost per link click', needs: ['linkClicks', 'amountSpent'], polarity: 'lower', kind: 'money' },
  { key: 'cpm', label: 'CPM', needs: ['impressions', 'amountSpent'], polarity: 'lower', kind: 'money' },
  { key: 'landingPageArrivalRate', label: 'Landing-page arrival rate', needs: ['landingPageViews', 'linkClicks'], polarity: 'higher', kind: 'percent' },
  { key: 'costPerLandingPageView', label: 'Cost per landing-page view', needs: ['landingPageViews', 'amountSpent'], polarity: 'lower', kind: 'money' },
  { key: 'costPerInstall', label: 'Cost per install', needs: ['appInstalls', 'amountSpent'], polarity: 'lower', kind: 'money' },
  { key: 'costPerFollower', label: 'Cost per follower', needs: ['newFollowers', 'amountSpent'], polarity: 'lower', kind: 'money' },
];

export type TrendResult =
  | {
    status: 'ok';
    current: number; previous: number;
    direction: 'Uptrend' | 'Downtrend' | 'Stable';
    /** Null when the previous value is zero: there is no comparable baseline. */
    changePct: number | null;
    absoluteChange: number;
    note: string | null;
    interpretation: 'Improving' | 'Declining' | null;
    windows: { current: Window; previous: Window };
  }
  | { status: 'insufficient'; reason: string; windows?: { current: Window; previous: Window } };

const hasAll = (r: DailyRecord, needs: TrendMetric['needs']) =>
  needs.every((n) => (n === 'amountSpent' ? r.amountSpent !== null && r.amountSpent !== undefined : r[n] !== null && r[n] !== undefined));

function missingDates(records: readonly DailyRecord[], w: Window, needs: TrendMetric['needs']): string[] {
  const byDate = new Map(records.map((r) => [r.reportDate, r]));
  return datesIn(w).filter((d) => { const r = byDate.get(d); return !r || !hasAll(r, needs); });
}

const inWindow = (records: readonly DailyRecord[], w: Window) => records.filter((r) => r.reportDate >= w.from && r.reportDate <= w.to);

export function compareTrend(
  records: readonly DailyRecord[],
  metric: TrendMetric,
  windows: { current: Window; previous: Window },
  stablePct = 5,
): TrendResult {
  const missingCurrent = missingDates(records, windows.current, metric.needs);
  const missingPrevious = missingDates(records, windows.previous, metric.needs);
  if (missingCurrent.length || missingPrevious.length) {
    const parts: string[] = [];
    if (missingCurrent.length) parts.push(`current period is missing ${describeDates(missingCurrent)}`);
    if (missingPrevious.length) parts.push(`comparison period is missing ${describeDates(missingPrevious)}`);
    return { status: 'insufficient', reason: `Insufficient Data: the ${parts.join('; the ')} (${metric.needs.join(', ')} must be recorded every day).`, windows };
  }

  const value = (w: Window) => {
    const v = computeMetrics(aggregate(inWindow(records, w)))[metric.key];
    return typeof v === 'bigint' ? Number(v) / 10_000 : (v as number | null);
  };
  const current = value(windows.current);
  const previous = value(windows.previous);
  if (current === null || previous === null) {
    return { status: 'insufficient', reason: 'Insufficient Data: the metric cannot be calculated for one of the periods (a denominator is zero).', windows };
  }

  const absoluteChange = current - previous;
  const changePct = previous === 0 ? null : (absoluteChange / Math.abs(previous)) * 100;
  const direction = changePct === null
    ? (absoluteChange === 0 ? 'Stable' : absoluteChange > 0 ? 'Uptrend' : 'Downtrend')
    : Math.abs(changePct) <= stablePct ? 'Stable' : changePct > 0 ? 'Uptrend' : 'Downtrend';
  const interpretation = direction === 'Stable' || metric.polarity === 'neutral'
    ? null
    : (direction === 'Uptrend') === (metric.polarity === 'higher') ? 'Improving' : 'Declining';

  return {
    status: 'ok', current, previous, direction, changePct, absoluteChange, interpretation, windows,
    note: changePct === null ? 'No comparable baseline' : null,
  };
}

function describeDates(dates: string[]): string {
  return dates.length <= 3 ? dates.join(', ') : `${dates.length} days (${dates[0]} … ${dates[dates.length - 1]})`;
}
