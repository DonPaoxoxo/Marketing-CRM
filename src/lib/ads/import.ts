/** Excel import for Ads Monitoring: the template and the rule that decides what
 *  each row would do. Pure — the server runs it twice (preview, then again inside
 *  the commit transaction against fresh data) and the browser shows its result. */

import { mapHeaders, cellText, type SheetColumn } from '../sheet';
import type { RoleName } from '../types';
import { checkCampaignInput, checkDailyInput, mayAddToCampaign, mayCreateCampaign, mayModifyChild, type CampaignInput, type DailyInput } from './campaign';
import { COUNT_FIELDS, OBJECTIVES } from './metrics';
import { CURRENCIES, normalizeCurrency } from './money';

export type ImportKey =
  | 'campaignReference' | 'campaignName' | 'platform' | 'brandReference' | 'socialAccountReference' | 'targetCountry'
  | 'objective' | 'currency' | 'budget' | 'startDate' | 'endDate' | 'adsUrl' | 'reportDate' | 'amountSpent'
  | 'reach' | 'impressions' | 'clicksAll' | 'linkClicks' | 'landingPageViews' | 'reactions' | 'comments' | 'shares'
  | 'saves' | 'newFollowers' | 'appInstalls' | 'platformPostEngagements' | 'notes';

type Requirement = 'always' | 'new-campaign' | 'optional';

export const IMPORT_COLUMNS: readonly (SheetColumn<ImportKey> & { requirement: Requirement; example: string | number })[] = [
  { key: 'campaignReference', header: 'Campaign Reference', required: true, requirement: 'always', aliases: ['reference', 'campaign ref'], help: 'Your stable campaign code, e.g. PH-FB-2026-09. Rows with the same reference belong to one campaign.', example: 'EXAMPLE-DO-NOT-IMPORT' },
  { key: 'campaignName', header: 'Campaign Name', required: false, requirement: 'new-campaign', aliases: ['campaign'], help: 'Required when the reference is new.', example: 'September Reels Boost' },
  { key: 'platform', header: 'Platform', required: false, requirement: 'new-campaign', aliases: [], help: 'A platform name configured in the CRM, e.g. Facebook.', example: 'Facebook' },
  { key: 'brandReference', header: 'Brand Reference', required: false, requirement: 'optional', aliases: ['brand'], help: 'An existing brand ID (BRD-…) or exact brand name. Unknown brands are rejected, never created.', example: '' },
  { key: 'socialAccountReference', header: 'Social Account Reference', required: false, requirement: 'optional', aliases: ['social account', 'account'], help: 'An existing account ID (ACC-…) or its profile URL. Unknown accounts are rejected, never created.', example: '' },
  { key: 'targetCountry', header: 'Target Country', required: false, requirement: 'new-campaign', aliases: ['country'], help: 'Country code or name, e.g. PH or Philippines.', example: 'PH' },
  { key: 'objective', header: 'Objective', required: false, requirement: 'new-campaign', aliases: [], help: OBJECTIVES.join(', '), example: 'Engagement' },
  { key: 'currency', header: 'Currency', required: false, requirement: 'new-campaign', aliases: [], help: 'INR, PHP, USD, CNY (RMB accepted) or VND. One currency per campaign.', example: 'PHP' },
  { key: 'budget', header: 'Budget', required: false, requirement: 'optional', aliases: ['campaign budget'], help: 'Number only, no symbol or separators, e.g. 30000.', example: 30000 },
  { key: 'startDate', header: 'Start Date', required: false, requirement: 'new-campaign', aliases: [], help: 'YYYY-MM-DD.', example: '2026-08-29' },
  { key: 'endDate', header: 'End Date', required: false, requirement: 'new-campaign', aliases: [], help: 'YYYY-MM-DD.', example: '2026-09-27' },
  { key: 'adsUrl', header: 'Ads URL', required: false, requirement: 'optional', aliases: ['ads library url', 'ad url'], help: 'https:// link to the ad listing (Ads Library). Not verified with the platform.', example: 'https://www.facebook.com/ads/library/?id=0' },
  { key: 'reportDate', header: 'Report Date', required: true, requirement: 'always', aliases: ['date'], help: 'The day these daily values are for, YYYY-MM-DD, in the campaign reporting timezone.', example: '2026-08-29' },
  { key: 'amountSpent', header: 'Amount Spent', required: false, requirement: 'optional', aliases: ['spend', 'amount spent (php)'], help: 'That day only — not a running total. Number only.', example: 246.58 },
  { key: 'reach', header: 'Reach', required: false, requirement: 'optional', aliases: [], help: 'That day’s reach. Whole number.', example: 1749 },
  { key: 'impressions', header: 'Impressions', required: false, requirement: 'optional', aliases: [], help: 'Whole number.', example: 2602 },
  { key: 'clicksAll', header: 'Clicks All', required: false, requirement: 'optional', aliases: ['clicks (all)', 'clicks'], help: 'Whole number.', example: 351 },
  { key: 'linkClicks', header: 'Link Clicks', required: false, requirement: 'optional', aliases: [], help: 'Whole number.', example: 331 },
  { key: 'landingPageViews', header: 'Landing Page Views', required: false, requirement: 'optional', aliases: ['lpv'], help: 'Whole number.', example: 27 },
  { key: 'reactions', header: 'Reactions', required: false, requirement: 'optional', aliases: [], help: 'Whole number.', example: 40 },
  { key: 'comments', header: 'Comments', required: false, requirement: 'optional', aliases: [], help: 'Whole number.', example: 6 },
  { key: 'shares', header: 'Shares', required: false, requirement: 'optional', aliases: [], help: 'Whole number.', example: 3 },
  { key: 'saves', header: 'Saves', required: false, requirement: 'optional', aliases: [], help: 'Whole number.', example: 2 },
  { key: 'newFollowers', header: 'New Followers', required: false, requirement: 'optional', aliases: ['followers'], help: 'Whole number.', example: 12 },
  { key: 'appInstalls', header: 'App Installs', required: false, requirement: 'optional', aliases: ['installs'], help: 'Whole number, when relevant.', example: '' },
  { key: 'platformPostEngagements', header: 'Platform Post Engagements', required: false, requirement: 'optional', aliases: ['post engagements'], help: 'The platform’s own figure, kept separate from our calculated content interactions.', example: '' },
  { key: 'notes', header: 'Notes', required: false, requirement: 'optional', aliases: [], help: 'Anything worth knowing about that day.', example: 'Example row — skipped on import.' },
];

