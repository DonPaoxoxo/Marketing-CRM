/** Ads Monitoring campaigns: fields, validation, ownership, active days,
 *  pacing and alerts. One rule for the browser and the server. */

import { ADMIN_ROLE } from '../access';
import { hasPermission, type PermissionHolder } from '../permissions';
import { sanitizeText, sanitizeUrl } from '../sanitize';
import type { RoleName } from '../types';
import { CURRENCY_CODES, decimalToUnits, normalizeCurrency, parseAmount, unitsToDecimal, unitsToNumber, type CurrencyCode } from './money';
import { COUNT_FIELDS, METRIC_LABELS, OBJECTIVES, aggregate, computeMetrics, type CountField, type DailyRecord, type Objective } from './metrics';
import { addDaysIso, compareTrend, datesIn, todayIn, trendWindows, TREND_METRICS } from './trends';

export const CAMPAIGN_STATUSES = ['Draft', 'Scheduled', 'Active', 'Paused', 'Completed', 'Archived'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** The CRM's highest owner role. Named explicitly so no other role — however
 *  senior it sounds — is swept into "can edit everyone's ads records". */
export const SYSTEM_OWNER_ROLE: RoleName = ADMIN_ROLE;

/** Reporting timezone by target country, used when no ad-account timezone is known. */
export const COUNTRY_TIMEZONES: Record<string, string> = {
  IN: 'Asia/Kolkata', PH: 'Asia/Manila', ID: 'Asia/Jakarta', PK: 'Asia/Karachi',
};
export const TIMEZONES = ['Asia/Manila', 'Asia/Kolkata', 'Asia/Jakarta', 'Asia/Karachi', 'Asia/Ho_Chi_Minh', 'Asia/Shanghai', 'UTC'] as const;

export interface Campaign {
  id: string;
  reference: string;
  name: string;
  platformId: string;
  platformName: string;
  brandId: string | null;
  brandName: string;
  projectId: string | null;
  targetCountryCode: string;
  socialAccountId: string | null;
  socialAccountLabel: string;
  assignedStaffId: string | null;
  assignedStaffName: string;
  objective: Objective;
  currency: CurrencyCode;
  budget: string | null;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  adsUrl: string;
  reportingTimezone: string;
  notes: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedById: string | null;
  updatedByName: string;
  updatedAt: string;
}

interface Person extends PermissionHolder { id: string; role: RoleName }

/* ── Ownership ───────────────────────────────────────────────────── */

export const isSystemOwner = (p: Person | null | undefined) => p?.role === SYSTEM_OWNER_ROLE;

/** Everyone signed in may view Ads Monitoring. */
export const mayViewAds = (p: Person | null | undefined) => Boolean(p);

/** Creating a campaign needs the ordinary edit permission. */
export const mayCreateCampaign = (p: Person | null | undefined) =>
  Boolean(p && (isSystemOwner(p) || hasPermission(p, 'edit:resources')));

/** Only the person who inserted a record, or the System Owner, may change or
 *  delete it. Assignment, management and follow-ups grant nothing. */
export const mayModifyRecord = (p: Person | null | undefined, record: { createdById: string }) =>
  Boolean(p && (isSystemOwner(p) || record.createdById === p.id));

/** Adding children (daily records, creatives, references) to a campaign is its
 *  creator's or the System Owner's. */
export const mayAddToCampaign = (p: Person | null | undefined, campaign: { createdById: string }) =>
  mayModifyRecord(p, campaign);

/** An existing child record: its own creator (still within the campaign's owner
 *  circle) or the System Owner. */
export const mayModifyChild = (p: Person | null | undefined, campaign: { createdById: string }, child: { createdById: string }) =>
  Boolean(p && (isSystemOwner(p) || (child.createdById === p.id && campaign.createdById === p.id)));

/* ── Campaign input ──────────────────────────────────────────────── */

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** A reference people can type and keep: letters, digits, dash, underscore, dot. */
export const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/;

/** http(s) only; javascript:, data: and the rest are refused. */
export function checkAdsUrl(raw: unknown): { value: string } | { error: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { value: '' };
  const safe = sanitizeUrl(text, 2048);
  if (!safe || !/^https?:\/\//i.test(safe)) return { error: 'Enter a web link starting with http:// or https://.' };
  return { value: safe };
}

export interface CampaignInput {
  reference: string;
  name: string;
  platformId: string;
  brandId: string | null;
  projectId: string | null;
  targetCountryCode: string;
  socialAccountId: string | null;
  assignedStaffId: string | null;
  objective: Objective;
  currency: CurrencyCode;
  budget: string | null;
  startDate: string;
  endDate: string;
  status: CampaignStatus;
  adsUrl: string;
  reportingTimezone: string;
  notes: string;
}

export type FieldErrors = Partial<Record<keyof CampaignInput, string>>;

/** Normalise and check a campaign form or API body. `partial` for edits. */
export function checkCampaignInput(body: Record<string, unknown>, partial = false): { value: Partial<CampaignInput> } | { errors: FieldErrors } {
  const errors: FieldErrors = {};
  const value: Partial<CampaignInput> = {};
  const has = (k: keyof CampaignInput) => body[k] !== undefined;
  const need = (k: keyof CampaignInput) => !partial || has(k);

  if (need('reference')) {
    const ref = String(body.reference ?? '').trim();
    if (!REFERENCE_PATTERN.test(ref)) errors.reference = 'Use 2–40 letters, digits, dots, dashes or underscores, e.g. PH-FB-2026-09.';
    else value.reference = ref;
  }
  if (need('name')) {
    const name = sanitizeText(body.name, 160);
    if (!name) errors.name = 'A campaign name is required.';
    else value.name = name;
  }
  if (need('platformId')) {
    const platform = String(body.platformId ?? '').trim();
    if (!platform) errors.platformId = 'Choose a platform.';
    else value.platformId = platform;
  }
  if (has('brandId') || !partial) value.brandId = String(body.brandId ?? '').trim() || null;
  if (has('projectId') || !partial) value.projectId = String(body.projectId ?? '').trim() || null;
  if (has('socialAccountId') || !partial) value.socialAccountId = String(body.socialAccountId ?? '').trim() || null;
  if (has('assignedStaffId') || !partial) value.assignedStaffId = String(body.assignedStaffId ?? '').trim() || null;
  if (need('targetCountryCode')) {
    const code = String(body.targetCountryCode ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) errors.targetCountryCode = 'Choose a target country.';
    else value.targetCountryCode = code;
  }
  if (need('objective')) {
    const objective = OBJECTIVES.find((o) => o.toLowerCase() === String(body.objective ?? '').trim().toLowerCase());
    if (!objective) errors.objective = `Use one of: ${OBJECTIVES.join(', ')}.`;
    else value.objective = objective;
  }
  if (need('currency')) {
    const currency = normalizeCurrency(body.currency);
    if (!currency) errors.currency = `Use one of: ${CURRENCY_CODES.join(', ')} (RMB is accepted as CNY).`;
    else value.currency = currency;
  }
  if (has('budget') || !partial) {
    const parsed = parseAmount(body.budget);
    if (parsed && 'error' in parsed) errors.budget = parsed.error;
    else value.budget = parsed ? unitsToDecimal(parsed.units) : null;
  }
  if (need('startDate')) {
    if (!isIsoDate(body.startDate)) errors.startDate = 'Use a date in YYYY-MM-DD.';
    else value.startDate = body.startDate;
  }
  if (need('endDate')) {
    if (!isIsoDate(body.endDate)) errors.endDate = 'Use a date in YYYY-MM-DD.';
    else value.endDate = body.endDate;
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) errors.endDate = 'The end date cannot be before the start date.';
  if (need('status')) {
    const status = CAMPAIGN_STATUSES.find((s) => s.toLowerCase() === String(body.status ?? 'Draft').trim().toLowerCase());
    if (!status) errors.status = `Use one of: ${CAMPAIGN_STATUSES.join(', ')}.`;
    else value.status = status;
  }
  if (has('adsUrl') || !partial) {
    const url = checkAdsUrl(body.adsUrl);
    if ('error' in url) errors.adsUrl = url.error;
    else value.adsUrl = url.value;
  }
  if (has('reportingTimezone') || !partial) {
    const tz = String(body.reportingTimezone ?? '').trim() || COUNTRY_TIMEZONES[value.targetCountryCode ?? ''] || 'UTC';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      value.reportingTimezone = tz;
    } catch {
      errors.reportingTimezone = 'Unknown timezone.';
    }
  }
  if (has('notes') || !partial) value.notes = sanitizeText(body.notes, 4000);
  return Object.keys(errors).length ? { errors } : { value };
}

/* ── Daily record input ──────────────────────────────────────────── */

export interface DailyInput extends Partial<Record<CountField, number | null>> {
  reportDate: string;
  amountSpent: string | null;
  notes: string;
}

/** A count: blank means not available (null), otherwise a whole number ≥ 0. */
export function readCount(raw: unknown): { value: number | null } | { error: string } {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { value: null };
  const text = String(raw).trim();
  if (/[,\s]/.test(text)) return { error: 'Write the number without separators.' };
  const n = Number(text);
  if (!Number.isFinite(n)) return { error: 'Not a number.' };
  if (n < 0) return { error: 'Cannot be negative.' };
  if (!Number.isInteger(n)) return { error: 'Must be a whole number.' };
  if (n > 9_007_199_254_740_991) return { error: 'Too large.' };
  return { value: n };
}

export function checkDailyInput(body: Record<string, unknown>, opts: { partial?: boolean } = {}):
  { value: Partial<DailyInput>; warnings: string[] } | { errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const value: Partial<DailyInput> = {};
  if (!opts.partial || body.reportDate !== undefined) {
    if (!isIsoDate(body.reportDate)) errors.reportDate = 'Use a date in YYYY-MM-DD.';
    else value.reportDate = body.reportDate;
  }
  if (!opts.partial || body.amountSpent !== undefined) {
    const spent = parseAmount(body.amountSpent);
    if (spent && 'error' in spent) errors.amountSpent = spent.error;
    else value.amountSpent = spent ? unitsToDecimal(spent.units) : null;
  }
  for (const field of COUNT_FIELDS) {
    if (opts.partial && body[field] === undefined) continue;
    const read = readCount(body[field]);
    if ('error' in read) errors[field] = `${METRIC_LABELS[field]}: ${read.error}`;
    else value[field] = read.value;
  }
  if (!opts.partial || body.notes !== undefined) value.notes = sanitizeText(body.notes, 2000);
  if (Object.keys(errors).length) return { errors };
  return { value, warnings: dailyWarnings(value) };
}

/** Relationships that are unusual, not impossible. Warnings only. */
export function dailyWarnings(v: Partial<DailyInput>): string[] {
  const w: string[] = [];
  const gt = (a: CountField, b: CountField) => v[a] !== null && v[a] !== undefined && v[b] !== null && v[b] !== undefined && (v[a] as number) > (v[b] as number);
  if (gt('reach', 'impressions')) w.push('Reach is higher than impressions — usually reach is at most impressions. Check the export.');
  if (gt('linkClicks', 'clicksAll')) w.push('Link clicks are higher than all clicks — check the columns were not swapped.');
  if (gt('landingPageViews', 'linkClicks')) w.push('Landing-page views are higher than link clicks — possible with some tracking setups; check the export.');
  const spent = decimalToUnits(v.amountSpent ?? null);
  const anyResult = COUNT_FIELDS.some((f) => (v[f] ?? 0) > 0);
  if (spent !== null && spent > 0n && !anyResult) w.push('Spend is recorded with no results — check whether the metrics were left blank by mistake.');
  return w;
}

/* ── Active days, pacing, alerts ─────────────────────────────────── */

export interface StatusChange { status: CampaignStatus; changedAt: string }

export interface AlertSettings {
  stablePct: number;
  budgetWarningPct: number;
  endingSoonDays: number;
  risingCostPct: number;
  decliningEngagementPct: number;
}
export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  stablePct: 5, budgetWarningPct: 80, endingSoonDays: 7, risingCostPct: 15, decliningEngagementPct: 15,
};

