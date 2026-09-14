import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Info, UserPlus } from 'lucide-react';
import { PageHeader, StatusBadge, ErrorState, RecordLink, SectionCard } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { DataTable } from '@/components/common/DataTable';
import { ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { AssignDrawer } from '@/features/assignments/AssignDrawer';
import { ReadinessChecklist } from '@/features/reserves/ReadinessChecklist';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { DEFAULT_THRESHOLDS, evaluateReserveReadiness, reserveAccounts } from '@/lib/rules';
import type { SocialAccount } from '@/lib/types';
import { daysSince, formatDate, groupCount } from '@/lib/utils';

const DEFAULTS = { search: '', platform: 'all', brand: 'all', readiness: 'all', project: 'all', verified: 'all' };

export default function ReservesPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS);
  const { can } = useSession();
  const navigate = useNavigate();
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assignTarget, setAssignTarget] = React.useState<string | undefined>();

  /** Reserve inventory is a filtered view of the account register — never a copy. */
  const reserves = React.useMemo(
    () => (data ? reserveAccounts(data.socialAccounts) : []),
    [data],
  );

  const readinessById = React.useMemo(() => {
    const map = new Map<string, ReturnType<typeof evaluateReserveReadiness>>();
    if (!data) return map;
    reserves.forEach((a) => map.set(a.id, evaluateReserveReadiness(a, data.assignments)));
    return map;
  }, [reserves, data]);

  const readyCount = React.useMemo(() => reserves.filter((a) => readinessById.get(a.id)?.ready).length, [reserves, readinessById]);
  const missingSetup = React.useMemo(
    () => reserves.filter((a) => {
      const r = readinessById.get(a.id);
      return r && !r.ready && r.failed.some((f) => ['ownership', 'credential', 'recovery'].includes(f.key));
    }),
    [reserves, readinessById],
  );
  const reservedForProject = React.useMemo(() => reserves.filter((a) => a.reservedForProjectId), [reserves]);
  const staleVerification = React.useMemo(
    () => reserves.filter((a) => {
      const since = daysSince(a.lastAccessVerifiedDate);
      return since === null || since > DEFAULT_THRESHOLDS.accessVerificationWindowDays;
    }),
    [reserves],
  );

  const byPlatform = React.useMemo(() => groupCount(reserves, (a) => lookups.platformName(a.platformId)), [reserves, lookups]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return reserves.filter((a) => {
      const r = readinessById.get(a.id);
      // Overview drilldowns pass platform and brand by name.
      if (values.platform !== 'all' && lookups.platformName(a.platformId) !== values.platform && a.platformId !== values.platform) return false;
      if (values.brand !== 'all' && lookups.brandName(a.brandId) !== values.brand && a.brandId !== values.brand) return false;
      if (values.project === 'any' && !a.reservedForProjectId) return false;
      if (values.project !== 'all' && values.project !== 'any' && a.reservedForProjectId !== values.project) return false;
      if (values.readiness === 'ready' && !r?.ready) return false;
      if (values.readiness === 'not-ready' && r?.ready) return false;
      if (values.readiness === 'missing-setup' && !missingSetup.includes(a)) return false;
      if (values.verified === 'stale' && !staleVerification.includes(a)) return false;
      if (values.verified === 'never' && a.lastAccessVerifiedDate) return false;
      if (needle) {
        const hay = [a.id, a.username, a.displayName, lookups.brandName(a.brandId), lookups.platformName(a.platformId)].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [reserves, values, readinessById, lookups, missingSetup, staleVerification]);

  const columns = React.useMemo<ColumnDef<SocialAccount, unknown>[]>(() => [
    { id: 'id', header: 'Account ID', accessorKey: 'id', cell: ({ row }) => <RecordLink to={`/accounts/${row.original.id}`}>{row.original.id}</RecordLink> },
    { id: 'platform', header: 'Platform', accessorFn: (r) => lookups.platformName(r.platformId) },
    { id: 'username', header: 'Handle', accessorKey: 'username', cell: ({ row }) => <span className="font-medium">@{row.original.username}</span> },
    { id: 'assetType', header: 'Asset type', accessorKey: 'assetType' },
    { id: 'brand', header: 'Brand', accessorFn: (r) => lookups.brandName(r.brandId) },
    { id: 'country', header: 'Target country', accessorFn: (r) => lookups.countryName(r.targetCountryCode) },
    {
      id: 'readiness', header: 'Readiness',
      accessorFn: (r) => (readinessById.get(r.id)?.ready ? 'Ready' : `${readinessById.get(r.id)?.failed.length ?? 0} gaps`),
      cell: ({ row }) => {
        const r = readinessById.get(row.original.id);
        if (!r) return null;
        return (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" onClick={(e) => e.stopPropagation()} className="rounded-sm">
                <Badge tone={r.ready ? 'success' : 'warning'}>
                  {r.ready ? 'Ready to assign' : `${r.failed.length} gap${r.failed.length === 1 ? '' : 's'}`}
                </Badge>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-96" onClick={(e) => e.stopPropagation()}>
              <p className="mb-2 text-[12px] font-semibold">Readiness criteria</p>
              <ReadinessChecklist result={r} compact />
            </PopoverContent>
          </Popover>
        );
      },
    },
    { id: 'owner', header: 'Responsible', accessorFn: (r) => lookups.personName(r.responsibleTeamMemberId) },
    { id: 'reservedFor', header: 'Reserved for', accessorFn: (r) => lookups.projectName(r.reservedForProjectId) },
    {
      id: 'lastAccessVerifiedDate', header: 'Time since verification', accessorFn: (r) => daysSince(r.lastAccessVerifiedDate) ?? 99999,
      cell: ({ row }) => {
        const since = daysSince(row.original.lastAccessVerifiedDate);
        return (
          <span className="flex flex-col">
            <span className="tabular">{since === null ? 'never verified' : `${since} days`}</span>
            <span className="text-[11px] text-muted-foreground">{formatDate(row.original.lastAccessVerifiedDate, '—')}</span>
          </span>
        );
      },
    },
    {
      id: 'operationalStatus', header: 'Operational', accessorKey: 'operationalStatus',
      cell: ({ row }) => <StatusBadge kind="accountOperational" value={row.original.operationalStatus} />,
    },
    {
      id: 'allocate', header: 'Allocate', enableSorting: false,
      cell: ({ row }) => (
        <Button
          size="sm"
          variant="outline"
          disabled={!can('assign:resources')}
          onClick={(e) => {
            e.stopPropagation();
            setAssignTarget(row.original.id);
            setAssignOpen(true);
          }}
        >
          <UserPlus /> Allocate
        </Button>
      ),
    },
  ], [lookups, readinessById, can]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reserve account inventory"
        description="A filtered view of the social account register — not a second copy. Suspended, restricted and closed accounts are never counted as available reserves."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Reserve Account"
              filename="reserve-accounts"
              columns={[
                { key: 'id', header: 'Account ID', value: (r) => r.id },
                { key: 'platform', header: 'Platform', value: (r) => lookups.platformName(r.platformId) },
                { key: 'username', header: 'Username', value: (r) => r.username },
                { key: 'assetType', header: 'Asset type', value: (r) => r.assetType },
                { key: 'brand', header: 'Brand', value: (r) => lookups.brandName(r.brandId) },
                { key: 'country', header: 'Target country', value: (r) => lookups.countryName(r.targetCountryCode) },
                { key: 'ready', header: 'Ready to assign', value: (r) => (readinessById.get(r.id)?.ready ? 'Yes' : 'No') },
                { key: 'gaps', header: 'Unmet criteria', value: (r) => (readinessById.get(r.id)?.failed ?? []).map((f) => f.label).join('; ') },
                { key: 'owner', header: 'Responsible employee', value: (r) => lookups.personName(r.responsibleTeamMemberId) },
                { key: 'reservedFor', header: 'Reserved for project', value: (r) => lookups.projectName(r.reservedForProjectId) },
                { key: 'lastAccessVerifiedDate', header: 'Last access verified', value: (r) => r.lastAccessVerifiedDate },
              ]}
            />
            <Button size="sm" onClick={() => { setAssignTarget(undefined); setAssignOpen(true); }} disabled={!can('assign:resources')}>
              <UserPlus /> Allocate account
            </Button>
          </>
        }
      />

      <KpiGrid>
        <KpiCard label="Reserve accounts" value={reserves.length} hint="Excludes suspended and restricted" />
        <KpiCard label="Ready to assign" value={readyCount} tone="success" to="/reserves?readiness=ready" />
        <KpiCard label="Missing required setup" value={missingSetup.length} tone="danger" to="/reserves?readiness=missing-setup" hint="Ownership, credential or recovery gap" />
        <KpiCard label="Reserved for an upcoming project" value={reservedForProject.length} tone="info" to="/reserves?project=any" />
        <KpiCard
          label={`Verification older than ${DEFAULT_THRESHOLDS.accessVerificationWindowDays} days`}
          value={staleVerification.length}
          tone="warning"
          to="/reserves?verified=stale"
        />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <SectionCard title="Reserve count by platform">
          <ul className="flex flex-col gap-1">
            {Object.entries(byPlatform).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => set({ platform: name })}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[13px] hover:bg-muted"
                >
                  <span>{name}</span>
                  <span className="tabular font-medium">{count}</span>
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard
          title="What counts as ready to assign"
          description="These criteria are applied identically here, on the dashboard and on each account page."
        >
          <ol className="flex flex-col gap-1.5 text-[13px]">
            {[
              'Operational status is Active.',
              'Allocation status is Reserved.',
              'No active assignment exists.',
              'Ownership is documented (a responsible employee is set).',
              'A credential vault reference exists.',
              'A recovery method and reference exist.',
              `Access verification is within ${DEFAULT_THRESHOLDS.accessVerificationWindowDays} days (configurable).`,
            ].map((line, i) => (
              <li key={line} className="flex gap-2">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-foreground">{i + 1}</span>
                {line}
              </li>
            ))}
          </ol>
          <p className="mt-3 flex items-start gap-1.5 text-[12px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            The verification window is a configurable threshold. Changing it changes every readiness figure in the app.
          </p>
        </SectionCard>
      </div>

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="res-search" value={values.search} onChange={(v) => set({ search: v })} placeholder="Search handle, brand, platform…" className="min-w-[15rem] flex-1" />
        <FilterSelect id="res-platform" label="Platform" value={values.platform} onChange={(v) => set({ platform: v })}
          options={[{ value: 'all', label: 'All platforms' }, ...(data?.platforms ?? []).map((p) => ({ value: p.name, label: p.name }))]} />
        <FilterSelect id="res-brand" label="Brand" value={values.brand} onChange={(v) => set({ brand: v })}
          options={[{ value: 'all', label: 'All brands' }, ...(data?.brands ?? []).map((b) => ({ value: b.name, label: b.name }))]} />
        <FilterSelect id="res-readiness" label="Readiness" value={values.readiness} onChange={(v) => set({ readiness: v })}
          options={[
            { value: 'all', label: 'All' },
            { value: 'ready', label: 'Ready to assign' },
            { value: 'not-ready', label: 'Not ready' },
            { value: 'missing-setup', label: 'Missing required setup' },
          ]} />
        <FilterSelect id="res-project" label="Reserved for" value={values.project} onChange={(v) => set({ project: v })}
          options={[
            { value: 'all', label: 'All reserves' },
            { value: 'any', label: 'Any upcoming project' },
            ...(data?.projects ?? []).map((p) => ({ value: p.id, label: p.name })),
          ]} />
        <FilterSelect id="res-verified" label="Verification" value={values.verified} onChange={(v) => set({ verified: v })}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'stale', label: `Older than ${DEFAULT_THRESHOLDS.accessVerificationWindowDays} days` },
            { value: 'never', label: 'Never verified' },
          ]} />
      </FilterBar>

      <DataTable
        tableId="reserves"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRetry={() => refetch()}
        onRowClick={(r) => navigate(`/accounts/${r.id}`)}
        initialSorting={[{ id: 'readiness', desc: false }]}
        emptyTitle="No reserve accounts match"
        emptyDescription="Reserve inventory only shows accounts whose allocation status is Reserved and whose operational status is not suspended, restricted or closed."
      />

      <AssignDrawer
        open={assignOpen}
        onOpenChange={setAssignOpen}
        resourceType="Social Account"
        resourceId={assignTarget}
        lockResource={Boolean(assignTarget)}
      />
    </div>
  );
}
