import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Plus } from 'lucide-react';
import { PageHeader, StatusBadge, ErrorState, RecordLink, SectionCard, Measured } from '@/components/common/bits';
import { DataTable } from '@/components/common/DataTable';
import { ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { AccountFormDialog } from '@/features/accounts/AccountFormDialog';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import {
  DEFAULT_THRESHOLDS, accountAwaitingVerification, accountMissingCredential,
  accountMissingOwner, accountUnderReviewOrRestricted, duplicateAccounts, simFanOutReview,
} from '@/lib/rules';
import { ACCOUNT_ALLOCATION_STATUS, ACCOUNT_OPERATIONAL_STATUS, type SocialAccount } from '@/lib/types';
import { compactNumber, daysSince, formatDate } from '@/lib/utils';

const DEFAULTS = {
  search: '', platform: 'all', op: 'all', alloc: 'all', brand: 'all',
  country: 'all', asset: 'all', flag: 'all', sim: '',
};

export default function AccountsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS);
  const { can } = useSession();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = React.useState(false);

  const accounts = React.useMemo(() => (data?.socialAccounts ?? []).filter((a) => !a.archived), [data]);

  const duplicates = React.useMemo(
    () => (data ? duplicateAccounts(accounts, lookups.platformName) : []),
    [accounts, data, lookups],
  );
  const duplicateIds = React.useMemo(
    () => new Set(duplicates.flatMap((g) => g.records.map((r) => r.id))),
    [duplicates],
  );
  const fanOut = React.useMemo(() => simFanOutReview(accounts), [accounts]);
  const fanOutAccountIds = React.useMemo(() => new Set(fanOut.flatMap((f) => f.accounts.map((a) => a.id))), [fanOut]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return accounts.filter((a) => {
      if (values.platform !== 'all' && a.platformId !== values.platform) return false;
      if (values.op !== 'all' && a.operationalStatus !== values.op) return false;
      if (values.alloc !== 'all' && a.allocationStatus !== values.alloc) return false;
      if (values.brand !== 'all' && a.brandId !== values.brand) return false;
      if (values.country !== 'all' && a.targetCountryCode !== values.country) return false;
      if (values.asset !== 'all' && a.assetType !== values.asset) return false;
      if (values.sim && !a.simIds.includes(values.sim)) return false;
      if (values.flag === 'review' && !accountUnderReviewOrRestricted(a)) return false;
      if (values.flag === 'no-owner' && !accountMissingOwner(a)) return false;
      if (values.flag === 'no-credential' && !accountMissingCredential(a)) return false;
      if (values.flag === 'awaiting-verification' && !accountAwaitingVerification(a)) return false;
      if (values.flag === 'duplicates' && !duplicateIds.has(a.id)) return false;
      if (values.flag === 'shared-sim' && !fanOutAccountIds.has(a.id)) return false;
      if (needle) {
        const hay = [a.id, a.username, a.displayName, a.platformAccountId, a.profileUrl, lookups.brandName(a.brandId),
          lookups.personName(a.responsibleTeamMemberId), a.notes].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [accounts, values, lookups, duplicateIds, fanOutAccountIds]);

  const columns = React.useMemo<ColumnDef<SocialAccount, unknown>[]>(() => [
    { id: 'id', header: 'Account ID', accessorKey: 'id', cell: ({ row }) => <RecordLink to={`/accounts/${row.original.id}`}>{row.original.id}</RecordLink> },
    { id: 'platform', header: 'Platform', accessorFn: (r) => lookups.platformName(r.platformId) },
    { id: 'assetType', header: 'Asset type', accessorKey: 'assetType' },
    {
      id: 'username', header: 'Handle', accessorKey: 'username',
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <span className="font-medium">@{row.original.username}</span>
          {duplicateIds.has(row.original.id) && <Badge tone="danger">duplicate</Badge>}
        </span>
      ),
    },
    { id: 'displayName', header: 'Display name', accessorKey: 'displayName' },
    { id: 'platformAccountId', header: 'Platform ID', accessorKey: 'platformAccountId' },
    { id: 'brand', header: 'Brand', accessorFn: (r) => lookups.brandName(r.brandId) },
    { id: 'country', header: 'Target country', accessorFn: (r) => lookups.countryName(r.targetCountryCode) },
    { id: 'contentLanguage', header: 'Language', accessorKey: 'contentLanguage' },
    {
      id: 'owner', header: 'Responsible', accessorFn: (r) => lookups.personName(r.responsibleTeamMemberId),
      cell: ({ row }) => row.original.responsibleTeamMemberId
        ? lookups.personName(row.original.responsibleTeamMemberId)
        : <Badge tone="danger">no owner</Badge>,
    },
    {
      id: 'credential', header: 'Credential ref', accessorFn: (r) => r.credentialId ?? '',
      cell: ({ row }) => row.original.credentialId
        ? <span className="text-[12px]">{row.original.credentialId}</span>
        : <Badge tone="warning">missing</Badge>,
    },
    {
      id: 'twoFa', header: '2FA', accessorFn: (r) => (r.twoFaEnabled ? r.twoFaMethod : 'Off'),
      cell: ({ row }) => row.original.twoFaEnabled
        ? <Badge tone="success">{row.original.twoFaMethod}</Badge>
        : <Badge tone="warning">off</Badge>,
    },
    {
      id: 'operationalStatus', header: 'Operational', accessorKey: 'operationalStatus',
      cell: ({ row }) => <StatusBadge kind="accountOperational" value={row.original.operationalStatus} />,
    },
    {
      id: 'allocationStatus', header: 'Allocation', accessorKey: 'allocationStatus',
      cell: ({ row }) => <StatusBadge kind="accountAllocation" value={row.original.allocationStatus} />,
    },
    {
      id: 'sims', header: 'Linked SIMs', accessorFn: (r) => r.simIds.length, enableSorting: true,
      cell: ({ row }) => {
        if (!row.original.simIds.length) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="flex items-center gap-1.5">
            <RecordLink to={`/sims/${row.original.simIds[0]}`}>{row.original.simIds[0]}</RecordLink>
            {fanOutAccountIds.has(row.original.id) && <Badge tone="warning">shared</Badge>}
          </span>
        );
      },
    },
    {
      id: 'lastAccessVerifiedDate', header: 'Access verified', accessorKey: 'lastAccessVerifiedDate',
      cell: ({ row }) => {
        const since = daysSince(row.original.lastAccessVerifiedDate);
        return (
          <span className="flex flex-col">
            <span className="tabular">{formatDate(row.original.lastAccessVerifiedDate, 'never')}</span>
            <span className={`text-[11px] ${since === null || since > DEFAULT_THRESHOLDS.accessVerificationWindowDays ? 'text-warning' : 'text-muted-foreground'}`}>
              {since === null ? 'not verified' : `${since} days ago`}
            </span>
          </span>
        );
      },
    },
    { id: 'lastPostingDate', header: 'Last posted', accessorKey: 'lastPostingDate', cell: ({ row }) => <span className="tabular">{formatDate(row.original.lastPostingDate)}</span> },
    {
      id: 'followerCount', header: 'Followers', accessorKey: 'followerCount',
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="tabular">{compactNumber(row.original.followerCount)}</span>
          <Measured date={row.original.followerCountMeasuredAt} />
        </span>
      ),
    },
  ], [lookups, duplicateIds, fanOutAccountIds]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Marketing social media accounts"
        description="Every platform asset in one register. Operational status and allocation status are tracked separately, and follower counts are manual entries carrying their own measurement date — there is no live platform sync."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Social Account"
              filename="social-accounts"
              columns={[
                { key: 'id', header: 'Account ID', value: (r) => r.id },
                { key: 'platform', header: 'Platform', value: (r) => lookups.platformName(r.platformId) },
                { key: 'platformAccountId', header: 'Platform account ID', value: (r) => r.platformAccountId },
                { key: 'assetType', header: 'Asset type', value: (r) => r.assetType },
                { key: 'displayName', header: 'Display name', value: (r) => r.displayName },
                { key: 'username', header: 'Username', value: (r) => r.username },
                { key: 'profileUrl', header: 'Profile URL', value: (r) => r.profileUrl },
                { key: 'brand', header: 'Brand', value: (r) => lookups.brandName(r.brandId) },
                { key: 'project', header: 'Project', value: (r) => lookups.projectName(r.projectId) },
                { key: 'country', header: 'Target country', value: (r) => lookups.countryName(r.targetCountryCode) },
                { key: 'contentLanguage', header: 'Content language', value: (r) => r.contentLanguage },
                { key: 'owner', header: 'Responsible employee', value: (r) => lookups.personName(r.responsibleTeamMemberId) },
                { key: 'loginEmailRef', header: 'Login email reference', value: (r) => r.loginEmailRef, sensitive: true, masked: () => '[masked]' },
                { key: 'credentialRefPresent', header: 'Credential reference present', value: (r) => (r.credentialId ? 'Yes' : 'No') },
                { key: 'twoFaEnabled', header: '2FA enabled', value: (r) => (r.twoFaEnabled ? 'Yes' : 'No') },
                { key: 'operationalStatus', header: 'Operational status', value: (r) => r.operationalStatus },
                { key: 'allocationStatus', header: 'Allocation status', value: (r) => r.allocationStatus },
                { key: 'simIds', header: 'Linked SIMs', value: (r) => r.simIds.join('; ') },
                { key: 'lastAccessVerifiedDate', header: 'Last access verified', value: (r) => r.lastAccessVerifiedDate },
                { key: 'lastPostingDate', header: 'Last posting date', value: (r) => r.lastPostingDate },
                { key: 'followerCount', header: 'Follower count', value: (r) => r.followerCount },
                { key: 'followerCountMeasuredAt', header: 'Follower count measured on', value: (r) => r.followerCountMeasuredAt },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
              ]}
            />
            <Button size="sm" onClick={() => setFormOpen(true)} disabled={!can('edit:resources')}>
              <Plus /> Add account
            </Button>
          </>
        }
      />

      {(duplicates.length > 0 || fanOut.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {duplicates.length > 0 && (
            <SectionCard
              title={`${duplicates.length} duplicate group${duplicates.length === 1 ? '' : 's'} flagged`}
              description="Duplicate platform IDs and duplicate platform/username combinations."
              actions={<Button variant="outline" size="sm" onClick={() => set({ flag: 'duplicates' })}>Show only these</Button>}
            >
              <ul className="flex flex-col gap-1.5">
                {duplicates.map((g) => (
                  <li key={g.key} className="rounded-md border border-danger/40 bg-danger-bg/40 px-2.5 py-1.5 text-[12px]">
                    <span className="font-medium">{g.label}</span>
                    <span className="ml-2 text-muted-foreground">{g.records.map((r) => r.id).join(', ')}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
          {fanOut.length > 0 && (
            <SectionCard
              title="Unusual SIM associations"
              description={`A number linked to more than ${DEFAULT_THRESHOLDS.simFanOutReviewThreshold} accounts. Shared numbers are normal — these are flagged for a human look, not rejected.`}
              actions={<Button variant="outline" size="sm" onClick={() => set({ flag: 'shared-sim' })}>Show only these</Button>}
            >
              <ul className="flex flex-col gap-1.5">
                {fanOut.map((f) => (
                  <li key={f.simId} className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning-bg/40 px-2.5 py-1.5 text-[12px]">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                    <span className="font-medium">{f.simId}</span>
                    <span className="text-muted-foreground">linked to {f.accounts.length} accounts</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </div>
      )}

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="acc-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search handle, display name, platform ID, owner…" className="min-w-[16rem] flex-1" />
        <FilterSelect id="acc-platform" label="Platform" value={values.platform} onChange={(v) => set({ platform: v })}
          options={[{ value: 'all', label: 'All platforms' }, ...(data?.platforms ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <FilterSelect id="acc-op" label="Operational" value={values.op} onChange={(v) => set({ op: v })}
          options={[{ value: 'all', label: 'All' }, ...ACCOUNT_OPERATIONAL_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="acc-alloc" label="Allocation" value={values.alloc} onChange={(v) => set({ alloc: v })}
          options={[{ value: 'all', label: 'All' }, ...ACCOUNT_ALLOCATION_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="acc-brand" label="Brand" value={values.brand} onChange={(v) => set({ brand: v })}
          options={[{ value: 'all', label: 'All brands' }, ...(data?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))]} />
        <FilterSelect id="acc-country" label="Country" value={values.country} onChange={(v) => set({ country: v })}
          options={[{ value: 'all', label: 'All countries' }, ...(data?.countries ?? []).map((c) => ({ value: c.code, label: c.name }))]} />
        <FilterSelect id="acc-flag" label="Data quality" value={values.flag} onChange={(v) => set({ flag: v })}
          options={[
            { value: 'all', label: 'No flag filter' },
            { value: 'review', label: 'Under review or restricted' },
            { value: 'no-owner', label: 'Missing an owner' },
            { value: 'no-credential', label: 'Missing credential reference' },
            { value: 'awaiting-verification', label: 'Awaiting access verification' },
            { value: 'duplicates', label: 'Duplicates' },
            { value: 'shared-sim', label: 'Unusual SIM association' },
          ]} />
      </FilterBar>

      {values.sim && (
        <p className="text-[13px] text-muted-foreground">
          Filtered to accounts linked to SIM <span className="font-medium text-foreground">{values.sim}</span>.{' '}
          <button className="text-primary hover:underline" onClick={() => set({ sim: '' })}>Remove this filter</button>
        </p>
      )}

      <DataTable
        tableId="accounts"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRetry={() => refetch()}
        onRowClick={(r) => navigate(`/accounts/${r.id}`)}
        initialSorting={[{ id: 'id', desc: false }]}
        initialHidden={['platformAccountId', 'contentLanguage', 'lastPostingDate', 'displayName']}
        emptyTitle="No accounts match"
      />

      <AccountFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
