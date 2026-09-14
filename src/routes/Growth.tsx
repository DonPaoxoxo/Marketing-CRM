import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Flame, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { PageHeader, ErrorState, RecordLink, SafeExternalLink, SectionCard, SecurityNotice, Measured } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { DataTable } from '@/components/common/DataTable';
import { ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { CategoryBarChart } from '@/components/charts/CategoryBarChart';
import { TrendLineChart, type TrendSeries } from '@/components/charts/TrendLineChart';
import { DailyEntryGrid } from '@/features/growth/DailyEntryGrid';
import { ContentPostDialog } from '@/features/growth/ContentPostDialog';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import {
  DEFAULT_GROWTH_THRESHOLDS, TREND_LABELS, contentSummary,
  growthSummary, rankContent, trackableAccounts,
  type ContentRankBy, type GrowthSummary, type GrowthTrend,
} from '@/lib/growth';
import { CONTENT_FORMAT, type ContentPost } from '@/lib/types';
import { compactNumber, displayUrl, formatDate } from '@/lib/utils';

const DEFAULTS = {
  tab: 'entry',
  search: '', platform: 'all', brand: 'all', trend: 'all', window: '30',
  cSearch: '', cPlatform: 'all', cFormat: 'all', cAccount: 'all', rank: 'engagementRate',
};

const TREND_TONE: Record<GrowthTrend, React.ComponentProps<typeof Badge>['tone']> = {
  growing: 'success',
  flat: 'neutral',
  declining: 'danger',
  'insufficient-data': 'warning',
};

/** Follower totals are entered by hand, so every figure carries where it came from. */
export default function GrowthPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS, { notFilters: ['tab'] });
  const { can } = useSession();
  const [postOpen, setPostOpen] = React.useState(false);
  const [editingPost, setEditingPost] = React.useState<ContentPost | undefined>();

  const windowDays = Number(values.window) || DEFAULT_GROWTH_THRESHOLDS.windowDays;

  /* ── Followers ──────────────────────────────────────────────── */

  const summaries = React.useMemo<(GrowthSummary & { accountLabel: string })[]>(() => {
    if (!data) return [];
    return trackableAccounts(data.socialAccounts).map((a) => ({
      ...growthSummary(data.followerSnapshots, a.id, { windowDays }),
      accountLabel: `@${a.username}`,
    }));
  }, [data, windowDays]);

  const summaryById = React.useMemo(
    () => new Map(summaries.map((s) => [s.accountId, s])),
    [summaries],
  );

  const followerRows = React.useMemo(() => {
    if (!data) return [];
    const needle = values.search.trim().toLowerCase();
    return trackableAccounts(data.socialAccounts).filter((a) => {
      const s = summaryById.get(a.id);
      if (values.platform !== 'all' && a.platformId !== values.platform) return false;
      if (values.brand !== 'all' && a.brandId !== values.brand) return false;
      if (values.trend === 'stale') {
        if (!s?.trackingStale) return false;
      } else if (values.trend === 'untracked') {
        if (s?.tracked) return false;
      } else if (values.trend !== 'all' && s?.trend !== values.trend) {
        return false;
      }
      if (needle) {
        const hay = `${a.id} ${a.username} ${a.displayName} ${lookups.brandName(a.brandId)}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [data, values, summaryById, lookups]);

  const tracked = summaries.filter((s) => s.points.length > 0);
  const netGain = tracked.reduce((n, s) => n + (s.absoluteGain ?? 0), 0);

  /** The six biggest movers by absolute gain — the line chart's series cap. */
  const topMovers: TrendSeries[] = React.useMemo(() => {
    const eligible = summaries.filter((s) => followerRows.some((a) => a.id === s.accountId) && s.windowPoints.length > 1);
    return [...eligible]
      .sort((a, b) => Math.abs(b.absoluteGain ?? 0) - Math.abs(a.absoluteGain ?? 0))
      .slice(0, 6)
      .map((s) => ({
        label: s.accountLabel,
        points: s.windowPoints.map((p) => ({ date: p.date, value: p.followerCount })),
      }));
  }, [summaries, followerRows]);

  /* ── Content ────────────────────────────────────────────────── */

  const posts = React.useMemo(() => (data?.contentPosts ?? []).filter((p) => !p.archived), [data]);

  const filteredPosts = React.useMemo(() => {
    const needle = values.cSearch.trim().toLowerCase();
    return posts.filter((p) => {
      if (values.cPlatform !== 'all' && p.platformId !== values.cPlatform) return false;
      if (values.cFormat !== 'all' && p.format !== values.cFormat) return false;
      if (values.cAccount !== 'all' && p.accountId !== values.cAccount) return false;
      if (needle && !`${p.title} ${p.notes} ${p.url}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [posts, values]);

  const ranked = React.useMemo(
    () => rankContent(filteredPosts, { by: values.rank as ContentRankBy }),
    [filteredPosts, values.rank],
  );
  const cSummary = React.useMemo(() => contentSummary(filteredPosts), [filteredPosts]);

  const accountLabel = (id: string) => {
    const a = data?.socialAccounts.find((x) => x.id === id);
    return a ? `@${a.username}` : id;
  };

  /* ── Columns ────────────────────────────────────────────────── */

  const followerColumns = React.useMemo<ColumnDef<(typeof followerRows)[number], unknown>[]>(() => [
    {
      id: 'username', header: 'Account', accessorKey: 'username',
      cell: ({ row }) => (
        <span className="flex flex-col">
          <RecordLink to={`/accounts/${row.original.id}`}>@{row.original.username}</RecordLink>
          <span className="text-[11px] text-muted-foreground">{lookups.brandName(row.original.brandId)}</span>
        </span>
      ),
    },
    { id: 'platform', header: 'Platform', accessorFn: (r) => lookups.platformName(r.platformId) },
    {
      id: 'current', header: 'Followers', accessorFn: (r) => summaryById.get(r.id)?.endCount ?? -1,
      cell: ({ row }) => {
        const s = summaryById.get(row.original.id);
        return (
          <span className="flex flex-col">
            <span className="tabular font-medium">{s?.endCount?.toLocaleString() ?? '—'}</span>
            <Measured date={s?.latest?.date} />
          </span>
        );
      },
    },
    {
      id: 'gain', header: `Gain (${windowDays}d)`, accessorFn: (r) => summaryById.get(r.id)?.absoluteGain ?? 0,
      cell: ({ row }) => {
        const s = summaryById.get(row.original.id);
        if (s?.absoluteGain == null) return <span className="text-muted-foreground">—</span>;
        return (
          <Badge tone={s.absoluteGain > 0 ? 'success' : s.absoluteGain < 0 ? 'danger' : 'neutral'}>
            {s.absoluteGain > 0 ? '+' : ''}{s.absoluteGain.toLocaleString()}
          </Badge>
        );
      },
    },
    {
      id: 'percent', header: 'Change', accessorFn: (r) => summaryById.get(r.id)?.percentGain ?? 0,
      cell: ({ row }) => {
        const p = summaryById.get(row.original.id)?.percentGain;
        return <span className="tabular">{p == null ? '—' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`}</span>;
      },
    },
    {
      id: 'perDay', header: 'Avg / day', accessorFn: (r) => summaryById.get(r.id)?.averagePerDay ?? 0,
      cell: ({ row }) => {
        const v = summaryById.get(row.original.id)?.averagePerDay;
        return <span className="tabular">{v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`}</span>;
      },
    },
    {
      id: 'trend', header: 'Trend', accessorFn: (r) => summaryById.get(r.id)?.trend ?? '',
      cell: ({ row }) => {
        const s = summaryById.get(row.original.id);
        if (!s) return null;
        return <Badge tone={TREND_TONE[s.trend]}>{TREND_LABELS[s.trend]}</Badge>;
      },
    },
    {
      id: 'lastEntry', header: 'Last entry', accessorFn: (r) => summaryById.get(r.id)?.latest?.date ?? '',
      cell: ({ row }) => {
        const s = summaryById.get(row.original.id);
        if (!s?.latest) return <Badge tone="neutral">never recorded</Badge>;
        return (
          <span className="flex flex-col">
            <span className="tabular">{formatDate(s.latest.date)}</span>
            {s.trackingStale && <span className="text-[11px] text-warning">tracking stale</span>}
          </span>
        );
      },
    },
  ], [lookups, summaryById, windowDays]);

  const contentColumns = React.useMemo<ColumnDef<(typeof ranked)[number], unknown>[]>(() => [
    {
      id: 'title', header: 'Post', accessorFn: (r) => r.post.title,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium">{row.original.post.title}</span>
          <span className="text-[11px] text-muted-foreground">
            {accountLabel(row.original.post.accountId)} · {row.original.post.format}
          </span>
        </span>
      ),
    },
    { id: 'platform', header: 'Platform', accessorFn: (r) => lookups.platformName(r.post.platformId) },
    {
      // Opens the video itself, to re-read its numbers or check which post this is.
      id: 'url', header: 'Post URL', accessorFn: (r) => r.post.url, enableSorting: false,
      cell: ({ row }) => (row.original.post.url.trim()
        ? <SafeExternalLink href={row.original.post.url} className="max-w-[18rem] text-[13px]">{displayUrl(row.original.post.url)}</SafeExternalLink>
        : <span className="text-[12px] text-muted-foreground">No URL</span>),
    },
    {
      id: 'publishedDate', header: 'Published', accessorFn: (r) => r.post.publishedDate,
      cell: ({ row }) => <span className="tabular">{formatDate(row.original.post.publishedDate)}</span>,
    },
    { id: 'views', header: 'Views', accessorFn: (r) => r.post.views, cell: ({ row }) => <span className="tabular">{row.original.post.views.toLocaleString()}</span> },
    { id: 'likes', header: 'Likes', accessorFn: (r) => r.post.likes, cell: ({ row }) => <span className="tabular">{row.original.post.likes.toLocaleString()}</span> },
    { id: 'comments', header: 'Comments', accessorFn: (r) => r.post.comments, cell: ({ row }) => <span className="tabular">{row.original.post.comments.toLocaleString()}</span> },
    { id: 'shares', header: 'Shares', accessorFn: (r) => r.post.shares, cell: ({ row }) => <span className="tabular">{row.original.post.shares.toLocaleString()}</span> },
    {
      id: 'rate', header: 'Engagement', accessorFn: (r) => r.rate ?? -1,
      cell: ({ row }) => {
        const r = row.original.rate;
        if (r === null) return <span className="text-muted-foreground">—</span>;
        return <Badge tone={r >= 8 ? 'success' : r >= 3 ? 'accent' : 'neutral'}>{r.toFixed(1)}%</Badge>;
      },
    },
    {
      id: 'followerGain', header: 'Followers gained', accessorFn: (r) => r.post.followerGain ?? -1,
      cell: ({ row }) => {
        const g = row.original.post.followerGain;
        return g === null ? <span className="text-[12px] text-muted-foreground">not reported</span> : <span className="tabular">+{g.toLocaleString()}</span>;
      },
    },
    {
      id: 'measured', header: 'Numbers read', accessorFn: (r) => r.post.metricsMeasuredAt,
      cell: ({ row }) => <span className="tabular text-[12px]">{formatDate(row.original.post.metricsMeasuredAt)}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, enableHiding: false,
      cell: ({ row }) => (
        <Button
          size="sm" variant="ghost" disabled={!can('edit:resources')}
          onClick={(e) => { e.stopPropagation(); setEditingPost(row.original.post); setPostOpen(true); }}
        >
          Edit
        </Button>
      ),
    },
  ], [lookups, can, data]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Social growth"
        description="Daily follower totals and short-form engagement, entered by hand. Growth is derived from the totals, so a missed day never breaks a series."
      />

      <SecurityNotice>
        Nothing here is synchronised from a platform. Every figure is a number someone read and typed in, stamped with
        the date they read it.
      </SecurityNotice>

      <Tabs value={values.tab} onValueChange={(v) => set({ tab: v })}>
        <TabsList>
          <TabsTrigger value="entry">Daily entry</TabsTrigger>
          <TabsTrigger value="followers">Follower growth</TabsTrigger>
          <TabsTrigger value="content">Content performance</TabsTrigger>
        </TabsList>

        <TabsContent value="entry">
          <DailyEntryGrid />
        </TabsContent>

        <TabsContent value="followers" className="flex flex-col gap-5">
          <KpiGrid className="lg:grid-cols-3 xl:grid-cols-5">
            <KpiCard
              label="Accounts tracked"
              value={tracked.length}
              hint={`${summaries.length - tracked.length} of ${summaries.length} live accounts never recorded`}
              to="/growth?tab=followers&trend=untracked"
            />
            <KpiCard
              label={`Net followers gained (${windowDays}d)`}
              value={netGain > 0 ? `+${netGain.toLocaleString()}` : netGain.toLocaleString()}
              tone={netGain > 0 ? 'success' : netGain < 0 ? 'danger' : 'default'}
            />
            <KpiCard label="Growing" value={summaries.filter((s) => s.trend === 'growing').length} tone="success" to="/growth?tab=followers&trend=growing" icon={<TrendingUp className="h-4 w-4" />} />
            <KpiCard label="Declining" value={summaries.filter((s) => s.trend === 'declining').length} tone="danger" to="/growth?tab=followers&trend=declining" icon={<TrendingDown className="h-4 w-4" />} />
            <KpiCard
              label="Tracking gone stale"
              value={summaries.filter((s) => s.trackingStale).length}
              tone="warning"
              hint={`Tracked before, nothing for ${DEFAULT_GROWTH_THRESHOLDS.staleTrackingDays}+ days`}
              to="/growth?tab=followers&trend=stale"
            />
          </KpiGrid>

          <SectionCard title="Biggest movers" description={`Follower totals over the last ${windowDays} days, for the accounts that moved most.`}>
            {topMovers.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Not enough recorded days yet to draw a trend.</p>
            ) : (
              <TrendLineChart
                title={`Follower totals — last ${windowDays} days`}
                series={topMovers}
                valueName="Followers"
                valueFormat={(v) => compactNumber(v)}
                footnote="A flat run between two points is a day nobody recorded, not a day with no change."
              />
            )}
          </SectionCard>

          <FilterBar onClear={clear} activeCount={activeCount}>
            <SearchInput id="growth-search" value={values.search} onChange={(v) => set({ search: v })}
              placeholder="Search handle, brand…" className="min-w-[14rem] flex-1" />
            <FilterSelect id="growth-window" label="Window" value={values.window} onChange={(v) => set({ window: v })}
              options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }, { value: '45', label: 'Last 45 days' }]} />
            <FilterSelect id="growth-trend" label="Trend" value={values.trend} onChange={(v) => set({ trend: v })}
              options={[
                { value: 'all', label: 'All' },
                { value: 'growing', label: 'Growing' },
                { value: 'flat', label: 'Flat' },
                { value: 'declining', label: 'Declining' },
                { value: 'insufficient-data', label: 'Not enough data' },
                { value: 'stale', label: 'Tracking stale' },
                { value: 'untracked', label: 'Never recorded' },
              ]} />
            <FilterSelect id="growth-platform" label="Platform" value={values.platform} onChange={(v) => set({ platform: v })}
              options={[{ value: 'all', label: 'All platforms' }, ...(data?.platforms ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
            <FilterSelect id="growth-brand" label="Brand" value={values.brand} onChange={(v) => set({ brand: v })}
              options={[{ value: 'all', label: 'All brands' }, ...(data?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))]} />
          </FilterBar>

          <DataTable
            tableId="growth-followers"
            columns={followerColumns}
            data={followerRows}
            isLoading={isLoading}
            onRetry={() => refetch()}
            initialSorting={[{ id: 'gain', desc: true }]}
            emptyTitle="No accounts match"
            toolbar={
              <ExportButton
                rows={followerRows}
                recordType="Follower Growth"
                filename="follower-growth"
                columns={[
                  { key: 'id', header: 'Account ID', value: (r) => r.id },
                  { key: 'username', header: 'Handle', value: (r) => r.username },
                  { key: 'platform', header: 'Platform', value: (r) => lookups.platformName(r.platformId) },
                  { key: 'brand', header: 'Brand', value: (r) => lookups.brandName(r.brandId) },
                  { key: 'followers', header: 'Followers', value: (r) => summaryById.get(r.id)?.endCount },
                  { key: 'measuredAt', header: 'Measured on', value: (r) => summaryById.get(r.id)?.latest?.date },
                  { key: 'gain', header: `Gain (${windowDays}d)`, value: (r) => summaryById.get(r.id)?.absoluteGain },
                  { key: 'percent', header: 'Percent change', value: (r) => summaryById.get(r.id)?.percentGain?.toFixed(2) },
                  { key: 'perDay', header: 'Average per day', value: (r) => summaryById.get(r.id)?.averagePerDay?.toFixed(2) },
                  { key: 'trend', header: 'Trend', value: (r) => TREND_LABELS[summaryById.get(r.id)?.trend ?? 'insufficient-data'] },
                ]}
              />
            }
          />
        </TabsContent>

        <TabsContent value="content" className="flex flex-col gap-5">
          <KpiGrid className="lg:grid-cols-4">
            <KpiCard label="Posts recorded" value={cSummary.posts} icon={<Flame className="h-4 w-4" />} />
            <KpiCard label="Total views" value={compactNumber(cSummary.totalViews)} />
            <KpiCard
              label="Median engagement rate"
              value={cSummary.medianRate === null ? '—' : `${cSummary.medianRate.toFixed(1)}%`}
              hint="(likes + comments + shares) ÷ views"
            />
            <KpiCard
              label="Followers from content"
              value={cSummary.totalFollowerGain > 0 ? `+${cSummary.totalFollowerGain.toLocaleString()}` : '0'}
              tone="success"
              hint="Where the platform reports it"
            />
          </KpiGrid>

          <SectionCard
            title="Highest engagement"
            description={`Posts with at least ${DEFAULT_GROWTH_THRESHOLDS.leaderboardMinViews} views — below that a rate is noise, not a signal.`}
          >
            <CategoryBarChart
              title="Top posts by engagement rate"
              valueName="Engagement rate"
              valueSuffix="%"
              maxBars={8}
              data={rankContent(filteredPosts, { by: 'engagementRate', limit: 8 }).map((r) => ({
                label: r.post.title.length > 34 ? `${r.post.title.slice(0, 33)}…` : r.post.title,
                value: Number((r.rate ?? 0).toFixed(1)),
              }))}
              footnote="Rate compares like with like — all three formats are short-form video."
            />
          </SectionCard>

          <FilterBar onClear={clear} activeCount={activeCount}>
            <SearchInput id="content-search" value={values.cSearch} onChange={(v) => set({ cSearch: v })}
              placeholder="Search post title, notes or URL…" className="min-w-[14rem] flex-1" />
            <FilterSelect id="content-rank" label="Rank by" value={values.rank} onChange={(v) => set({ rank: v })}
              options={[
                { value: 'engagementRate', label: 'Engagement rate' },
                { value: 'views', label: 'Views' },
                { value: 'totalEngagements', label: 'Total engagements' },
                { value: 'followerGain', label: 'Followers gained' },
              ]} />
            <FilterSelect id="content-format" label="Format" value={values.cFormat} onChange={(v) => set({ cFormat: v })}
              options={[{ value: 'all', label: 'All formats' }, ...CONTENT_FORMAT.map((f) => ({ value: f, label: f }))]} />
            <FilterSelect id="content-platform" label="Platform" value={values.cPlatform} onChange={(v) => set({ cPlatform: v })}
              options={[{ value: 'all', label: 'All platforms' }, ...(data?.platforms ?? []).filter((p) => ['PLT-02', 'PLT-03', 'PLT-04'].includes(p.id)).map((p) => ({ value: p.id, label: p.name }))]} />
            <FilterSelect id="content-account" label="Account" value={values.cAccount} onChange={(v) => set({ cAccount: v })}
              options={[
                { value: 'all', label: 'All accounts' },
                ...[...new Set(posts.map((p) => p.accountId))].map((id) => ({ value: id, label: accountLabel(id) })),
              ]} />
          </FilterBar>

          <DataTable
            tableId="growth-content"
            columns={contentColumns}
            data={ranked}
            isLoading={isLoading}
            onRetry={() => refetch()}
            initialHidden={['comments', 'shares', 'measured']}
            emptyTitle="No posts match"
            emptyDescription="Record a post, or widen the filters."
            getRowId={(r) => r.post.id}
            toolbar={
              <>
                <ExportButton
                  rows={ranked}
                  recordType="Content Post"
                  filename="content-performance"
                  columns={[
                    { key: 'id', header: 'Post ID', value: (r) => r.post.id },
                    { key: 'title', header: 'Title', value: (r) => r.post.title },
                    { key: 'account', header: 'Account', value: (r) => accountLabel(r.post.accountId) },
                    { key: 'platform', header: 'Platform', value: (r) => lookups.platformName(r.post.platformId) },
                    { key: 'format', header: 'Format', value: (r) => r.post.format },
                    { key: 'url', header: 'URL', value: (r) => r.post.url },
                    { key: 'publishedDate', header: 'Published', value: (r) => r.post.publishedDate },
                    { key: 'views', header: 'Views', value: (r) => r.post.views },
                    { key: 'likes', header: 'Likes', value: (r) => r.post.likes },
                    { key: 'comments', header: 'Comments', value: (r) => r.post.comments },
                    { key: 'shares', header: 'Shares', value: (r) => r.post.shares },
                    { key: 'rate', header: 'Engagement rate %', value: (r) => r.rate?.toFixed(2) },
                    { key: 'followerGain', header: 'Followers gained', value: (r) => r.post.followerGain },
                    { key: 'metricsMeasuredAt', header: 'Numbers read on', value: (r) => r.post.metricsMeasuredAt },
                  ]}
                />
                <Button size="sm" onClick={() => { setEditingPost(undefined); setPostOpen(true); }} disabled={!can('edit:resources')}>
                  <Plus /> Record post
                </Button>
              </>
            }
          />
        </TabsContent>
      </Tabs>

      <ContentPostDialog
        open={postOpen}
        onOpenChange={(v) => { setPostOpen(v); if (!v) setEditingPost(undefined); }}
        post={editingPost}
      />
    </div>
  );
}
