import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Info, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader, SectionCard, EmptyState, ErrorState, RecordLink } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Input, Label, Skeleton } from '@/components/ui/primitives';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { CAMPAIGN_STATUSES, mayCreateCampaign } from '@/lib/ads/campaign';
import { OBJECTIVES, REACH_NOTE, aggregate, computeMetrics, OBJECTIVE_METRICS, type Metrics } from '@/lib/ads/metrics';
import { CURRENCIES, decimalToUnits, formatMoney, type CurrencyCode } from '@/lib/ads/money';
import { formatDate } from '@/lib/utils';
import { fetchImportErrors, useCampaignList, useCompare, useImportHistory, useOverview } from '@/features/ads/api';
import { CampaignFormDialog } from '@/features/ads/CampaignFormDialog';
import { AdsLibraryLink, CreativeCell } from '@/features/ads/Creatives';
import { ImportDialog, downloadErrorReport, downloadTemplate } from '@/features/ads/ImportDialog';
import { CampaignStatusBadge, TrendBadge, fmtCost, fmtCount, fmtPct } from '@/features/ads/format';

const DEFAULTS = { tab: 'overview', search: '', status: 'all', country: 'all', platform: 'all', brand: 'all', owner: 'all', objective: 'all', currency: 'all', from: '', to: '', sort: 'startDate', dir: 'desc', page: '1' };

/** A DECIMAL string from the API, formatted exactly. */
function money(value: string | null, currency: CurrencyCode) {
  return formatMoney(decimalToUnits(value), currency);
}

/* ── Overview ─────────────────────────────────────────────────── */

