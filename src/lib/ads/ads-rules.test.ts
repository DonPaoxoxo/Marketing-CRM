import { describe, expect, it } from 'vitest';
import { formatMoney, normalizeCurrency, parseAmount, unitsToDecimal } from './money';
import { aggregate, computeMetrics, primaryResult, type DailyRecord } from './metrics';
import { compareTrend, trendWindows, TREND_METRICS, todayIn } from './trends';
import { CREATIVE_MAX_BYTES, checkCreative, checkReference, readImageInfo } from './files';
import {
  campaignAlerts, checkAdsUrl, checkCampaignInput, checkDailyInput, expectedActiveDates, mayAddToCampaign, mayModifyChild,
  mayModifyRecord, pacing, type Campaign,
} from './campaign';

/** The team's own sheet: OVERALL ADS CAMPAIGN MONITORING, Aug 29 – Sep 5. */
const SHEET: DailyRecord[] = [
  ['2026-08-29', 1749, 2602, '246.58', 331, 27],
  ['2026-08-30', 18930, 31182, '1147.64', 871, 354],
  ['2026-08-31', 19533, 31884, '964.48', 561, 409],
  ['2026-09-01', 18734, 28851, '742.10', 504, 292],
  ['2026-09-02', 22637, 35692, '915.39', 582, 386],
  ['2026-09-03', 16410, 23831, '749.74', 797, 309],
  ['2026-09-04', 9701, 15802, '590.00', 1003, 181],
  ['2026-09-05', 19383, 24466, '892.85', 858, 198],
].map(([reportDate, reach, impressions, amountSpent, linkClicks, landingPageViews]) => ({
  reportDate: reportDate as string, reach: reach as number, impressions: impressions as number, amountSpent: amountSpent as string,
  linkClicks: linkClicks as number, landingPageViews: landingPageViews as number,
}));

describe('money', () => {
  it('adds exactly and refuses symbols and separators', () => {
    expect(parseAmount('1147.64')).toEqual({ units: 11_476_400n });
    expect(parseAmount(0.1)).toEqual({ units: 1000n });
    expect(parseAmount('₱1,147.64')).toHaveProperty('error');
    expect(parseAmount('1,147.64')).toHaveProperty('error');
    expect(parseAmount('-5')).toHaveProperty('error');
    expect(parseAmount('')).toBeNull();
    expect(unitsToDecimal(11_476_400n)).toBe('1147.6400');
  });

  it('treats RMB as CNY and shows VND without decimals', () => {
    expect(normalizeCurrency('rmb')).toBe('CNY');
    expect(normalizeCurrency('Renminbi')).toBe('CNY');
    expect(normalizeCurrency('php')).toBe('PHP');
    expect(normalizeCurrency('EUR')).toBeNull();
    expect(formatMoney(25_000_000_000n, 'VND')).toBe('₫2,500,000');
    expect(formatMoney(1234.5678, 'VND', { precise: true })).toBe('₫1,234.57');
    expect(formatMoney(11_476_400n, 'PHP')).toBe('₱1,147.64');
  });
});