/** Dates the campaign was expected to run and report: from the start to the
 *  earlier of the end date and yesterday (in its timezone), excluding days it
 *  was paused, archived or not yet active per its status history. */
export function expectedActiveDates(c: Pick<Campaign, 'startDate' | 'endDate' | 'status' | 'reportingTimezone' | 'createdAt'>, history: readonly StatusChange[], today = todayIn(c.reportingTimezone)): string[] {
  const lastComplete = addDaysIso(today, -1);
  const end = c.endDate < lastComplete ? c.endDate : lastComplete;
  if (end < c.startDate) return [];
  const ordered = [...history].sort((a, b) => a.changedAt.localeCompare(b.changedAt));
  const statusOn = (date: string): CampaignStatus => {
    // The status in force at the end of that day.
    let status: CampaignStatus | null = null;
    for (const h of ordered) {
      if (h.changedAt.slice(0, 10) <= date) status = h.status;
      else break;
    }
    return status ?? (ordered[0]?.status ?? c.status);
  };
  return datesIn({ from: c.startDate, to: end }).filter((d) => ['Active', 'Completed'].includes(statusOn(d)));
}

export interface Pacing {
  spent: bigint | null;
  remaining: bigint | null;
  utilizationPct: number | null;
  plannedDays: number;
  elapsedDays: number;
  expectedSpentByNow: number | null;
  projectedEndSpend: number | null;
  projectionNote: string;
}