function OverviewTab() {
  const overview = useOverview();
  if (overview.error) return <ErrorState message={overview.error.message} onRetry={() => overview.refetch()} />;
  if (overview.isLoading || !overview.data) return <Skeleton className="h-64 w-full" />;
  const o = overview.data;
  const alerts = o.campaigns.flatMap((c) => c.alerts.map((a) => ({ ...a, campaign: c })));
  const byKind = (kinds: string[]) => alerts.filter((a) => kinds.includes(a.kind));
  const improving = o.campaigns.filter((c) => c.trend?.status === 'ok' && c.trend.interpretation === 'Improving');
  const declining = o.campaigns.filter((c) => c.trend?.status === 'ok' && c.trend.interpretation === 'Declining');

  const AlertList = ({ items, empty }: { items: typeof alerts; empty: string }) => items.length ? (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((a, i) => (
        <li key={`${a.campaign.id}-${a.kind}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[13px]">
          <span><RecordLink to={`/ads-monitoring/${a.campaign.id}`}>{a.campaign.reference}</RecordLink> <span className="text-muted-foreground">{a.campaign.name}</span></span>
          <span className={a.severity === 'critical' ? 'text-danger' : a.severity === 'warning' ? 'text-warning' : 'text-muted-foreground'}>{a.message}</span>
        </li>
      ))}
    </ul>
  ) : <p className="text-[13px] text-muted-foreground">{empty}</p>;

  return (
    <div className="flex flex-col gap-4">
      <KpiGrid className="lg:grid-cols-4">
        <KpiCard label="Active campaigns" value={o.activeCampaigns} hint={`${o.campaignsTracked} tracked (not archived)`} />
        <KpiCard label="Content interactions" value={o.engagement.interactions}
          hint={`From ${o.engagement.completeCampaigns} campaign(s) with complete interaction data${o.engagement.incompleteCampaigns ? `; ${o.engagement.incompleteCampaigns} excluded as incomplete` : ''}`} />
        <KpiCard label="Improving trends" value={improving.length} tone="success" hint="Objective metric, last 7 complete days vs the 7 before" />
        <KpiCard label="Declining trends" value={declining.length} tone="warning" hint="Not a verdict — check the campaign's data completeness" />
      </KpiGrid>

      <SectionCard title="Spend by currency" description="Totals are never added across currencies — there is no conversion in this release.">
        {o.spendByCurrency.length ? (
          <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {o.spendByCurrency.map((g) => (
              <li key={g.currency} className="rounded-md border border-border px-3 py-2">
                <p className="text-[12px] text-muted-foreground">{g.currency} · {g.campaigns} campaign{g.campaigns === 1 ? '' : 's'}</p>
                <p className="text-lg font-semibold tabular">{money(g.spend, g.currency)}</p>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No campaigns yet" />}
      </SectionCard>

      <SectionCard title="Cost by objective" description="Pooled from summed inputs within one objective and one currency.">
        {o.objectiveCosts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[13px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground"><th className="py-1.5">Objective</th><th>Currency</th><th>Campaigns</th><th>Result</th><th>Cost</th></tr></thead>
              <tbody>
                {o.objectiveCosts.map((g) => (
                  <tr key={`${g.objective}-${g.currency}`} className="border-t border-border">
                    <td className="py-1.5">{g.objective}</td><td>{g.currency}</td><td className="tabular">{g.campaigns}</td>
                    <td className="tabular">{g.resultLabel}: {fmtCount(g.result)}</td>
                    <td className="tabular">{g.costLabel}: {fmtCost(g.cost, g.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-[13px] text-muted-foreground">No data yet.</p>}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Missing daily entries"><AlertList items={byKind(['missing-records'])} empty="Every expected active day has a record." /></SectionCard>
        <SectionCard title="Budget warnings"><AlertList items={byKind(['budget-near-limit', 'budget-exceeded'])} empty="No budget warnings." /></SectionCard>
        <SectionCard title="Ending soon"><AlertList items={byKind(['ending-soon'])} empty={`No active campaign ends within ${o.settings.endingSoonDays} days.`} /></SectionCard>
        <SectionCard title="Cost and engagement alerts"><AlertList items={byKind(['rising-cost-per-interaction', 'declining-engagement'])} empty="No rising cost per interaction or declining engagement rate." /></SectionCard>
      </div>

      <SectionCard title="Open follow-ups" description="A follow-up owner is who acts on it — it grants no editing rights.">
        {o.followUpsOpen.length ? (
          <ul className="flex flex-col divide-y divide-border text-[13px]">
            {o.followUpsOpen.map((f) => (
              <li key={f.id} className="flex flex-wrap justify-between gap-2 py-2">
                <span><RecordLink to={`/ads-monitoring/${f.campaignId}`}>{f.campaignId}</RecordLink> {f.recommendation || f.note}</span>
                <span className="text-muted-foreground">{f.ownerName || 'No owner'} · due {f.dueDate ? formatDate(f.dueDate) : '—'}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted-foreground">No open follow-ups.</p>}
      </SectionCard>
      <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><Info className="h-3.5 w-3.5" aria-hidden="true" /> Alerts are informational. Nothing here changes an ad or its spending.</p>
    </div>
  );
}

/* ── Campaigns ────────────────────────────────────────────────── */

function CampaignsTab({ values, set, clear, activeCount }: ReturnType<typeof useFilters<typeof DEFAULTS>>) {
  const { data } = useCrmData();
  const navigate = useNavigate();
  const params = Object.fromEntries(Object.entries(values).filter(([k]) => k !== 'tab'));
  const list = useCampaignList(params);
  const page = Number(values.page) || 1;
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / list.data.pageSize)) : 1;
  const setFilter = (patch: Partial<typeof DEFAULTS>) => set({ ...patch, page: '1' });

  const SortHeader = ({ id, children }: { id: string; children: React.ReactNode }) => {
    const active = values.sort === id;
    return (
      <button type="button" className="inline-flex items-center gap-1 font-semibold uppercase" aria-label={`Sort by ${String(children)}`}
        onClick={() => set({ sort: id, dir: active && values.dir === 'asc' ? 'desc' : 'asc', page: '1' })}>
        {children}{active && (values.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    );
  };
  const th = 'border-b border-border px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap';

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <FilterBar onClear={() => clear()} activeCount={activeCount}>
        <SearchInput id="ads-search" value={values.search} onChange={(v) => setFilter({ search: v })} placeholder="Search name or reference…" className="min-w-[14rem] flex-1" />
        <FilterSelect id="ads-f-status" label="Status" value={values.status} onChange={(v) => setFilter({ status: v })} options={[{ value: 'all', label: 'All but archived' }, ...CAMPAIGN_STATUSES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="ads-f-objective" label="Objective" value={values.objective} onChange={(v) => setFilter({ objective: v })} options={[{ value: 'all', label: 'All' }, ...OBJECTIVES.map((o) => ({ value: o, label: o }))]} />
        <FilterSelect id="ads-f-currency" label="Currency" value={values.currency} onChange={(v) => setFilter({ currency: v })} options={[{ value: 'all', label: 'All' }, ...CURRENCIES.map((c) => ({ value: c.code, label: c.code }))]} />
        <FilterSelect id="ads-f-country" label="Country" value={values.country} onChange={(v) => setFilter({ country: v })} options={[{ value: 'all', label: 'All' }, ...(data?.countries ?? []).map((c) => ({ value: c.code, label: c.name }))]} />
        <FilterSelect id="ads-f-platform" label="Platform" value={values.platform} onChange={(v) => setFilter({ platform: v })} options={[{ value: 'all', label: 'All' }, ...(data?.platforms ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <FilterSelect id="ads-f-brand" label="Brand" value={values.brand} onChange={(v) => setFilter({ brand: v })} options={[{ value: 'all', label: 'All' }, ...(data?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))]} />
        <FilterSelect id="ads-f-owner" label="Owner" value={values.owner} onChange={(v) => setFilter({ owner: v })} options={[{ value: 'all', label: 'Anyone' }, ...(data?.teamMembers ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
        <div className="flex flex-col gap-1"><Label htmlFor="ads-f-from">Running from</Label><Input id="ads-f-from" type="date" value={values.from} onChange={(e) => setFilter({ from: e.target.value })} className="w-40" /></div>
        <div className="flex flex-col gap-1"><Label htmlFor="ads-f-to">to</Label><Input id="ads-f-to" type="date" value={values.to} onChange={(e) => setFilter({ to: e.target.value })} className="w-40" /></div>
      </FilterBar>

      {list.error ? <ErrorState message={list.error.message} onRetry={() => list.refetch()} /> : (
        <>
          <p className="text-[13px] text-muted-foreground" aria-live="polite">{list.isLoading ? 'Loading campaigns…' : `${list.data?.total ?? 0} campaign${list.data?.total === 1 ? '' : 's'}`}. Spend and costs are shown in each campaign's own currency.</p>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[90rem] border-collapse text-[13px]">
              <caption className="sr-only">Ads campaigns</caption>
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className={th}><SortHeader id="name">Campaign</SortHeader></th>
                  <th scope="col" className={th}>Brand</th>
                  <th scope="col" className={th}>Country</th>
                  <th scope="col" className={th}>Platform</th>
                  <th scope="col" className={th}>Owner</th>
                  <th scope="col" className={th}><SortHeader id="startDate">Dates</SortHeader></th>
                  <th scope="col" className={th}><SortHeader id="status">Status</SortHeader></th>
                  <th scope="col" className={th}><SortHeader id="currency">Currency</SortHeader></th>
                  <th scope="col" className={th}><SortHeader id="budget">Budget</SortHeader></th>
                  <th scope="col" className={th}><SortHeader id="spend">Spend</SortHeader></th>
                  <th scope="col" className={th}>Primary Result</th>
                  <th scope="col" className={th}>Cost per Result</th>
                  <th scope="col" className={th}>Trend</th>
                  <th scope="col" className={th}>Creative Used</th>
                  <th scope="col" className={th}>Ads URL</th>
                  <th scope="col" className={th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.isLoading ? (
                  <tr><td colSpan={16} className="p-4"><Skeleton className="h-24 w-full" /></td></tr>
                ) : !list.data?.items.length ? (
                  <tr><td colSpan={16} className="p-4"><EmptyState title="No campaigns match" description="Create a campaign, upload an Excel file, or adjust the filters." /></td></tr>
                ) : list.data.items.map((c) => (
                  <tr key={c.id} className="cursor-pointer border-b border-border align-top last:border-0 hover:bg-muted/40" onClick={() => navigate(`/ads-monitoring/${c.id}`)}>
                    <td className="px-2 py-2"><Link to={`/ads-monitoring/${c.id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{c.name}</Link><div className="text-[11px] text-muted-foreground">{c.reference} · {c.objective}</div></td>
                    <td className="px-2 py-2">{c.brandName || '—'}</td>
                    <td className="px-2 py-2">{c.targetCountryCode}</td>
                    <td className="px-2 py-2">{c.platformName}</td>
                    <td className="px-2 py-2">{c.createdByName}{c.assignedStaffName && <div className="text-[11px] text-muted-foreground">Assigned: {c.assignedStaffName}</div>}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular">{formatDate(c.startDate)}<div className="text-[11px] text-muted-foreground">to {formatDate(c.endDate)}</div></td>
                    <td className="px-2 py-2"><CampaignStatusBadge status={c.status} /></td>
                    <td className="px-2 py-2">{c.currency}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular">{money(c.budget, c.currency)}</td>
                    <td className="whitespace-nowrap px-2 py-2 tabular">{money(c.spend, c.currency)}<div className="text-[11px] text-muted-foreground">{c.recordCount} day{c.recordCount === 1 ? '' : 's'} recorded</div></td>
                    <td className="px-2 py-2 tabular">{fmtCount(c.primaryResult.value)}<div className="text-[11px] text-muted-foreground">{c.primaryResult.label}</div></td>
                    <td className="whitespace-nowrap px-2 py-2 tabular">{fmtCost(c.primaryResult.cost, c.currency)}<div className="text-[11px] text-muted-foreground">{c.primaryResult.costLabel}</div></td>
                    <td className="px-2 py-2"><TrendBadge trend={c.trend} compact /></td>
                    <td className="px-2 py-2"><CreativeCell creatives={c.creatives} adsUrl={c.adsUrl} /></td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}><AdsLibraryLink href={c.adsUrl} /></td>
                    <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="outline" asChild><Link to={`/ads-monitoring/${c.id}`}>{c.canEdit ? 'Manage' : 'View'}</Link></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-end gap-2 text-[13px]">
            <span className="text-muted-foreground">Page {page} of {pages}</span>
            <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}><ChevronLeft /></Button>
            <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}><ChevronRight /></Button>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Compare ──────────────────────────────────────────────────── */

const COMPARE_LABELS: Partial<Record<keyof Metrics, { label: string; kind: 'money' | 'count' | 'percent' }>> = {
  spend: { label: 'Spend', kind: 'money' }, reachSum: { label: 'Sum of daily reach', kind: 'count' }, impressions: { label: 'Impressions', kind: 'count' },
  interactions: { label: 'Content interactions', kind: 'count' }, engagementRate: { label: 'Engagement rate (by summed daily reach)', kind: 'percent' },
  costPerInteraction: { label: 'Cost per interaction', kind: 'money' }, linkClicks: { label: 'Link clicks', kind: 'count' }, linkCtr: { label: 'Link CTR', kind: 'percent' },
  costPerLinkClick: { label: 'Cost per link click', kind: 'money' }, cpm: { label: 'CPM', kind: 'money' }, landingPageViews: { label: 'Landing-page views', kind: 'count' },
  landingPageArrivalRate: { label: 'Landing-page arrival rate', kind: 'percent' }, costPerLandingPageView: { label: 'Cost per landing-page view', kind: 'money' },
  newFollowers: { label: 'New followers', kind: 'count' }, costPerFollower: { label: 'Cost per follower', kind: 'money' }, appInstalls: { label: 'App installs', kind: 'count' },
  costPerInstall: { label: 'Cost per install', kind: 'money' }, allClickCtr: { label: 'All-click CTR', kind: 'percent' },
};

function CompareTab() {
  const [objective, setObjective] = React.useState<string>('Engagement');
  const [currency, setCurrency] = React.useState<string>('PHP');
  const [selected, setSelected] = React.useState<string[]>([]);
  const candidates = useCampaignList({ objective, currency, status: 'all', pageSize: '100', sort: 'name', dir: 'asc' });
  const compare = useCompare(selected);
  React.useEffect(() => setSelected([]), [objective, currency]);
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 6 ? s : [...s, id]));

  const rows = compare.data?.campaigns.map((c) => ({ c, m: computeMetrics(aggregate(compare.data!.records.filter((r) => r.campaignId === c.id)), c.budget) })) ?? [];
  const keys = (['spend', ...OBJECTIVE_METRICS[objective as keyof typeof OBJECTIVE_METRICS]] as (keyof Metrics)[]).filter((k, i, a) => a.indexOf(k) === i && COMPARE_LABELS[k]);
  const show = (k: keyof Metrics, m: Metrics, cur: CurrencyCode) => {
    const v = m[k]; const kind = COMPARE_LABELS[k]!.kind;
    if (typeof v === 'bigint') return formatMoney(v, cur);
    if (typeof v !== 'number') return 'N/A';
    return kind === 'money' ? fmtCost(v, cur) : kind === 'percent' ? fmtPct(v) : fmtCount(v);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">Campaigns are compared only within one objective (same metric definitions) and one currency. There is no creative ranking — results are recorded per campaign, not per creative.</p>
      <div className="flex flex-wrap gap-3">
        <FilterSelect id="cmp-objective" label="Objective" value={objective} onChange={setObjective} options={OBJECTIVES.map((o) => ({ value: o, label: o }))} />
        <FilterSelect id="cmp-currency" label="Currency" value={currency} onChange={setCurrency} options={CURRENCIES.map((c) => ({ value: c.code, label: c.code }))} />
      </div>
      <SectionCard title="Choose 2 to 6 campaigns">
        {candidates.data?.items.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {candidates.data.items.map((c) => (
              <li key={c.id}><label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /> {c.reference} — {c.name}</label></li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-muted-foreground">No campaigns with this objective and currency.</p>}
      </SectionCard>
      {compare.error && <ErrorState message={compare.error.message} />}
      {rows.length >= 2 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-[13px]">
            <caption className="sr-only">Campaign comparison</caption>
            <thead className="bg-surface-2"><tr><th scope="col" className="px-3 py-2 text-left">Metric</th>{rows.map(({ c }) => <th key={c.id} scope="col" className="px-3 py-2 text-right">{c.reference}</th>)}</tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t border-border"><th scope="row" className="px-3 py-1.5 text-left font-normal">{COMPARE_LABELS[k]!.label}</th>{rows.map(({ c, m }) => <td key={c.id} className="px-3 py-1.5 text-right tabular">{show(k, m, c.currency)}</td>)}</tr>
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[12px] text-muted-foreground">{REACH_NOTE}</p>
        </div>
      )}
    </div>
  );
}

/* ── Import history ───────────────────────────────────────────── */

function ImportHistoryTab() {
  const [page, setPage] = React.useState(1);
  const history = useImportHistory(page);
  if (history.error) return <ErrorState message={history.error.message} onRetry={() => history.refetch()} />;
  const items = history.data?.items ?? [];
  const pages = history.data ? Math.max(1, Math.ceil(history.data.total / history.data.pageSize)) : 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] text-[13px]">
          <caption className="sr-only">Import history</caption>
          <thead className="bg-surface-2"><tr>{['When', 'Uploader', 'File', 'Existing rows', 'Campaigns', 'Created', 'Updated', 'Skipped', 'Rejected', 'Errors'].map((h) => <th key={h} scope="col" className="px-2 py-2 text-left text-[11px] uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr></thead>
          <tbody>
            {history.isLoading ? <tr><td colSpan={10} className="p-3"><Skeleton className="h-16 w-full" /></td></tr>
              : !items.length ? <tr><td colSpan={10} className="p-3"><EmptyState title="No imports yet" /></td></tr>
                : items.map((i) => (
                  <tr key={i.id} className="border-t border-border">
                    <td className="px-2 py-1.5 whitespace-nowrap">{new Date(i.createdAt).toLocaleString()}</td>
                    <td className="px-2 py-1.5">{i.userName}</td>
                    <td className="px-2 py-1.5 break-all">{i.fileName}</td>
                    <td className="px-2 py-1.5">{i.mode === 'update' ? 'Updated' : 'Skipped'}</td>
                    <td className="px-2 py-1.5 tabular">{i.campaignsCreated}</td>
                    <td className="px-2 py-1.5 tabular">{i.created}</td>
                    <td className="px-2 py-1.5 tabular">{i.updated}</td>
                    <td className="px-2 py-1.5 tabular">{i.skipped}</td>
                    <td className="px-2 py-1.5 tabular">{i.rejected > 0 ? <Badge tone="danger">{i.rejected}</Badge> : 0}</td>
                    <td className="px-2 py-1.5">
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { downloadErrorReport((await fetchImportErrors(i.id)).rows, `import-${i.id}-report.csv`); } catch (e) { toast.error((e as Error).message); }
                      }}><Download /> Report</Button>
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-[13px]">
        <span className="text-muted-foreground">Page {page} of {pages}</span>
        <Button size="icon-sm" variant="outline" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft /></Button>
        <Button size="icon-sm" variant="outline" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight /></Button>
      </div>
    </div>
  );
}

export default function AdsMonitoringPage() {
  const filters = useFilters(DEFAULTS, { notFilters: ['tab', 'sort', 'dir', 'page'] });
  const { data } = useCrmData();
  const { actorId, role, permissions } = useSession();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const canCreate = mayCreateCampaign({ id: actorId, role, permissions });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Ads Monitoring"
        description="Advertising campaigns, daily performance, creatives and trends. Everyone can view; only a record's creator or the System Owner can change it."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => downloadTemplate(data?.platforms ?? [], data?.countries ?? []).catch(() => toast.error('Could not create the template.'))}><Download /> Download Sample Template</Button>
            {canCreate && <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload /> Upload Excel</Button>}
            {canCreate && <Button size="sm" onClick={() => setFormOpen(true)}><Plus /> New campaign</Button>}
          </>
        }
      />
      <p className="flex items-start gap-1.5 rounded-md border border-border bg-surface px-3 py-2 text-[12px] text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Data is entered or imported by the team — there is no live connection to any ad platform. Reach is the sum of daily reach, not deduplicated unique reach.
      </p>
      <Tabs value={filters.values.tab} onValueChange={(tab) => filters.set({ tab })}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="imports">Import History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewTab /></TabsContent>
        <TabsContent value="campaigns"><CampaignsTab {...filters} /></TabsContent>
        <TabsContent value="compare"><CompareTab /></TabsContent>
        <TabsContent value="imports"><ImportHistoryTab /></TabsContent>
      </Tabs>
      <CampaignFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={(c) => navigate(`/ads-monitoring/${c.id}`)} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