export const EXAMPLE_REFERENCE = 'EXAMPLE-DO-NOT-IMPORT';
export const IMPORT_LIMITS = { maxRows: 5000, maxFileBytes: 5 * 1024 * 1024 } as const;
export { CURRENCIES, OBJECTIVES };

/* ── Context the rule needs ──────────────────────────────────────── */

export interface ExistingCampaign {
  id: string; reference: string; createdById: string; name: string; platformId: string; brandId: string | null;
  socialAccountId: string | null; targetCountryCode: string; objective: string; currency: string; budget: string | null;
  startDate: string; endDate: string; adsUrl: string;
}
export interface ExistingEntry { campaignId: string; reportDate: string; id: string; createdById: string }

export interface ImportContext {
  user: { id: string; role: RoleName };
  mode: 'skip' | 'update';
  includeExample?: boolean;
  campaigns: ExistingCampaign[];
  entries: ExistingEntry[];
  platforms: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  accounts: { id: string; profileUrlKey: string }[];
  countries: { code: string; name: string }[];
  urlKey: (url: string) => string;
}

export type RowAction = 'create-campaign' | 'create-entry' | 'update-entry' | 'skip' | 'reject';

export interface AnalysedRow {
  rowNumber: number;
  reference: string;
  reportDate: string;
  action: RowAction;
  errors: string[];
  warnings: string[];
  /** Set when the row would write. */
  campaign?: Partial<CampaignInput> & { existingId?: string };
  entry?: Partial<DailyInput>;
  existingEntryId?: string;
}

export interface ImportAnalysis {
  missingColumns: string[];
  tooManyRows: boolean;
  rows: AnalysedRow[];
  summary: Record<'campaignsToCreate' | 'entriesToCreate' | 'entriesToUpdate' | 'skipped' | 'rejected', number>;
}

const SETUP_KEYS: [ImportKey, keyof CampaignInput][] = [
  ['campaignName', 'name'], ['platform', 'platformId'], ['brandReference', 'brandId'], ['socialAccountReference', 'socialAccountId'],
  ['targetCountry', 'targetCountryCode'], ['objective', 'objective'], ['currency', 'currency'], ['budget', 'budget'],
  ['startDate', 'startDate'], ['endDate', 'endDate'], ['adsUrl', 'adsUrl'],
];