export function pacing(c: Campaign, records: readonly DailyRecord[], history: readonly StatusChange[], today = todayIn(c.reportingTimezone)): Pacing {
  const m = computeMetrics(aggregate(records), c.budget);
  const plannedDays = datesIn({ from: c.startDate, to: c.endDate }).length;
  const expected = expectedActiveDates(c, history, today);
  const recorded = new Set(records.filter((r) => r.amountSpent !== null).map((r) => r.reportDate));
  const missing = expected.filter((d) => !recorded.has(d));
  const budget = decimalToUnits(c.budget);
  const elapsedDays = expected.length;

  let projectedEndSpend: number | null = null;
  let projectionNote: string;
  if (budget === null) projectionNote = 'No budget set, so no pacing.';
  else if (elapsedDays === 0) projectionNote = 'Insufficient Data: no complete active days yet.';
  else if (missing.length) projectionNote = `Insufficient Data: ${missing.length} expected daily record(s) are missing, so a projection would be misleading.`;
  else {
    const spentOnActive = records.filter((r) => expected.includes(r.reportDate)).reduce((s, r) => s + (decimalToUnits(r.amountSpent) ?? 0n), 0n);
    const avg = unitsToNumber(spentOnActive) / elapsedDays;
    projectedEndSpend = avg * plannedDays;
    projectionNote = `Assumes the average daily spend of the ${elapsedDays} complete active day(s) continues for all ${plannedDays} planned days.`;
  }
  return {
    spent: m.spend,
    remaining: m.budgetRemaining,
    utilizationPct: m.budgetUtilization,
    plannedDays,
    elapsedDays,
    expectedSpentByNow: budget === null ? null : unitsToNumber(budget) * Math.min(1, elapsedDays / Math.max(1, plannedDays)),
    projectedEndSpend,
    projectionNote,
  };
}

