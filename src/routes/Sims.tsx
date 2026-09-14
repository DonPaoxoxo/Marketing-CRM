import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { CopyCheck, Plus, Upload } from 'lucide-react';
import { PageHeader, StatusBadge, ErrorState, SectionCard, RecordLink, SafeExternalLink } from '@/components/common/bits';
import { telegramUrl } from '@/lib/identity';
import { DataTable } from '@/components/common/DataTable';
import { ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { SimFormDialog } from '@/features/sims/SimFormDialog';
import { SimBulkUploadDialog } from '@/features/sims/SimBulkUploadDialog';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { DEFAULT_THRESHOLDS, duplicatePhoneNumbers, simApproachingRenewal } from '@/lib/rules';
import { ALLOCATION_STATUS, SIM_OPERATIONAL_STATUS, type Sim } from '@/lib/types';
import { daysUntil, formatDate, maskEmail, maskPhone, normalizePhone, relativeDays } from '@/lib/utils';

const DEFAULTS = { search: '', op: 'all', alloc: 'all', country: 'all', form: 'all', expiry: 'all' };

export default function SimsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS);
  const { can, showContactDetails: showContact } = useSession();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const sims = React.useMemo(() => (data?.sims ?? []).filter((s) => !s.archived), [data]);

  const accountsBySim = React.useMemo(() => {
    const map = new Map<string, string[]>();
    (data?.socialAccounts ?? []).forEach((a) => a.simIds.forEach((sid) => map.set(sid, [...(map.get(sid) ?? []), a.id])));
    return map;
  }, [data]);

  const duplicates = React.useMemo(() => duplicatePhoneNumbers(sims), [sims]);
  const duplicateNumbers = React.useMemo(() => new Set(duplicates.map((d) => d.key)), [duplicates]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    const digits = normalizePhone(values.search);
    return sims.filter((s) => {
      if (values.op !== 'all' && s.operationalStatus !== values.op) return false;
      if (values.alloc !== 'all' && s.allocationStatus !== values.alloc) return false;
      if (values.country !== 'all' && s.countryCode !== values.country) return false;
      if (values.form !== 'all' && s.form !== values.form) return false;
      if (values.expiry === 'due' && !simApproachingRenewal(s)) return false;
      if (values.expiry === 'expired') {
        const d = daysUntil(s.planExpiryDate);
        if (d === null || d >= 0) return false;
      }
      if (values.expiry === 'duplicates' && !duplicateNumbers.has(s.phoneNumber)) return false;
      if (needle) {
        const hay = [
          s.id, s.phoneNumber, s.provider, lookups.brandName(s.brandId), lookups.personName(s.assigneeId), s.notes,
          s.createdFor, s.telegramUsername, s.telegramUsername && `@${s.telegramUsername}`, telegramUrl(s.telegramUsername),
          // Matched only for roles that may see it, so a masked address cannot be
          // confirmed by searching for it.
          showContact ? s.email : '',
        ].join(' ').toLowerCase();
        if (!hay.includes(needle) && !(digits.length > 3 && s.phoneNumber.includes(digits))) return false;
      }
      return true;
    });
  }, [sims, values, lookups, duplicateNumbers, showContact]);

  const columns = React.useMemo<ColumnDef<Sim, unknown>[]>(() => [
    {
      id: 'id', header: 'SIM ID', accessorKey: 'id',
      cell: ({ row }) => <RecordLink to={`/sims/${row.original.id}`}>{row.original.id}</RecordLink>,
    },
    {
      id: 'phoneNumber', header: 'Phone number', accessorKey: 'phoneNumber',
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5 tabular">
          {showContact ? row.original.phoneNumber : maskPhone(row.original.phoneNumber)}
          {duplicateNumbers.has(row.original.phoneNumber) && <Badge tone="danger">duplicate</Badge>}
        </span>
      ),
    },
    { id: 'country', header: 'Country', accessorFn: (r) => lookups.countryName(r.countryCode) },
    { id: 'provider', header: 'Provider', accessorKey: 'provider' },
    { id: 'form', header: 'Type', accessorKey: 'form' },
    {
      id: 'createdFor', header: 'Created for', accessorKey: 'createdFor',
      cell: ({ row }) => row.original.createdFor || <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'email', header: 'Email', accessorKey: 'email',
      cell: ({ row }) => (row.original.email
        ? <span>{showContact ? row.original.email : maskEmail(row.original.email)}</span>
        : <span className="text-muted-foreground">—</span>),
    },
    {
      id: 'telegramUsername', header: 'Telegram', accessorKey: 'telegramUsername',
      // A link straight to the Telegram profile; the click opens it rather than the SIM.
      cell: ({ row }) => (row.original.telegramUsername
        ? (
          <span onClick={(e) => e.stopPropagation()}>
            <SafeExternalLink href={telegramUrl(row.original.telegramUsername)} className="whitespace-nowrap break-normal">{telegramUrl(row.original.telegramUsername)}</SafeExternalLink>
          </span>
        )
        : <span className="text-muted-foreground">—</span>),
    },
    {
      id: 'assignee', header: 'Assigned to',
      accessorFn: (r) => lookups.personName(r.assigneeId),
      cell: ({ row }) => (
        <span>
          {lookups.personName(row.original.assigneeId)}
          {row.original.assigneeType && (
            <span className="ml-1 text-[11px] text-muted-foreground">({row.original.assigneeType})</span>
          )}
        </span>
      ),
    },
    { id: 'brand', header: 'Brand', accessorFn: (r) => lookups.brandName(r.brandId) },
    {
      id: 'operationalStatus', header: 'Operational', accessorKey: 'operationalStatus',
      cell: ({ row }) => <StatusBadge kind="simOperational" value={row.original.operationalStatus} />,
    },
    {
      id: 'allocationStatus', header: 'Allocation', accessorKey: 'allocationStatus',
      cell: ({ row }) => <StatusBadge kind="allocation" value={row.original.allocationStatus} />,
    },
    {
      id: 'linkedAccounts', header: 'Linked accounts',
      accessorFn: (r) => accountsBySim.get(r.id)?.length ?? 0,
      cell: ({ row }) => {
        const n = accountsBySim.get(row.original.id)?.length ?? 0;
        if (!n) return <span className="text-muted-foreground">—</span>;
        return (
          <RecordLink to={`/accounts?sim=${row.original.id}`}>
            {n} account{n === 1 ? '' : 's'}
          </RecordLink>
        );
      },
    },
    {
      id: 'planExpiryDate', header: 'Expiry / renewal', accessorKey: 'planExpiryDate',
      cell: ({ row }) => {
        const d = daysUntil(row.original.planExpiryDate);
        if (d === null) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="flex flex-col">
            <span className="tabular">{formatDate(row.original.planExpiryDate)}</span>
            <span className={`text-[11px] ${d < 0 ? 'text-danger' : d <= DEFAULT_THRESHOLDS.simRenewalWindowDays ? 'text-warning' : 'text-muted-foreground'}`}>
              {relativeDays(d)}
            </span>
          </span>
        );
      },
    },
    {
      id: 'lastVerifiedDate', header: 'Last verified', accessorKey: 'lastVerifiedDate',
      cell: ({ row }) => <span className="tabular">{formatDate(row.original.lastVerifiedDate)}</span>,
    },
    { id: 'notes', header: 'Notes', accessorKey: 'notes', enableSorting: false },
  ], [lookups, accountsBySim, duplicateNumbers, showContact]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="SIM and phone number register"
        description="Search by full number, check for duplicates, filter by expiry, and follow links through to the accounts each number supports."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="SIM"
              filename="sims"
              columns={[
                { key: 'id', header: 'SIM ID', value: (r) => r.id },
                { key: 'phoneNumber', header: 'Phone number', value: (r) => r.phoneNumber, sensitive: true, masked: (r) => maskPhone(r.phoneNumber) },
                { key: 'countryCode', header: 'Country', value: (r) => lookups.countryName(r.countryCode) },
                { key: 'provider', header: 'Provider', value: (r) => r.provider },
                { key: 'form', header: 'SIM type', value: (r) => r.form },
                { key: 'createdFor', header: 'Created For', value: (r) => r.createdFor },
                { key: 'email', header: 'Email', value: (r) => r.email, sensitive: true, masked: (r) => (r.email ? maskEmail(r.email) : '') },
                { key: 'telegramUsername', header: 'Telegram', value: (r) => telegramUrl(r.telegramUsername) },
                { key: 'assignee', header: 'Assigned to', value: (r) => lookups.personName(r.assigneeId) },
                { key: 'brand', header: 'Brand', value: (r) => lookups.brandName(r.brandId) },
                { key: 'operationalStatus', header: 'Operational status', value: (r) => r.operationalStatus },
                { key: 'allocationStatus', header: 'Allocation status', value: (r) => r.allocationStatus },
                { key: 'linkedAccounts', header: 'Linked accounts', value: (r) => (accountsBySim.get(r.id) ?? []).join('; ') },
                { key: 'planExpiryDate', header: 'Expiry date', value: (r) => r.planExpiryDate },
                { key: 'lastVerifiedDate', header: 'Last verified', value: (r) => r.lastVerifiedDate },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
              ]}
            />
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} disabled={!can('import:records')}
              title={can('import:records') ? 'Add many SIMs from an Excel file' : 'Your role cannot import records.'}>
              <Upload /> Bulk upload
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)} disabled={!can('edit:resources')}
              title={can('edit:resources') ? undefined : 'Your role cannot edit resources.'}>
              <Plus /> Add SIM
            </Button>
          </>
        }
      />

      {duplicates.length > 0 && (
        <SectionCard
          title={`${duplicates.length} duplicate number${duplicates.length === 1 ? '' : 's'} detected`}
          description="The same number appears on more than one SIM record. Review and merge or retire the stale record."
          actions={
            <Button variant="outline" size="sm" onClick={() => set({ expiry: 'duplicates' })}>
              <CopyCheck /> Show only duplicates
            </Button>
          }
        >
          <ul className="flex flex-wrap gap-2">
            {duplicates.map((g) => (
              <li key={g.key} className="rounded-md border border-danger/40 bg-danger-bg/40 px-2.5 py-1.5 text-[12px]">
                <span className="font-medium tabular">{showContact ? g.key : maskPhone(g.key)}</span>
                <span className="ml-2 text-muted-foreground">{g.records.map((r) => r.id).join(', ')}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput
          id="sims-search"
          value={values.search}
          onChange={(v) => set({ search: v })}
          placeholder="Search number, SIM ID, provider, brand…"
          className="min-w-[16rem] flex-1"
        />
        <FilterSelect id="sims-op" label="Operational" value={values.op} onChange={(v) => set({ op: v })}
          options={[{ value: 'all', label: 'All statuses' }, ...SIM_OPERATIONAL_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="sims-alloc" label="Allocation" value={values.alloc} onChange={(v) => set({ alloc: v })}
          options={[{ value: 'all', label: 'All' }, ...ALLOCATION_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="sims-country" label="Country" value={values.country} onChange={(v) => set({ country: v })}
          options={[{ value: 'all', label: 'All countries' }, ...(data?.countries ?? []).map((c) => ({ value: c.code, label: c.name }))]} />
        <FilterSelect id="sims-form" label="SIM type" value={values.form} onChange={(v) => set({ form: v })}
          options={[{ value: 'all', label: 'All' }, { value: 'Physical SIM', label: 'Physical SIM' }, { value: 'eSIM', label: 'eSIM' }]} />
        <FilterSelect id="sims-expiry" label="Expiry" value={values.expiry} onChange={(v) => set({ expiry: v })}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'due', label: `Due within ${DEFAULT_THRESHOLDS.simRenewalWindowDays} days` },
            { value: 'expired', label: 'Already expired' },
            { value: 'duplicates', label: 'Duplicate numbers' },
          ]} />
      </FilterBar>

      <DataTable
        tableId="sims"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRetry={() => refetch()}
        onRowClick={(r) => navigate(`/sims/${r.id}`)}
        initialSorting={[{ id: 'id', desc: false }]}
        initialHidden={['notes', 'form']}
        emptyTitle="No SIM records match"
        emptyDescription="Adjust the filters above, or register a new SIM."
      />

      <SimFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <SimBulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} />
    </div>
  );
}