/** Walk the sheet and decide every row. */
export function analyseImport(cells: readonly (readonly unknown[])[], ctx: ImportContext): ImportAnalysis {
  const headerIndex = cells.findIndex((row) => row.some((c) => cellText(c) !== ''));
  const header = headerIndex === -1 ? [] : cells[headerIndex];
  const mapping = mapHeaders(IMPORT_COLUMNS, header);
  const summary = { campaignsToCreate: 0, entriesToCreate: 0, entriesToUpdate: 0, skipped: 0, rejected: 0 };
  if (mapping.missing.length) return { missingColumns: mapping.missing.map((c) => c.header), tooManyRows: false, rows: [], summary };

  const body = cells.slice(headerIndex + 1).map((row, i) => ({ row, rowNumber: headerIndex + 2 + i }))
    .filter(({ row }) => row.some((c) => cellText(c) !== ''));
  if (body.length > IMPORT_LIMITS.maxRows) return { missingColumns: [], tooManyRows: true, rows: [], summary };

  const byRef = new Map(ctx.campaigns.map((c) => [c.reference.toLowerCase(), c]));
  const entryKey = (campaignId: string, date: string) => `${campaignId}|${date}`;
  const entries = new Map(ctx.entries.map((e) => [entryKey(e.campaignId, e.reportDate), e]));
  const newCampaignSetup = new Map<string, { rowNumber: number; setup: Partial<CampaignInput> }>();
  const seenDates = new Set<string>();

  const rows: AnalysedRow[] = body.map(({ row, rowNumber }) => {
    const raw = (key: ImportKey) => {
      const i = mapping.columns[key];
      return i === undefined ? '' : cellText(row[i]);
    };
    const reference = raw('campaignReference');
    const reportDate = raw('reportDate');
    const errors: string[] = [];
    const warnings: string[] = [];
    const result = (action: RowAction, extra: Partial<AnalysedRow> = {}): AnalysedRow => ({ rowNumber, reference, reportDate, action, errors, warnings, ...extra });

    if (reference.toUpperCase() === EXAMPLE_REFERENCE && !ctx.includeExample) {
      warnings.push('Example row from the template — skipped.');
      return result('skip');
    }

    // Resolve references to ids; unknown ones are errors, never created.
    const resolved: Record<string, unknown> = {};
    const platformText = raw('platform');
    if (platformText) {
      const p = ctx.platforms.find((x) => x.name.toLowerCase() === platformText.toLowerCase() || x.id.toLowerCase() === platformText.toLowerCase());
      if (p) resolved.platformId = p.id; else errors.push(`Platform "${platformText}" is not configured in the CRM.`);
    }
    const brandText = raw('brandReference');
    if (brandText) {
      const b = ctx.brands.find((x) => x.id.toLowerCase() === brandText.toLowerCase() || x.name.toLowerCase() === brandText.toLowerCase());
      if (b) resolved.brandId = b.id; else errors.push(`Brand "${brandText}" does not exist. Brands are never created by an import.`);
    }
    const accountText = raw('socialAccountReference');
    if (accountText) {
      const key = ctx.urlKey(accountText);
      const a = ctx.accounts.find((x) => x.id.toLowerCase() === accountText.toLowerCase() || (key && x.profileUrlKey === key));
      if (a) resolved.socialAccountId = a.id; else errors.push(`Social account "${accountText}" does not exist. Accounts are never created by an import.`);
    }
    const countryText = raw('targetCountry');
    if (countryText) {
      const c = ctx.countries.find((x) => x.code.toLowerCase() === countryText.toLowerCase() || x.name.toLowerCase() === countryText.toLowerCase());
      if (c) resolved.targetCountryCode = c.code; else errors.push(`Target country "${countryText}" is not one of this workspace's countries.`);
    }
    const currencyText = raw('currency');
    if (currencyText) {
      const cur = normalizeCurrency(currencyText);
      if (cur) resolved.currency = cur; else errors.push(`Currency "${currencyText}" is not supported. Use INR, PHP, USD, CNY (RMB) or VND.`);
    }

    const dailyBody: Record<string, unknown> = { reportDate, amountSpent: raw('amountSpent'), notes: raw('notes') };
    for (const f of COUNT_FIELDS) dailyBody[f] = raw(f);
    const daily = checkDailyInput(dailyBody);
    if ('errors' in daily) errors.push(...Object.values(daily.errors));
    else warnings.push(...daily.warnings);

    if (!reference) errors.push('Campaign Reference is required.');
    const existing = reference ? byRef.get(reference.toLowerCase()) : undefined;

    // Setup columns supplied on this row (blank ones are ignored).
    const setupBody: Record<string, unknown> = {};
    for (const [key, field] of SETUP_KEYS) {
      const text = raw(key);
      if (!text) continue;
      setupBody[field] = resolved[field] ?? text;
    }

    let campaign: AnalysedRow['campaign'];
    if (existing) {
      if (!mayAddToCampaign(ctx.user, existing)) errors.push(`Campaign ${existing.reference} belongs to someone else. Only its creator or the System Owner can add records to it.`);
      // Setup values on the row must agree with the saved campaign; nothing is overwritten.
      const checked = checkCampaignInput(setupBody, true);
      if ('errors' in checked) errors.push(...Object.values(checked.errors));
      else {
        const conflicts = (Object.entries(checked.value) as [keyof CampaignInput, unknown][])
          .filter(([field, v]) => field in existing && v !== null && v !== '' && String(v) !== String((existing as unknown as Record<string, unknown>)[field] ?? ''))
          .filter(([field, v]) => !(field === 'budget' && Number(v) === Number(existing.budget)));
        if (conflicts.length) errors.push(`Campaign setup differs from the saved campaign (${conflicts.map(([f]) => f).join(', ')}). Campaign details are never changed by an import — correct the sheet or edit the campaign.`);
      }
      campaign = { existingId: existing.id };
    } else if (reference && !errors.length) {
      if (!mayCreateCampaign(ctx.user)) errors.push('Your role cannot create campaigns.');
      const checked = checkCampaignInput({ ...setupBody, reference, status: 'Active' });
      if ('errors' in checked) {
        errors.push(...Object.entries(checked.errors).map(([f, m]) => `New campaign ${f}: ${m}`));
      } else {
        const prior = newCampaignSetup.get(reference.toLowerCase());
        if (prior) {
          const conflicts = (Object.keys(checked.value) as (keyof CampaignInput)[])
            .filter((f) => f !== 'status' && setupBody[f] !== undefined && String(checked.value[f] ?? '') !== String(prior.setup[f] ?? ''));
          if (conflicts.length) errors.push(`Conflicts with row ${prior.rowNumber} for the same new campaign (${conflicts.join(', ')}). Use identical campaign details on every row.`);
          campaign = { ...prior.setup };
        } else {
          newCampaignSetup.set(reference.toLowerCase(), { rowNumber, setup: checked.value });
          campaign = { ...checked.value };
        }
      }
    }

    if (campaign && !('errors' in daily)) {
      const campaignRef = campaign.existingId ?? `new:${reference.toLowerCase()}`;
      const dateKey = entryKey(campaignRef, daily.value.reportDate!);
      const endDate = campaign.existingId ? existing?.endDate : campaign.endDate;
      const startDate = campaign.existingId ? existing?.startDate : campaign.startDate;
      if (startDate && endDate && (daily.value.reportDate! < startDate || daily.value.reportDate! > endDate)) {
        warnings.push(`Report date is outside the campaign dates (${startDate} to ${endDate}).`);
      }
      if (seenDates.has(dateKey)) errors.push(`Duplicate: another row in this file has ${reference} on ${daily.value.reportDate}.`);
      seenDates.add(dateKey);
      const existingEntry = campaign.existingId ? entries.get(dateKey) : undefined;
      if (!errors.length && existingEntry) {
        if (ctx.mode === 'skip') {
          warnings.push(`A record for ${daily.value.reportDate} already exists — skipped (choose "update existing" to replace its values).`);
          return result('skip', { existingEntryId: existingEntry.id });
        }
        if (!mayModifyChild(ctx.user, existing!, existingEntry)) errors.push('The existing daily record was entered by someone else; only its creator or the System Owner can update it.');
        else {
          // Blank cells keep the saved values: only filled cells are applied.
          const filled = Object.fromEntries(Object.entries(daily.value).filter(([k, v]) => v !== null && v !== '' && (k !== 'notes' || v)));
          return result('update-entry', { campaign, entry: filled, existingEntryId: existingEntry.id });
        }
      }
    }

    if (errors.length || !campaign || 'errors' in daily) return result('reject');
    const action: RowAction = campaign.existingId ? 'create-entry' : newCampaignSetup.get(reference.toLowerCase())?.rowNumber === rowNumber ? 'create-campaign' : 'create-entry';
    return result(action, { campaign, entry: daily.value });
  });

  // A new campaign whose first row was rejected cannot receive later rows.
  const createdRefs = new Set(rows.filter((r) => r.action === 'create-campaign').map((r) => r.reference.toLowerCase()));
  for (const r of rows) {
    if (r.action === 'create-entry' && !r.campaign?.existingId && !createdRefs.has(r.reference.toLowerCase())) {
      r.action = 'reject';
      r.errors.push('The first row for this new campaign was rejected, so this row cannot be added.');
    }
  }

  for (const r of rows) {
    if (r.action === 'create-campaign') { summary.campaignsToCreate++; summary.entriesToCreate++; }
    else if (r.action === 'create-entry') summary.entriesToCreate++;
    else if (r.action === 'update-entry') summary.entriesToUpdate++;
    else if (r.action === 'skip') summary.skipped++;
    else summary.rejected++;
  }
  return { missingColumns: [], tooManyRows: false, rows, summary };
}

/** Rows for the downloadable error report. */
export function errorReportRows(analysis: ImportAnalysis): string[][] {
  return [
    ['Row', 'Campaign Reference', 'Report Date', 'Result', 'Errors', 'Warnings'],
    ...analysis.rows.filter((r) => r.errors.length || r.warnings.length)
      .map((r) => [String(r.rowNumber), r.reference, r.reportDate, r.action, r.errors.join(' | '), r.warnings.join(' | ')]),
  ];
}