describe('metrics — the team sheet', () => {
  const m = computeMetrics(aggregate(SHEET), '30000');
  it('matches the sheet totals exactly', () => {
    expect(unitsToDecimal(m.spend!)).toBe('6248.7800');
    expect(m.reachSum).toBe(127_077);
    expect(m.impressions).toBe(194_310);
    expect(m.linkClicks).toBe(5_507);
    expect(m.landingPageViews).toBe(2_156);
  });

  it('recalculates ratios from totals, as the sheet does', () => {
    expect(m.cpm!.toFixed(2)).toBe('32.16');
    expect(m.costPerLinkClick!.toFixed(2)).toBe('1.13');
    expect(m.landingPageArrivalRate!.toFixed(2)).toBe('39.15');
    expect(m.costPerLandingPageView!.toFixed(2)).toBe('2.90');
    expect(m.averageDailySpend!.toFixed(2)).toBe('781.10');
    expect(m.linkCtr!.toFixed(2)).toBe('2.83');
    expect(unitsToDecimal(m.budgetRemaining!)).toBe('23751.2200');
    expect(m.budgetUtilization).toBe(20.82);
  });

  it('keeps unavailable values as N/A, never zero, and does not complete a partial interaction sum', () => {
    expect(m.clicksAll).toBeNull();
    expect(m.allClickCtr).toBeNull();
    expect(m.interactions).toBeNull();
    expect(m.engagementRate).toBeNull();
    const partial = computeMetrics(aggregate([
      { reportDate: '2026-09-01', amountSpent: '10', reach: 100, reactions: 5, comments: 1, shares: 0, saves: 0 },
      { reportDate: '2026-09-02', amountSpent: '10', reach: 100, reactions: 5 },
    ]));
    expect(partial.interactionsComplete).toBe(false);
    expect(partial.engagementRate).toBeNull();
    expect(partial.costPerInteraction).toBeNull();
    expect(primaryResult('Engagement', partial)).toMatchObject({ label: 'Content interactions (incomplete)', value: null });
  });

  it('gives N/A for a zero denominator', () => {
    const z = computeMetrics(aggregate([{ reportDate: '2026-09-01', amountSpent: '50', impressions: 0, linkClicks: 0 }]));
    expect(z.cpm).toBeNull();
    expect(z.linkCtr).toBeNull();
    expect(z.costPerLinkClick).toBeNull();
  });
});

describe('trends', () => {
  const day = (date: string, reach: number, interactions: number, spend: string): DailyRecord => ({
    reportDate: date, reach, amountSpent: spend, reactions: interactions, comments: 0, shares: 0, saves: 0, impressions: reach * 2,
  });
  const fortnight = (fromDay: number, reachA: number, reachB: number) => Array.from({ length: 14 }, (_, i) => {
    const d = `2026-09-${String(fromDay + i).padStart(2, '0')}`;
    return i < 7 ? day(d, reachA, 100, '100') : day(d, reachB, 100, '100');
  });

  it('compares the last 7 complete days with the 7 before, excluding today', () => {
    const w = trendWindows('last7', '2026-09-15');
    expect(w).toEqual({ current: { from: '2026-09-08', to: '2026-09-14' }, previous: { from: '2026-09-01', to: '2026-09-07' } });
    const records = fortnight(1, 1000, 800); // reach falls, interactions steady → engagement rate rises
    const er = compareTrend(records, TREND_METRICS.find((t) => t.key === 'engagementRate')!, w as never);
    expect(er).toMatchObject({ status: 'ok', direction: 'Uptrend', interpretation: 'Improving' });
    if (er.status === 'ok') expect(er.changePct!.toFixed(1)).toBe('25.0');
    const spend = compareTrend(records, TREND_METRICS.find((t) => t.key === 'spend')!, w as never);
    expect(spend).toMatchObject({ status: 'ok', direction: 'Stable', interpretation: null });
  });

  it('says Insufficient Data when a day is missing, and names it', () => {
    const records = fortnight(1, 1000, 1000).filter((r) => r.reportDate !== '2026-09-10');
    const r = compareTrend(records, TREND_METRICS.find((t) => t.key === 'reachSum')!, trendWindows('last7', '2026-09-15') as never);
    expect(r.status).toBe('insufficient');
    if (r.status === 'insufficient') expect(r.reason).toContain('2026-09-10');
  });

  it('never divides by a zero baseline', () => {
    const records = [day('2026-09-13', 0, 0, '0'), day('2026-09-14', 500, 10, '20')];
    const r = compareTrend(records, TREND_METRICS.find((t) => t.key === 'reachSum')!, trendWindows('previousDay', '2026-09-15') as never);
    expect(r).toMatchObject({ status: 'ok', changePct: null, absoluteChange: 500, note: 'No comparable baseline', direction: 'Uptrend' });
  });

  it('reads today in the campaign timezone', () => {
    expect(todayIn('Asia/Manila', new Date('2026-09-14T17:30:00Z'))).toBe('2026-09-15');
    expect(todayIn('Asia/Kolkata', new Date('2026-09-14T17:30:00Z'))).toBe('2026-09-14');
  });
});

