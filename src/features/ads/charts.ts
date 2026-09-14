/** Chart series for Ads Monitoring: one value per period, recalculated from
 *  summed inputs; a period with no records is a gap (null), never zero. */

import { aggregate, computeMetrics, type DailyRecord, type Metrics } from '@/lib/ads/metrics';
import { addDaysIso, datesIn } from '@/lib/ads/trends';
import { decimalToUnits, unitsToNumber } from '@/lib/ads/money';

export type Granularity = 'daily' | 'weekly' | 'monthly';

const bucketOf = (date: string, g: Granularity) => {
  if (g === 'daily') return date;
  if (g === 'monthly') return `${date.slice(0, 7)}-01`;
  const d = new Date(`${date}T00:00:00Z`);
  return addDaysIso(date, -((d.getUTCDay() + 6) % 7)); // Monday
};

/** Every bucket from `from` to `to`, with the records that fall in it. */
export function buckets(records: readonly DailyRecord[], g: Granularity, from: string, to: string) {
  const keys = [...new Set(datesIn({ from, to }).map((d) => bucketOf(d, g)))];
  return keys.map((key) => {
    const inBucket = records.filter((r) => r.reportDate >= from && r.reportDate <= to && bucketOf(r.reportDate, g) === key);
    const expectedDays = datesIn({ from, to }).filter((d) => bucketOf(d, g) === key).length;
    return { key, records: inBucket, expectedDays };
  });
}

export function metricSeries(records: readonly DailyRecord[], g: Granularity, from: string, to: string, pick: (m: Metrics) => number | bigint | null) {
  return buckets(records, g, from, to).map((b) => {
    if (!b.records.length) return { date: b.key, value: null as number | null, days: 0, expectedDays: b.expectedDays };
    const v = pick(computeMetrics(aggregate(b.records)));
    return { date: b.key, value: v === null ? null : typeof v === 'bigint' ? unitsToNumber(v) : v, days: b.records.length, expectedDays: b.expectedDays };
  });
}

/** Cumulative spend by day across the range; days without a spend record stay empty. */
export function cumulativeSpendSeries(records: readonly DailyRecord[], from: string, to: string) {
  let running = 0n;
  const byDate = new Map(records.map((r) => [r.reportDate, r]));
  return datesIn({ from, to }).map((d) => {
    const units = decimalToUnits(byDate.get(d)?.amountSpent ?? null);
    if (units === null) return { date: d, value: null as number | null };
    running += units;
    return { date: d, value: unitsToNumber(running) };
  });
}
