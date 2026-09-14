import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, CheckCircle2, Download, ExternalLink, FileText, ImagePlus, Info, Paperclip, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader, SectionCard, EmptyState, ErrorState, DefinitionList } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { ConfirmWithReason, FilterSelect } from '@/components/common/controls';
import { TrendLineChart } from '@/components/charts/TrendLineChart';
import { Tabs, TabsContent, TabsList, TabsTrigger, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input, Label, NativeSelect, Skeleton, Textarea } from '@/components/ui/primitives';
import { ApiError, useCrmData } from '@/hooks/useData';
import { expectedActiveDates, type Campaign } from '@/lib/ads/campaign';
import { REFERENCE_ACCEPT, checkReference, formatBytes } from '@/lib/ads/files';
import { COUNT_FIELDS, METRIC_LABELS, OBJECTIVE_METRICS, REACH_NOTE, aggregate, computeMetrics, primaryResult, type Metrics } from '@/lib/ads/metrics';
import { decimalToUnits, formatMoney } from '@/lib/ads/money';
import { TREND_METRICS, addDaysIso, compareTrend, trendWindows, type TrendMode } from '@/lib/ads/trends';
import { formatDate } from '@/lib/utils';
import {
  creativeUrl, referenceUrl, useCampaign, useDeleteCampaign, useDeleteFollowUp, useDeleteRecord, useRemoveCreative, useRemoveReference,
  useRestoreCampaign, useSaveCampaign, useSaveFollowUp, useUpdateCreative, useUploadReference, type CampaignDetail, type Creative, type SavedRecord,
} from '@/features/ads/api';
import { CampaignFormDialog } from '@/features/ads/CampaignFormDialog';
import { RecordDialog } from '@/features/ads/RecordDialog';
import { AdsLibraryLink, CreativeUploadDialog, CreativeViewer } from '@/features/ads/Creatives';
import { cumulativeSpendSeries, metricSeries, type Granularity } from '@/features/ads/charts';
import { CampaignStatusBadge, TrendBadge, fmtCost, fmtCount, fmtMetric, fmtPct } from '@/features/ads/format';

const METRIC_ROWS: { key: keyof Metrics; label: string; kind: 'money' | 'count' | 'percent' }[] = [
  { key: 'spend', label: 'Total spend', kind: 'money' },
  { key: 'reachSum', label: 'Sum of daily reach', kind: 'count' },
  { key: 'impressions', label: 'Total impressions', kind: 'count' },
  { key: 'clicksAll', label: 'Total clicks (all)', kind: 'count' },
  { key: 'linkClicks', label: 'Total link clicks', kind: 'count' },
  { key: 'landingPageViews', label: 'Total landing-page views', kind: 'count' },
  { key: 'interactions', label: 'Content interactions', kind: 'count' },
  { key: 'platformPostEngagements', label: 'Platform-reported post engagements (separate)', kind: 'count' },
  { key: 'linkCtr', label: 'Link CTR', kind: 'percent' },
  { key: 'allClickCtr', label: 'All-click CTR', kind: 'percent' },
  { key: 'costPerLinkClick', label: 'Cost per link click', kind: 'money' },
  { key: 'allClickCpc', label: 'All-click CPC', kind: 'money' },
  { key: 'cpm', label: 'CPM', kind: 'money' },
  { key: 'engagementRate', label: 'Engagement rate (by summed daily reach)', kind: 'percent' },
  { key: 'costPerInteraction', label: 'Cost per interaction', kind: 'money' },
  { key: 'landingPageArrivalRate', label: 'Landing-page arrival rate', kind: 'percent' },
  { key: 'costPerLandingPageView', label: 'Cost per landing-page view', kind: 'money' },
  { key: 'newFollowers', label: 'New followers', kind: 'count' },
  { key: 'costPerFollower', label: 'Cost per follower', kind: 'money' },
  { key: 'appInstalls', label: 'App installs', kind: 'count' },
  { key: 'costPerInstall', label: 'Cost per install', kind: 'money' },
  { key: 'averageDailySpend', label: 'Average daily spend (recorded days)', kind: 'money' },
];

function showMetric(m: Metrics, key: keyof Metrics, kind: 'money' | 'count' | 'percent', c: Campaign) {
  const v = m[key];
  if (typeof v === 'bigint') return formatMoney(v, c.currency);
  if (typeof v !== 'number') return 'N/A';
  return fmtMetric(kind, v, c.currency);
}

/* ── Summary ──────────────────────────────────────────────────── */