describe('ownership', () => {
  const owner = { id: 'TM-0001', role: 'System Administrator' as const };
  const creator = { id: 'TM-0002', role: 'Marketing Staff' as const };
  const manager = { id: 'TM-0003', role: 'Marketing Manager' as const };
  const campaign = { createdById: creator.id };
  it('lets only the creator and the System Owner change a record', () => {
    expect(mayModifyRecord(creator, campaign)).toBe(true);
    expect(mayModifyRecord(owner, campaign)).toBe(true);
    expect(mayModifyRecord(manager, campaign)).toBe(false);
    expect(mayAddToCampaign(manager, campaign)).toBe(false);
    // A child someone else entered stays theirs — the campaign creator cannot edit it either.
    expect(mayModifyChild(creator, campaign, { createdById: 'TM-0009' })).toBe(false);
    expect(mayModifyChild(owner, campaign, { createdById: 'TM-0009' })).toBe(true);
  });
});

describe('campaign and daily input', () => {
  it('normalises currency and refuses unsafe URLs and bad dates', () => {
    const ok = checkCampaignInput({ reference: 'PH-FB-2026-09', name: 'Sept', platformId: 'PLT-01', targetCountryCode: 'ph', objective: 'traffic', currency: 'RMB', startDate: '2026-08-29', endDate: '2026-09-27', budget: '30000', adsUrl: 'https://www.facebook.com/ads/library/?id=1' });
    expect(ok).toMatchObject({ value: { currency: 'CNY', objective: 'Traffic', targetCountryCode: 'PH', budget: '30000.0000', status: 'Draft', reportingTimezone: 'Asia/Manila' } });
    expect(checkAdsUrl('javascript:alert(1)')).toHaveProperty('error');
    const bad = checkCampaignInput({ reference: 'x', startDate: '2026-09-30', endDate: '2026-09-01' });
    expect(Object.keys((bad as { errors: object }).errors)).toEqual(expect.arrayContaining(['reference', 'name', 'endDate']));
  });

  it('keeps blanks as null, refuses fractions and negatives in counts, and warns about odd relationships', () => {
    const r = checkDailyInput({ reportDate: '2026-09-01', amountSpent: '10.5', reach: '900', impressions: '800', linkClicks: '', comments: '3' });
    expect(r).toMatchObject({ value: { reach: 900, impressions: 800, linkClicks: null, comments: 3, amountSpent: '10.5000' } });
    expect((r as { warnings: string[] }).warnings[0]).toContain('Reach is higher than impressions');
    expect(checkDailyInput({ reportDate: '2026-09-01', reach: '1.5' })).toHaveProperty('errors.reach');
    expect(checkDailyInput({ reportDate: '2026-09-01', reach: '-1' })).toHaveProperty('errors.reach');
  });
});