export type AlertKind = 'missing-records' | 'budget-near-limit' | 'budget-exceeded' | 'rising-cost-per-interaction' | 'declining-engagement' | 'ending-soon';
export interface CampaignAlert { kind: AlertKind; message: string; severity: 'warning' | 'critical' | 'info' }

/** Informational alerts. Nothing here changes a campaign or its spend. */
export function campaignAlerts(c: Campaign, records: readonly DailyRecord[], history: readonly StatusChange[], settings: AlertSettings = DEFAULT_ALERT_SETTINGS, today = todayIn(c.reportingTimezone)): CampaignAlert[] {
  const alerts: CampaignAlert[] = [];
  if (c.status === 'Archived' || c.status === 'Draft') return alerts;
  const recorded = new Set(records.map((r) => r.reportDate));
  const missing = expectedActiveDates(c, history, today).filter((d) => !recorded.has(d));
  if (missing.length) {
    alerts.push({ kind: 'missing-records', severity: 'warning', message: `${missing.length} expected daily record(s) missing${missing.length <= 3 ? `: ${missing.join(', ')}` : ` (latest ${missing[missing.length - 1]})`}.` });
  }
  const m = computeMetrics(aggregate(records), c.budget);
  if (m.budgetUtilization !== null) {
    if (m.budgetUtilization > 100) alerts.push({ kind: 'budget-exceeded', severity: 'critical', message: `Budget exceeded: ${m.budgetUtilization.toFixed(1)}% used.` });
    else if (m.budgetUtilization >= settings.budgetWarningPct) alerts.push({ kind: 'budget-near-limit', severity: 'warning', message: `Budget ${m.budgetUtilization.toFixed(1)}% used (warning at ${settings.budgetWarningPct}%).` });
  }
  const windows = trendWindows('last7', today);
  if (!('error' in windows)) {
    const cpi = compareTrend(records, TREND_METRICS.find((t) => t.key === 'costPerInteraction')!, windows, settings.stablePct);
    if (cpi.status === 'ok' && cpi.changePct !== null && cpi.changePct >= settings.risingCostPct) {
      alerts.push({ kind: 'rising-cost-per-interaction', severity: 'warning', message: `Cost per interaction rose ${cpi.changePct.toFixed(1)}% (last 7 complete days vs the 7 before).` });
    }
    const er = compareTrend(records, TREND_METRICS.find((t) => t.key === 'engagementRate')!, windows, settings.stablePct);
    if (er.status === 'ok' && er.changePct !== null && er.changePct <= -settings.decliningEngagementPct) {
      alerts.push({ kind: 'declining-engagement', severity: 'warning', message: `Engagement rate fell ${Math.abs(er.changePct).toFixed(1)}% (last 7 complete days vs the 7 before).` });
    }
  }
  const daysLeft = datesIn({ from: today, to: c.endDate }).length;
  if (['Active', 'Scheduled'].includes(c.status) && daysLeft > 0 && daysLeft <= settings.endingSoonDays) {
    alerts.push({ kind: 'ending-soon', severity: 'info', message: `Ends ${c.endDate} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left).` });
  }
  return alerts;
}