function SummaryTab({ d }: { d: CampaignDetail }) {
  const c = d.campaign;
  const m = computeMetrics(aggregate(d.records), c.budget);
  const result = primaryResult(c.objective, m);
  const [mode, setMode] = React.useState<TrendMode>('last7');
  const [custom, setCustom] = React.useState({ from: addDaysIso(d.today, -7), to: addDaysIso(d.today, -1) });
  const windows = trendWindows(mode, d.today, custom);
  const relevant = new Set<keyof Metrics>(['spend', ...OBJECTIVE_METRICS[c.objective]]);
  const incompleteInteractions = m.interactions !== null && !m.interactionsComplete;

  return (
    <div className="flex flex-col gap-4">
      {d.alerts.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Alerts">
          {d.alerts.map((a) => (
            <li key={a.kind} className={`rounded-md border px-3 py-2 text-[13px] ${a.severity === 'critical' ? 'border-danger/40 bg-danger-bg/40' : a.severity === 'warning' ? 'border-warning/40 bg-warning-bg/40' : 'border-border bg-surface'}`}>{a.message}</li>
          ))}
          <li className="text-[11px] text-muted-foreground">Alerts are informational and never change the campaign or its spend.</li>
        </ul>
      )}

      <KpiGrid className="lg:grid-cols-4">
        <KpiCard label="Spend" value={formatMoney(m.spend, c.currency)} hint={`${m.spend === null ? 0 : d.records.filter((r) => r.amountSpent !== null).length} day(s) with spend recorded`} />
        <KpiCard label={result.label} value={fmtCount(result.value)} hint={incompleteInteractions ? 'Some days are missing reactions, comments, shares or saves' : undefined} />
        <KpiCard label={result.costLabel} value={fmtCost(result.cost, c.currency)} />
        <KpiCard label="Budget used" value={fmtPct(m.budgetUtilization, 1)} hint={c.budget ? `Remaining ${formatMoney(m.budgetRemaining, c.currency)} of ${formatMoney(decimalToUnits(c.budget), c.currency)}` : 'No budget set'} tone={m.budgetUtilization !== null && m.budgetUtilization > 100 ? 'danger' : 'default'} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Performance" description={`All ${d.records.length} recorded day(s). Ratios are recalculated from totals.`}>
          <table className="w-full text-[13px]">
            <tbody>
              {METRIC_ROWS.filter((r) => relevant.has(r.key) || m[r.key] !== null).map((r) => (
                <tr key={r.key} className="border-t border-border first:border-0">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal text-muted-foreground">{r.label}{relevant.has(r.key) && <span className="sr-only"> (objective metric)</span>}</th>
                  <td className={`py-1.5 text-right tabular ${relevant.has(r.key) ? 'font-medium' : ''}`}>{showMetric(m, r.key, r.kind, c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-muted-foreground">{REACH_NOTE}{incompleteInteractions ? ' Content interactions are incomplete: engagement rate and cost per interaction are N/A until every day has all four parts.' : ''}</p>
        </SectionCard>

        <SectionCard title="Budget pacing">
          <DefinitionList items={[
            { label: 'Spent', value: formatMoney(decimalToUnits(d.pacing.spent), c.currency) },
            { label: 'Remaining', value: d.pacing.remaining === null ? 'N/A' : d.pacing.remaining.startsWith('-') ? <span className="text-danger">Over by {formatMoney(decimalToUnits(d.pacing.remaining.slice(1)), c.currency)}</span> : formatMoney(decimalToUnits(d.pacing.remaining), c.currency) },
            { label: 'Utilization', value: fmtPct(d.pacing.utilizationPct, 1) },
            { label: 'Expected spend by now', value: d.pacing.expectedSpentByNow === null ? 'N/A' : fmtCost(d.pacing.expectedSpentByNow, c.currency), hint: `${d.pacing.elapsedDays} of ${d.pacing.plannedDays} planned days elapsed (active days only)` },
            { label: 'Projected end-of-campaign spend', value: d.pacing.projectedEndSpend === null ? 'Insufficient Data' : fmtCost(d.pacing.projectedEndSpend, c.currency) },
          ]} />
          <p className="mt-2 text-[12px] text-muted-foreground">{d.pacing.projectionNote}</p>
        </SectionCard>
      </div>

      <SectionCard
        title="Trends"
        description="Complete days only, in the campaign's reporting timezone. Changes are descriptive — no statistical significance is claimed."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <FilterSelect id="trend-mode" label="Compare" value={mode} onChange={(v) => setMode(v as TrendMode)} options={[
              { value: 'last7', label: 'Last 7 complete days vs previous 7' },
              { value: 'previousDay', label: 'Previous complete day vs the day before' },
              { value: 'custom', label: 'Selected period vs preceding period' },
            ]} />
            {mode === 'custom' && (
              <>
                <div className="flex flex-col gap-1"><Label htmlFor="trend-from">From</Label><Input id="trend-from" type="date" value={custom.from} max={addDaysIso(d.today, -1)} onChange={(e) => setCustom((x) => ({ ...x, from: e.target.value }))} className="w-40" /></div>
                <div className="flex flex-col gap-1"><Label htmlFor="trend-to">To</Label><Input id="trend-to" type="date" value={custom.to} max={addDaysIso(d.today, -1)} onChange={(e) => setCustom((x) => ({ ...x, to: e.target.value }))} className="w-40" /></div>
              </>
            )}
          </div>
        }
      >
        {'error' in windows ? <p className="text-[13px] text-danger">{windows.error}</p> : (
          <>
            <p className="mb-2 text-[12px] text-muted-foreground">
              {formatDate(windows.current.from)} – {formatDate(windows.current.to)} compared with {formatDate(windows.previous.from)} – {formatDate(windows.previous.to)}. Stable means within ±{d.settings.stablePct}%.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-[13px]">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-1">Metric</th><th>Current</th><th>Previous</th><th>Trend</th></tr></thead>
                <tbody>
                  {TREND_METRICS.filter((t) => relevant.has(t.key) || t.key === 'spend').map((t) => {
                    const r = compareTrend(d.records, t, windows, d.settings.stablePct);
                    return (
                      <tr key={t.key} className="border-t border-border align-top">
                        <td className="py-1.5">{t.label}{t.polarity === 'neutral' && <div className="text-[11px] text-muted-foreground">No better/worse reading{t.key === 'spend' ? ' — more spend alone is not improvement' : ''}</div>}</td>
                        <td className="tabular">{r.status === 'ok' ? fmtMetric(t.kind, r.current, c.currency) : '—'}</td>
                        <td className="tabular">{r.status === 'ok' ? fmtMetric(t.kind, r.previous, c.currency) : '—'}</td>
                        <td>{r.status === 'ok' ? <TrendBadge trend={r} /> : <span className="text-[12px] text-muted-foreground">{r.reason}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      <SectionCard title="Campaign details">
        <DefinitionList columns={3} items={[
          { label: 'Reference', value: c.reference },
          { label: 'Objective', value: c.objective },
          { label: 'Platform', value: c.platformName },
          { label: 'Brand', value: c.brandName || '—' },
          { label: 'Target country', value: c.targetCountryCode },
          { label: 'Social account', value: c.socialAccountLabel || '—' },
          { label: 'Owner (created by)', value: `${c.createdByName} · ${formatDate(c.createdAt.slice(0, 10))}` },
          { label: 'Assigned staff', value: c.assignedStaffName || '—', hint: 'Assignment grants no editing rights' },
          { label: 'Last updated', value: `${c.updatedByName || '—'} · ${formatDate(c.updatedAt.slice(0, 10))}` },
          { label: 'Currency', value: c.currency },
          { label: 'Dates', value: `${formatDate(c.startDate)} – ${formatDate(c.endDate)}` },
          { label: 'Reporting timezone', value: c.reportingTimezone },
          { label: 'Ads URL', value: <AdsLibraryLink href={c.adsUrl} /> },
        ]} />
      </SectionCard>
    </div>
  );
}

/* ── Daily tracker ────────────────────────────────────────────── */

function TrackerTab({ d }: { d: CampaignDetail }) {
  const c = d.campaign;
  const [editing, setEditing] = React.useState<SavedRecord | undefined>();
  const [open, setOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<SavedRecord>();
  const remove = useDeleteRecord();
  const missing = expectedActiveDates(c, d.statusHistory, d.today).filter((date) => !d.records.some((r) => r.reportDate === date));
  const activeCreatives = (date: string) => d.creatives.filter((k) => (!k.usedFrom || k.usedFrom <= date) && (!k.usedTo || k.usedTo >= date) && (k.usedFrom || k.usedTo)).length;
  const records = [...d.records].sort((a, b) => b.reportDate.localeCompare(a.reportDate));
  const cell = (v: number | null | undefined) => (v === null || v === undefined ? <span className="text-muted-foreground">—</span> : v.toLocaleString('en-US'));

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">One campaign-level record per date — daily values only, never running totals. “—” means not recorded.</p>
        {d.canEdit && c.status !== 'Archived' && <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }}><Plus /> Add daily record</Button>}
      </div>
      {missing.length > 0 && (
        <p className="rounded-md border border-warning/40 bg-warning-bg/40 px-3 py-2 text-[12px]">
          Missing expected daily records ({missing.length}): {missing.slice(-10).map((x) => formatDate(x)).join(', ')}{missing.length > 10 ? ' …' : ''}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[80rem] border-collapse text-[12px]">
          <caption className="sr-only">Daily performance records</caption>
          <thead className="bg-surface-2">
            <tr>{['Date', 'Spend', ...COUNT_FIELDS.map((f) => METRIC_LABELS[f]), 'Creatives active', 'Entered by', 'Actions'].map((h) => <th key={h} scope="col" className="border-b border-border px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr>
          </thead>
          <tbody>
            {!records.length ? <tr><td colSpan={16} className="p-3"><EmptyState title="No daily records yet" description="Add a record or upload an Excel file." /></td></tr> : records.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap px-2 py-1.5 font-medium tabular">{formatDate(r.reportDate)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 tabular">{r.amountSpent === null ? <span className="text-muted-foreground">—</span> : formatMoney(decimalToUnits(r.amountSpent), c.currency)}</td>
                {COUNT_FIELDS.map((f) => <td key={f} className="px-2 py-1.5 tabular">{cell(r[f])}</td>)}
                <td className="px-2 py-1.5 tabular">{activeCreatives(r.reportDate) || '—'}</td>
                <td className="px-2 py-1.5">{r.createdByName}</td>
                <td className="px-2 py-1.5">
                  {r.canEdit ? (
                    <span className="flex gap-1">
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit record ${r.reportDate}`} onClick={() => { setEditing(r); setOpen(true); }}><Pencil /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete record ${r.reportDate}`} onClick={() => setDeleting(r)}><Trash2 /></Button>
                    </span>
                  ) : <span className="text-[11px] text-muted-foreground">View only</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">“Creatives active” counts creatives whose used-from/used-to dates include that day. It does not attribute that day's results to a creative.</p>
      <RecordDialog open={open} onOpenChange={setOpen} campaign={c} record={editing} today={d.today} />
      <ConfirmWithReason open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)} title={`Delete the record for ${deleting?.reportDate}?`}
        description="The daily values are removed; the deletion and your reason are kept in the audit history." confirmLabel="Delete record"
        placeholder="Why is this record being deleted?" hint="At least 10 characters."
        onConfirm={(reason) => remove.mutateAsync({ id: deleting!.id, reason })} />
    </div>
  );
}

/* ── Charts ───────────────────────────────────────────────────── */

/** Ads charts: gaps stay gaps, lines are straight, and a chart with nothing
 *  recorded says so instead of drawing an empty axis. */
function AdsChart(props: React.ComponentProps<typeof TrendLineChart>) {
  if (!props.series.some((x) => x.points.some((p) => p.value !== null))) {
    return <EmptyState title={`Nothing recorded for ${props.title}`} description="No record in this period has the values this chart needs. Nothing is shown as zero." />;
  }
  return <TrendLineChart breakAtGaps smooth={false} {...props} />;
}

function ChartsTab({ d }: { d: CampaignDetail }) {
  const c = d.campaign;
  const lastDay = c.endDate < d.today ? c.endDate : d.today;
  const [granularity, setGranularity] = React.useState<Granularity>('daily');
  const [range, setRange] = React.useState({ from: c.startDate, to: lastDay < c.startDate ? c.startDate : lastDay });
  const valid = range.from && range.to && range.from <= range.to;
  const series = (label: string, pick: (m: Metrics) => number | bigint | null) => ({ label, points: valid ? metricSeries(d.records, granularity, range.from, range.to, pick).map(({ date, value }) => ({ date, value })) : [] });
  const money = (v: number) => formatMoney(v, c.currency, { precise: true });
  const period = granularity === 'daily' ? 'day' : granularity === 'weekly' ? 'week (Mon–Sun)' : 'month';
  const cumulative = valid ? cumulativeSpendSeries(d.records, range.from, range.to) : [];
  const budget = c.budget ? Number(c.budget) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect id="chart-granularity" label="View" value={granularity} onChange={(v) => setGranularity(v as Granularity)} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />
        <div className="flex flex-col gap-1"><Label htmlFor="chart-from">From</Label><Input id="chart-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="w-40" /></div>
        <div className="flex flex-col gap-1"><Label htmlFor="chart-to">To</Label><Input id="chart-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="w-40" /></div>
        <p className="pb-2 text-[12px] text-muted-foreground">One point per {period}, recalculated from that period's totals. Periods with no records are gaps, not zero.</p>
      </div>
      {!valid ? <p className="text-[13px] text-danger">Choose a start date on or before the end date.</p> : (
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="Reach and impressions"><AdsChart title="Sum of daily reach and impressions" description={REACH_NOTE} valueName="People and views" series={[series('Sum of daily reach', (m) => m.reachSum), series('Impressions', (m) => m.impressions)]} /></SectionCard>
          <SectionCard title="Content interactions"><AdsChart title="Content interactions" description="Reactions + comments + shares + saves; a period missing any part is left out." valueName="Interactions" series={[series('Content interactions', (m) => (m.interactionsComplete ? m.interactions : null))]} /></SectionCard>
          <SectionCard title="Spend"><AdsChart title={`Spend (${c.currency})`} valueName={c.currency} valueFormat={money} series={[series('Spend', (m) => m.spend)]} /></SectionCard>
          <SectionCard title="Cost per interaction"><AdsChart title={`Cost per interaction (${c.currency})`} valueName={c.currency} valueFormat={money} series={[series('Cost per interaction', (m) => m.costPerInteraction)]} /></SectionCard>
          <SectionCard title="CTR"><AdsChart title="Click-through rate (%)" valueName="Percent" valueFormat={(v) => `${v.toFixed(2)}%`} series={[series('Link CTR', (m) => m.linkCtr), series('All-click CTR', (m) => m.allClickCtr)]} /></SectionCard>
          <SectionCard title="Link clicks and landing-page views"><AdsChart title="Link clicks and landing-page views" valueName="Clicks and views" series={[series('Link clicks', (m) => m.linkClicks), series('Landing-page views', (m) => m.landingPageViews)]} /></SectionCard>
          <SectionCard title="Cumulative spend vs budget" className="xl:col-span-2">
            <AdsChart title={`Cumulative spend vs budget (${c.currency})`} valueName={c.currency} valueFormat={money}
              description={budget === null ? 'No budget set.' : 'The budget is shown as a flat line; cumulative spend skips days with no spend record.'}
              series={[{ label: 'Cumulative spend', points: cumulative }, ...(budget === null ? [] : [{ label: 'Budget', points: cumulative.map((p) => ({ date: p.date, value: budget })) }])]} />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

/* ── Creatives ────────────────────────────────────────────────── */

function CreativesTab({ d }: { d: CampaignDetail }) {
  const [viewer, setViewer] = React.useState<number | null>(null);
  const [upload, setUpload] = React.useState(false);
  const [editing, setEditing] = React.useState<Creative>();
  const [removing, setRemoving] = React.useState<Creative>();
  const remove = useRemoveCreative();
  const update = useUpdateCreative();
  const [form, setForm] = React.useState({ adsUrl: '', usedFrom: '', usedTo: '', description: '' });
  const [formError, setFormError] = React.useState<string>();
  React.useEffect(() => { if (editing) { setForm({ adsUrl: editing.adsUrl, usedFrom: editing.usedFrom ?? '', usedTo: editing.usedTo ?? '', description: editing.description }); setFormError(undefined); } }, [editing]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">Creatives are kept as history; adding a new one never replaces an old one. Results are campaign-level — no creative is credited with them.</p>
        {d.canEdit && d.campaign.status !== 'Archived' && <Button size="sm" onClick={() => setUpload(true)}><ImagePlus /> Upload creative</Button>}
      </div>
      {!d.creatives.length ? <EmptyState title="No creatives yet" /> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {d.creatives.map((k, i) => (
            <li key={k.id} className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <button type="button" onClick={() => setViewer(i)} className="overflow-hidden rounded bg-muted" aria-label={`View ${k.fileName}`}>
                <img src={creativeUrl(k.id)} alt="" loading="lazy" className="aspect-[4/5] w-full object-contain" />
              </button>
              <p className="truncate text-[12px] font-medium" title={k.fileName}>{k.fileName}</p>
              <p className="text-[11px] text-muted-foreground">{k.width} × {k.height} · {formatBytes(k.sizeBytes)} · {k.createdByName}, {formatDate(k.createdAt.slice(0, 10))}</p>
              <p className="text-[11px]">Used {k.usedFrom ? formatDate(k.usedFrom) : '—'} to {k.usedTo ? formatDate(k.usedTo) : '—'}</p>
              <AdsLibraryLink href={k.adsUrl || d.campaign.adsUrl} />
              {k.canEdit && (
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setEditing(k)}><Pencil /> Edit</Button>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${k.fileName}`} onClick={() => setRemoving(k)}><Trash2 /></Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <CreativeViewer creatives={d.creatives} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} campaignAdsUrl={d.campaign.adsUrl} />
      <CreativeUploadDialog open={upload} onOpenChange={setUpload} campaignId={d.campaign.id} defaultAdsUrl={d.campaign.adsUrl} />
      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(undefined)}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>Edit creative details</DialogTitle><DialogDescription>The image itself cannot be replaced — upload a new creative instead, so history is kept.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label="Ads URL" htmlFor="ce-url" error={formError}><Input id="ce-url" value={form.adsUrl} onChange={(e) => setForm((f) => ({ ...f, adsUrl: e.target.value }))} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Used from" htmlFor="ce-from"><Input id="ce-from" type="date" value={form.usedFrom} onChange={(e) => setForm((f) => ({ ...f, usedFrom: e.target.value }))} /></Field>
              <Field label="Used to" htmlFor="ce-to"><Input id="ce-to" type="date" value={form.usedTo} onChange={(e) => setForm((f) => ({ ...f, usedTo: e.target.value }))} /></Field>
            </div>
            <Field label="Description" htmlFor="ce-desc"><Input id="ce-desc" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(undefined)}>Cancel</Button>
            <Button onClick={async () => {
              try { await update.mutateAsync({ id: editing!.id, ...form }); setEditing(undefined); } catch (e) { if (e instanceof ApiError) setFormError(e.message); }
            }}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmWithReason open={Boolean(removing)} onOpenChange={(v) => !v && setRemoving(undefined)} title={`Remove ${removing?.fileName}?`}
        description="It is hidden from the campaign; the removal and reason stay in the audit history." confirmLabel="Remove creative"
        placeholder="Why is this creative being removed?" hint="At least 10 characters."
        onConfirm={(reason) => remove.mutateAsync({ id: removing!.id, reason })} />
    </div>
  );
}

/* ── References ───────────────────────────────────────────────── */

function ReferencesTab({ d }: { d: CampaignDetail }) {
  const upload = useUploadReference();
  const remove = useRemoveReference();
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [description, setDescription] = React.useState('');
  const [dailyRecordId, setDailyRecordId] = React.useState('');
  const [error, setError] = React.useState<string>();
  const [removing, setRemoving] = React.useState<CampaignDetail['references'][number]>();
  const input = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { if (open) { setFile(null); setDescription(''); setDailyRecordId(''); setError(undefined); } }, [open]);

  const choose = async (f: File) => {
    const checked = checkReference(f.name, new Uint8Array(await f.arrayBuffer()));
    if ('error' in checked) { setFile(null); setError(checked.error); return; }
    setError(undefined); setFile(f);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">Reference documents never become performance data — only a confirmed Excel import fills the tracker.</p>
        {d.canEdit && d.campaign.status !== 'Archived' && <Button size="sm" onClick={() => setOpen(true)}><Paperclip /> Attach reference</Button>}
      </div>
      {!d.references.length ? <EmptyState title="No reference documents" /> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[48rem] text-[13px]">
            <caption className="sr-only">Reference documents</caption>
            <thead className="bg-surface-2"><tr>{['File', 'Type', 'Size', 'For', 'Uploaded', 'Description', 'Actions'].map((h) => <th key={h} scope="col" className="px-2 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr></thead>
            <tbody>
              {d.references.map((f) => {
                const previewable = f.kind === 'image' || f.mimeType === 'application/pdf';
                return (
                  <tr key={f.id} className="border-t border-border align-top">
                    <td className="px-2 py-1.5"><span className="inline-flex items-center gap-1.5 break-all"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />{f.fileName}</span></td>
                    <td className="px-2 py-1.5">{f.fileName.split('.').pop()?.toUpperCase()}</td>
                    <td className="px-2 py-1.5 tabular">{formatBytes(f.sizeBytes)}</td>
                    <td className="px-2 py-1.5">{f.dailyRecordId ? d.records.find((r) => r.id === f.dailyRecordId)?.reportDate ?? 'Daily record' : 'Campaign'}</td>
                    <td className="px-2 py-1.5">{f.createdByName}<div className="text-[11px] text-muted-foreground">{new Date(f.createdAt).toLocaleString()}</div></td>
                    <td className="px-2 py-1.5">{f.description || '—'}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex flex-wrap gap-1">
                        {previewable && <Button size="sm" variant="ghost" asChild><a href={referenceUrl(f.id)} target="_blank" rel="noopener noreferrer"><ExternalLink /> Preview</a></Button>}
                        <Button size="sm" variant="ghost" asChild><a href={referenceUrl(f.id, true)}><Download /> Download</a></Button>
                        {f.canEdit && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${f.fileName}`} onClick={() => setRemoving(f)}><Trash2 /></Button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>Attach reference</DialogTitle><DialogDescription>PDF, DOCX, XLSX or CSV up to 5 MB; JPG, PNG or WebP images up to 1 MB. Never identity documents, passwords or recovery codes.</DialogDescription></DialogHeader>
          <div className="flex flex-col gap-3">
            <Field label="File" htmlFor="ref-file" required error={error} hint={file ? `${file.name} · ${formatBytes(file.size)}` : undefined}>
              <div>
                <input ref={input} id="ref-file" type="file" accept={REFERENCE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Reference file" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} />
                <Button type="button" size="sm" variant="outline" onClick={() => input.current?.click()}><Paperclip /> Choose file</Button>
              </div>
            </Field>
            <Field label="Daily record (optional)" htmlFor="ref-daily">
              <NativeSelect id="ref-daily" value={dailyRecordId} onChange={(e) => setDailyRecordId(e.target.value)}>
                <option value="">The whole campaign</option>
                {[...d.records].sort((a, b) => b.reportDate.localeCompare(a.reportDate)).map((r) => <option key={r.id} value={r.id}>{formatDate(r.reportDate)}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Description" htmlFor="ref-desc"><Textarea id="ref-desc" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!file || upload.isPending} onClick={async () => {
              try { await upload.mutateAsync({ campaignId: d.campaign.id, file: file!, description, dailyRecordId }); setOpen(false); } catch (e) { if (e instanceof ApiError) setError(e.message); }
            }}>{upload.isPending ? 'Uploading…' : 'Attach'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmWithReason open={Boolean(removing)} onOpenChange={(v) => !v && setRemoving(undefined)} title={`Remove ${removing?.fileName}?`}
        description="The file is hidden from the campaign; the removal and reason are kept in the audit history." confirmLabel="Remove file"
        placeholder="Why is this file being removed?" hint="At least 10 characters." onConfirm={(reason) => remove.mutateAsync({ id: removing!.id, reason })} />
    </div>
  );
}

/* ── Notes & history ──────────────────────────────────────────── */

function NotesTab({ d }: { d: CampaignDetail }) {
  const { data } = useCrmData();
  const save = useSaveFollowUp();
  const remove = useDeleteFollowUp();
  const [form, setForm] = React.useState({ note: '', recommendation: '', ownerUserId: '', dueDate: '' });
  const [deleting, setDeleting] = React.useState<string>();
  const audit = (data?.auditEntries ?? []).filter((a) => a.recordType === 'Ads Campaign' && a.recordId === d.campaign.id);

  return (
    <div className="flex flex-col gap-4">
      <SectionCard title="Campaign notes"><p className="whitespace-pre-wrap text-[13px]">{d.campaign.notes || '—'}</p></SectionCard>
      <SectionCard title="Notes, recommendations and follow-ups" description="A follow-up owner is who acts on it; it grants no editing rights.">
        {d.canEdit && (
          <form className="mb-4 grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
            e.preventDefault();
            if (!form.note.trim() && !form.recommendation.trim()) return;
            await save.mutateAsync({ campaignId: d.campaign.id, ...form });
            setForm({ note: '', recommendation: '', ownerUserId: '', dueDate: '' });
          }}>
            <Field label="Note" htmlFor="fu-note"><Textarea id="fu-note" rows={2} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} /></Field>
            <Field label="Recommendation" htmlFor="fu-rec"><Textarea id="fu-rec" rows={2} value={form.recommendation} onChange={(e) => setForm((f) => ({ ...f, recommendation: e.target.value }))} /></Field>
            <Field label="Follow-up owner" htmlFor="fu-owner">
              <NativeSelect id="fu-owner" value={form.ownerUserId} onChange={(e) => setForm((f) => ({ ...f, ownerUserId: e.target.value }))}>
                <option value="">— None —</option>
                {(data?.teamMembers ?? []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Due date" htmlFor="fu-due"><Input id="fu-due" type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} /></Field>
            <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={save.isPending || (!form.note.trim() && !form.recommendation.trim())}><Plus /> Add follow-up</Button></div>
          </form>
        )}
        {!d.followUps.length ? <p className="text-[13px] text-muted-foreground">No follow-ups yet.</p> : (
          <ul className="flex flex-col divide-y divide-border">
            {d.followUps.map((f) => (
              <li key={f.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-[13px]">
                <div className="min-w-0">
                  {f.note && <p className="whitespace-pre-wrap">{f.note}</p>}
                  {f.recommendation && <p className="whitespace-pre-wrap"><strong>Recommendation:</strong> {f.recommendation}</p>}
                  <p className="text-[11px] text-muted-foreground">{f.createdByName} · owner {f.ownerName || '—'} · due {f.dueDate ? formatDate(f.dueDate) : '—'}</p>
                </div>
                <span className="flex items-center gap-1">
                  {f.completed ? <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Done</Badge> : <Badge tone="warning">Open</Badge>}
                  {f.canEdit && <Button size="sm" variant="ghost" onClick={() => save.mutate({ id: f.id, campaignId: d.campaign.id, completed: !f.completed })}>{f.completed ? 'Reopen' : 'Mark done'}</Button>}
                  {f.canEdit && <Button size="icon-sm" variant="ghost" aria-label="Delete follow-up" onClick={() => setDeleting(f.id)}><Trash2 /></Button>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard title="Status history">
        <ul className="flex flex-col gap-1 text-[13px]">
          {d.statusHistory.map((s, i) => <li key={i}>{new Date(s.changedAt).toLocaleString()} — <CampaignStatusBadge status={s.status} /></li>)}
        </ul>
      </SectionCard>
      <SectionCard title="Audit history"><AuditTimeline entries={audit} emptyTitle="No recorded changes yet" /></SectionCard>
      <ConfirmWithReason open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)} title="Delete this follow-up?" description="The deletion and reason are kept in the audit history."
        confirmLabel="Delete follow-up" placeholder="Why is this follow-up being deleted?" hint="At least 10 characters." onConfirm={(reason) => remove.mutateAsync({ id: deleting!, reason })} />
    </div>
  );
}

export default function AdsCampaignDetailPage() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const detail = useCampaign(campaignId);
  const save = useSaveCampaign();
  const restore = useRestoreCampaign();
  const remove = useDeleteCampaign();
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [restoreOpen, setRestoreOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  if (detail.error) {
    return (detail.error as ApiError).status === 404
      ? <EmptyState title="Campaign not found" action={<Button variant="outline" asChild><Link to="/ads-monitoring?tab=campaigns">Back to campaigns</Link></Button>} />
      : <ErrorState message={detail.error.message} onRetry={() => detail.refetch()} />;
  }
  if (detail.isLoading || !detail.data) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  const d = detail.data;
  const c = d.campaign;
  const canDelete = d.canEdit && !d.records.length && !d.creatives.length && !d.references.length && !d.followUps.length;

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => navigate('/ads-monitoring?tab=campaigns')}><ArrowLeft /> Ads Monitoring</Button>
      <PageHeader
        title={c.name}
        description={`${c.reference} · ${c.objective} · ${c.platformName} · ${c.currency} · owner ${c.createdByName}`}
        actions={d.canEdit ? (
          <>
            {c.status !== 'Archived' && <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit</Button>}
            {c.status === 'Archived'
              ? <Button size="sm" variant="outline" onClick={() => setRestoreOpen(true)}><ArchiveRestore /> Restore</Button>
              : <Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}><Archive /> Archive</Button>}
            {canDelete && <Button size="sm" variant="outline" className="text-danger" onClick={() => setDeleteOpen(true)}><Trash2 /> Delete</Button>}
          </>
        ) : undefined}
      >
        <div className="flex flex-wrap items-center gap-2">
          <CampaignStatusBadge status={c.status} />
          <AdsLibraryLink href={c.adsUrl} />
          {!d.canEdit && <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><Info className="h-3.5 w-3.5" aria-hidden="true" /> View only — only {c.createdByName} (the creator) or the System Owner can change this campaign.</span>}
        </div>
      </PageHeader>

      <Tabs defaultValue="summary">
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="tracker">Daily Tracker ({d.records.length})</TabsTrigger>
          <TabsTrigger value="charts">Charts</TabsTrigger>
          <TabsTrigger value="creatives">Creatives ({d.creatives.length})</TabsTrigger>
          <TabsTrigger value="references">References ({d.references.length})</TabsTrigger>
          <TabsTrigger value="notes">Notes &amp; History</TabsTrigger>
        </TabsList>
        <TabsContent value="summary"><SummaryTab d={d} /></TabsContent>
        <TabsContent value="tracker"><TrackerTab d={d} /></TabsContent>
        <TabsContent value="charts"><ChartsTab d={d} /></TabsContent>
        <TabsContent value="creatives"><CreativesTab d={d} /></TabsContent>
        <TabsContent value="references"><ReferencesTab d={d} /></TabsContent>
        <TabsContent value="notes"><NotesTab d={d} /></TabsContent>
      </Tabs>

      <CampaignFormDialog open={editOpen} onOpenChange={setEditOpen} campaign={c} hasRecords={d.records.length > 0} />
      <ConfirmWithReason open={archiveOpen} onOpenChange={setArchiveOpen} title={`Archive ${c.reference}?`} description="The campaign leaves active lists and alerts. Its records, files and history are kept, and it can be restored."
        onConfirm={(reason) => save.mutateAsync({ id: c.id, status: 'Archived', reason })} />
      <ConfirmWithReason open={restoreOpen} onOpenChange={setRestoreOpen} title={`Restore ${c.reference}?`} description="It returns with the status it had before it was archived." confirmLabel="Restore campaign" danger={false}
        placeholder="Why is this campaign being restored?" hint="At least 10 characters." onConfirm={(reason) => restore.mutateAsync({ id: c.id, reason })} />
      <ConfirmWithReason open={deleteOpen} onOpenChange={setDeleteOpen} title={`Delete ${c.reference}?`} description="Only possible while nothing is recorded against it. The deletion and reason are kept in the audit history."
        confirmLabel="Delete campaign" placeholder="Why is this campaign being deleted?" hint="At least 10 characters."
        onConfirm={async (reason) => { await remove.mutateAsync({ id: c.id, reason }); navigate('/ads-monitoring?tab=campaigns'); }} />
    </div>
  );
}