describe('active days, pacing and alerts', () => {
  const campaign = {
    id: 'ADC-1', reference: 'PH-1', name: 'x', platformId: 'PLT-01', platformName: 'Facebook', brandId: null, brandName: '', projectId: null,
    targetCountryCode: 'PH', socialAccountId: null, socialAccountLabel: '', assignedStaffId: null, assignedStaffName: '', objective: 'Traffic',
    currency: 'PHP', budget: '30000', startDate: '2026-08-29', endDate: '2026-09-27', status: 'Active', adsUrl: '', reportingTimezone: 'Asia/Manila',
    notes: '', createdById: 'TM-1', createdByName: '', createdAt: '2026-08-28T00:00:00Z', updatedById: null, updatedByName: '', updatedAt: '',
  } satisfies Campaign;
  const history = [{ status: 'Active' as const, changedAt: '2026-08-28T00:00:00Z' }];

  it('expects a record for every active day up to yesterday, minus paused days', () => {
    expect(expectedActiveDates(campaign, history, '2026-09-06')).toHaveLength(8);
    const paused = [...history, { status: 'Paused' as const, changedAt: '2026-09-02T09:00:00Z' }, { status: 'Active' as const, changedAt: '2026-09-04T09:00:00Z' }];
    expect(expectedActiveDates(campaign, paused, '2026-09-06')).toEqual(['2026-08-29', '2026-08-30', '2026-08-31', '2026-09-01', '2026-09-04', '2026-09-05']);
  });

  it('projects end spend only from complete reporting, and states the assumption', () => {
    const p = pacing(campaign, SHEET, history, '2026-09-06');
    expect(p.projectedEndSpend!).toBeCloseTo(23432.925, 3); // 6248.78 ÷ 8 days × 30 planned days
    expect(p.projectionNote).toContain('8 complete active day');
    const gap = pacing(campaign, SHEET.filter((r) => r.reportDate !== '2026-09-02'), history, '2026-09-06');
    expect(gap.projectedEndSpend).toBeNull();
    expect(gap.projectionNote).toContain('Insufficient Data');
  });

  it('raises informational alerts for missing records and budget use', () => {
    const alerts = campaignAlerts({ ...campaign, budget: '6500' }, SHEET, history, undefined, '2026-09-08');
    expect(alerts.map((a) => a.kind)).toEqual(expect.arrayContaining(['missing-records', 'budget-near-limit']));
    expect(campaignAlerts({ ...campaign, budget: '6000' }, SHEET, history, undefined, '2026-09-06').map((a) => a.kind)).toContain('budget-exceeded');
  });
});

describe('creative images', () => {
  const png = (w: number, h: number, size = 100) => {
    const b = new Uint8Array(size);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  const jpeg = (w: number, h: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 0, 0, 0, 0, 0, 0]);
  const webpX = (w: number, h: number) => {
    const b = new Uint8Array(40);
    b.set(new TextEncoder().encode('RIFF'), 0); b.set(new TextEncoder().encode('WEBPVP8X'), 8);
    const put24 = (i: number, v: number) => { b[i] = v & 255; b[i + 1] = (v >> 8) & 255; b[i + 2] = (v >> 16) & 255; };
    put24(24, w - 1); put24(27, h - 1);
    return b;
  };

  it('reads real dimensions from PNG, JPEG and WebP headers', () => {
    expect(readImageInfo(png(1080, 1350))).toEqual({ mime: 'image/png', width: 1080, height: 1350 });
    expect(readImageInfo(jpeg(1080, 1350))).toEqual({ mime: 'image/jpeg', width: 1080, height: 1350 });
    expect(readImageInfo(webpX(1080, 1350))).toEqual({ mime: 'image/webp', width: 1080, height: 1350 });
  });

  it('accepts exactly 1080 × 1350 up to 1,000,000 bytes and explains every refusal', () => {
    expect(checkCreative('ad.png', png(1080, 1350, CREATIVE_MAX_BYTES))).toMatchObject({ width: 1080, height: 1350, sizeBytes: 1_000_000 });
    expect((checkCreative('big.png', png(1080, 1350, CREATIVE_MAX_BYTES + 1)) as { error: string }).error).toContain('1,000,001 bytes');
    expect((checkCreative('square.jpg', jpeg(1080, 1080)) as { error: string }).error).toContain('1080 × 1080 pixels');
    expect((checkCreative('fake.png', new TextEncoder().encode('<svg/>')) as { error: string }).error).toContain('not a readable');
  });

  it('keeps references to the allowed document types', () => {
    expect(checkReference('brief.pdf', new TextEncoder().encode('%PDF-1.7'))).toMatchObject({ kind: 'document' });
    expect(checkReference('deck.pptx', new Uint8Array([0x50, 0x4b, 3, 4]))).toHaveProperty('error');
    expect(checkReference('notes.txt', new TextEncoder().encode('hello'))).toHaveProperty('error');
  });
});
