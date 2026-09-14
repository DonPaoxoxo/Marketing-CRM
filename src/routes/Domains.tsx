import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, Clock, History, OctagonAlert, Pencil, Plus, RotateCw, Upload } from 'lucide-react';
import { PageHeader, StatusBadge, ErrorState, SectionCard } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmWithReason, ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { Button } from '@/components/ui/button';
import { Badge, Input, Label } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { DomainFormDialog } from '@/features/domains/DomainFormDialog';
import { DomainBulkUploadDialog } from '@/features/domains/DomainBulkUploadDialog';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { DOMAIN_EXPIRY_LABELS, domainExpiryBucket, type DomainExpiryBucket } from '@/lib/rules';
import { DOMAIN_COUNTRY, DOMAIN_STATUS, type DomainRecord } from '@/lib/types';
import { daysUntil, formatDate, relativeDays, toISODate } from '@/lib/utils';

const DEFAULTS = { search: '', country: 'all', status: 'all', expiration: 'all', counts: 'filtered', view: 'active' };

/** Rotation is recorded through its own dialog so the previous value lands in the audit trail. */
function RotationDialog({ domain, open, onOpenChange }: { domain?: DomainRecord; open: boolean; onOpenChange: (v: boolean) => void }) {
  const update = useUpdate<DomainRecord>('domains', 'Domain');
  const [date, setDate] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setDate(toISODate(new Date()));
      setReason('');
    }
  }, [open]);

  if (!domain) return null;
  const invalid = Boolean(date) && date < domain.registeredDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Record a rotation for {domain.domainName}</DialogTitle>
          <DialogDescription>
            The previous rotation date ({domain.rotationDate ? formatDate(domain.rotationDate) : 'Not rotated'}) is kept
            in the audit history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rot-date">New rotation date</Label>
            <Input id="rot-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={invalid || undefined} />
            {invalid && <p className="text-[12px] font-medium text-danger">A rotation cannot predate registration ({formatDate(domain.registeredDate)}).</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rot-reason">Reason</Label>
            <Input id="rot-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Scheduled rotation" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!date || invalid}
            onClick={async () => {
              await update.mutateAsync({ id: domain.id, rotationDate: date, reason: reason.trim() || 'Rotation date updated' });
              onOpenChange(false);
            }}
          >
            Record rotation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function DomainsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  // `view` lives in the address so a refresh keeps you on Archived, but it is not a filter.
  const { values, set, clear, activeCount } = useFilters(DEFAULTS, { notFilters: ['view'] });
  const { can } = useSession();
  const showArchived = values.view === 'archived';
  const [archiving, setArchiving] = React.useState<DomainRecord | undefined>();
  const [restoring, setRestoring] = React.useState<DomainRecord | undefined>();
  const update = useUpdate<DomainRecord>('domains', 'Domain');
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DomainRecord | undefined>();
  const [rotating, setRotating] = React.useState<DomainRecord | undefined>();
  const [rotateOpen, setRotateOpen] = React.useState(false);
  const [historyFor, setHistoryFor] = React.useState<DomainRecord | undefined>();
  const [bulkOpen, setBulkOpen] = React.useState(false);

  const activeTotal = (data?.domains ?? []).filter((d) => !d.archived).length;
  const archivedTotal = (data?.domains ?? []).length - activeTotal;
  const domains = React.useMemo(() => (data?.domains ?? []).filter((d) => d.archived === showArchived), [data, showArchived]);

  // When, by whom and why each domain was archived: its latest archive entry in the history.
  const archivedBy = React.useMemo(() => {
    const map = new Map<string, { timestamp: string; actorName: string; reason: string }>();
    for (const e of data?.auditEntries ?? []) {
      if (e.recordType !== 'Domain' || e.action !== 'archive') continue;
      const known = map.get(e.recordId);
      if (!known || e.timestamp > known.timestamp) map.set(e.recordId, { timestamp: e.timestamp, actorName: e.actorName, reason: e.reason });
    }
    return map;
  }, [data]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return domains.filter((d) => {
      if (values.country !== 'all' && d.targetCountry !== values.country) return false;
      if (values.status !== 'all' && d.status !== values.status) return false;
      if (values.expiration !== 'all') {
        const n = daysUntil(d.expirationDate);
        if (values.expiration === 'expired' && !(n !== null && n < 0)) return false;
        if (values.expiration === 'expiring-7' && !(n !== null && n >= 0 && n <= 7)) return false;
        if (values.expiration === 'expiring-30' && !(n !== null && n >= 0 && n <= 30)) return false;
      }
      if (needle && !d.domainName.includes(needle) && !d.registrar.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [domains, values]);

  // Cards are computed from the same array the table renders — the toggle only
  // decides whether that array is the filtered set or the whole register.
  const countBase = values.counts === 'all' ? domains : filtered;
  const summary = React.useMemo(() => ({
    total: countBase.length,
    india: countBase.filter((d) => d.targetCountry === 'India').length,
    indonesia: countBase.filter((d) => d.targetCountry === 'Indonesia').length,
    available: countBase.filter((d) => d.targetCountry === 'Available').length,
    active: countBase.filter((d) => d.status === 'Active').length,
    inactive: countBase.filter((d) => d.status === 'Inactive').length,
    expiring30: countBase.filter((d) => {
      const n = daysUntil(d.expirationDate);
      return n !== null && n >= 0 && n <= 30;
    }).length,
  }), [countBase]);

  const openEdit = (d: DomainRecord) => { setEditing(d); setFormOpen(true); };

  // One stack per country, split by expiry severity. Built from `countBase` so the
  // chart, the cards and the table always describe the same set of records.
  const expirySeries = React.useMemo(() => {
    const buckets: { bucket: DomainExpiryBucket; label: string; status: 'critical' | 'serious' | 'warning' | 'good'; icon: React.ReactNode }[] = [
      { bucket: 'expired', label: 'Expired', status: 'critical', icon: <OctagonAlert className="h-3 w-3" /> },
      { bucket: 'expiring-7', label: 'Within 7 days', status: 'serious', icon: <AlertTriangle className="h-3 w-3" /> },
      { bucket: 'expiring-30', label: 'Within 30 days', status: 'warning', icon: <Clock className="h-3 w-3" /> },
      { bucket: 'healthy', label: 'Not due soon', status: 'good', icon: <CheckCircle2 className="h-3 w-3" /> },
    ];
    return buckets.map((b) => ({
      label: b.label,
      status: b.status,
      icon: b.icon,
      values: DOMAIN_COUNTRY.map(
        (country) => countBase.filter((d) => d.targetCountry === country && domainExpiryBucket(d) === b.bucket).length,
      ),
    }));
  }, [countBase]);

  const columns = React.useMemo<ColumnDef<DomainRecord, unknown>[]>(() => [
    {
      id: 'domainName', header: 'Domain Name', accessorKey: 'domainName',
      cell: ({ row }) => {
        const bucket = domainExpiryBucket(row.original);
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{row.original.domainName}</span>
            {bucket === 'expired' && <Badge tone="danger">expired</Badge>}
            {bucket === 'expiring-7' && <Badge tone="danger">expires in ≤7 days</Badge>}
            {bucket === 'expiring-30' && <Badge tone="warning">expires in ≤30 days</Badge>}
          </span>
        );
      },
    },
    { id: 'targetCountry', header: 'Target Country', accessorKey: 'targetCountry' },
    {
      id: 'registrar', header: 'Registrar', accessorKey: 'registrar',
      cell: ({ row }) => row.original.registrar || <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'registrarUid', header: 'UID', accessorKey: 'registrarUid',
      cell: ({ row }) => row.original.registrarUid ? <span className="tabular">{row.original.registrarUid}</span> : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'category', header: 'Category', accessorKey: 'category',
      cell: ({ row }) => row.original.category || <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'nameservers', header: 'Nameservers', accessorKey: 'nameservers', enableSorting: false,
      cell: ({ row }) => row.original.nameservers
        ? (
          <span className="flex flex-col text-[12px]">
            {row.original.nameservers.split(',').map((ns) => <span key={ns}>{ns}</span>)}
          </span>
        )
        : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'rotationDate', header: 'Rotation Date', accessorKey: 'rotationDate',
      cell: ({ row }) =>
        row.original.rotationDate
          ? <span className="tabular">{formatDate(row.original.rotationDate)}</span>
          : <span className="text-muted-foreground">Not rotated</span>,
    },
    {
      id: 'registeredDate', header: 'Registered', accessorKey: 'registeredDate',
      cell: ({ row }) => <span className="tabular">{formatDate(row.original.registeredDate)}</span>,
    },
    {
      id: 'expirationDate', header: 'Expiration', accessorKey: 'expirationDate',
      cell: ({ row }) => {
        const n = daysUntil(row.original.expirationDate);
        const bucket = domainExpiryBucket(row.original);
        return (
          <span className="flex flex-col">
            <span className="tabular">{formatDate(row.original.expirationDate)}</span>
            <span className={`text-[11px] ${bucket === 'expired' || bucket === 'expiring-7' ? 'text-danger' : bucket === 'expiring-30' ? 'text-warning' : 'text-muted-foreground'}`}>
              {relativeDays(n)}
            </span>
          </span>
        );
      },
    },
    {
      id: 'status', header: 'Status', accessorKey: 'status',
      cell: ({ row }) => <StatusBadge kind="domain" value={row.original.status} />,
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const d = row.original;
        if (d.archived) {
          const info = archivedBy.get(d.id);
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" disabled={!can('archive:records')} onClick={() => setRestoring(d)}>
                <ArchiveRestore /> Restore
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Audit history for ${d.domainName}`} onClick={() => setHistoryFor(d)}>
                <History />
              </Button>
              {info && <span className="sr-only">Archived {info.timestamp.slice(0, 10)} by {info.actorName}</span>}
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${d.domainName}`} disabled={!can('edit:resources')} onClick={() => openEdit(d)}>
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Record rotation for ${d.domainName}`} disabled={!can('edit:resources')}
              onClick={() => { setRotating(d); setRotateOpen(true); }}>
              <RotateCw />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Audit history for ${d.domainName}`} onClick={() => setHistoryFor(d)}>
              <History />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" disabled={!can('edit:resources')}>Status</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {DOMAIN_STATUS.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    disabled={s === d.status}
                    onSelect={() => update.mutate({ id: d.id, status: s, reason: `Status changed to ${s}` })}
                  >
                    Set {s}{s === d.status && ' (current)'}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button size="icon-sm" variant="ghost" aria-label={`Archive ${d.domainName}`} title="Archive" disabled={!can('archive:records')} onClick={() => setArchiving(d)}>
              <Archive />
            </Button>
          </div>
        );
      },
    },
    ...(showArchived ? [{
      id: 'archivedAt', header: 'Archived', enableSorting: false,
      cell: ({ row }: { row: { original: DomainRecord } }) => {
        const info = archivedBy.get(row.original.id);
        return info ? (
          <span className="flex max-w-[16rem] flex-col text-[12px]">
            <span className="tabular">{formatDate(info.timestamp.slice(0, 10))} · {info.actorName}</span>
            <span className="truncate text-muted-foreground" title={info.reason}>{info.reason}</span>
          </span>
        ) : <span className="text-muted-foreground">—</span>;
      },
    } satisfies ColumnDef<DomainRecord, unknown>] : []),
  ], [can, update, showArchived, archivedBy]);

  const domainAudit = React.useMemo(
    () => (data?.auditEntries ?? []).filter((a) => a.recordType === 'Domain' && a.recordId === historyFor?.id),
    [data, historyFor],
  );

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Domains"
        description="Domain register for India and Indonesia, plus Available domains not yet given to a country. Expired and soon-to-expire domains are highlighted; highlighting never changes a domain's Active or Inactive status on its own."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Domain"
              filename="domains"
              columns={[
                { key: 'id', header: 'Record ID', value: (r) => r.id },
                { key: 'domainName', header: 'Domain Name', value: (r) => r.domainName },
                { key: 'targetCountry', header: 'Target Country', value: (r) => r.targetCountry },
                { key: 'registrar', header: 'Registrar', value: (r) => r.registrar },
                { key: 'registrarUid', header: 'UID', value: (r) => r.registrarUid },
                { key: 'category', header: 'Category', value: (r) => r.category },
                { key: 'nameservers', header: 'Nameservers', value: (r) => r.nameservers },
                { key: 'rotationDate', header: 'Rotation Date', value: (r) => r.rotationDate ?? 'Not rotated' },
                { key: 'registeredDate', header: 'Registered', value: (r) => r.registeredDate },
                { key: 'expirationDate', header: 'Expiration', value: (r) => r.expirationDate },
                { key: 'expiryBucket', header: 'Expiry state', value: (r) => DOMAIN_EXPIRY_LABELS[domainExpiryBucket(r)] },
                { key: 'status', header: 'Status', value: (r) => r.status },
                { key: 'brand', header: 'Brand', value: (r) => lookups.brandName(r.brandId) },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
              ]}
            />
            {can('import:records') && (
              <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
                <Upload /> Bulk upload
              </Button>
            )}
            <Button size="sm" onClick={() => { setEditing(undefined); setFormOpen(true); }} disabled={!can('edit:resources')}>
              <Plus /> Add domain
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">
            {values.counts === 'all'
              ? `Counts below reflect all ${domains.length} domains, ignoring the filters.`
              : `Counts below reflect the ${filtered.length} domain${filtered.length === 1 ? '' : 's'} matching the current filters.`}
          </p>
          <FilterSelect
            id="dom-counts"
            label="Summary basis"
            value={values.counts}
            onChange={(v) => set({ counts: v })}
            options={[
              { value: 'filtered', label: 'Current filters' },
              { value: 'all', label: 'All domains' },
            ]}
            className="min-w-[11rem]"
          />
        </div>
        <KpiGrid className="lg:grid-cols-4 xl:grid-cols-7">
          <KpiCard label="Total domains" value={summary.total} />
          <KpiCard label="India domains" value={summary.india} to="/domains?country=India" />
          <KpiCard label="Indonesia domains" value={summary.indonesia} to="/domains?country=Indonesia" />
          <KpiCard label="Available domains" value={summary.available} to="/domains?country=Available" />
          <KpiCard label="Active domains" value={summary.active} tone="success" to="/domains?status=Active" />
          <KpiCard label="Inactive domains" value={summary.inactive} to="/domains?status=Inactive" />
          <KpiCard label="Expiring within 30 days" value={summary.expiring30} tone="warning" to="/domains?expiration=expiring-30" />
        </KpiGrid>
      </div>

      <SectionCard title="Renewal pressure by country" description="Computed from the same records as the cards above.">
        <StackedBarChart
          title="Domain expiry distribution"
          description="Expiry state is a severity scale, so it wears the reserved status colours — each paired with an icon and label, never colour alone."
          rows={DOMAIN_COUNTRY.map((c) => c)}
          series={expirySeries}
          valueName="Domains"
          showPercent
          footnote="Expiry state is independent of the Active/Inactive status column — an expired domain stays Active until someone changes it."
        />
      </SectionCard>

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="dom-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search by domain or registrar…" className="min-w-[16rem] flex-1" />
        <FilterSelect id="dom-country-filter" label="Country" value={values.country} onChange={(v) => set({ country: v })}
          options={[{ value: 'all', label: 'All Countries' }, ...DOMAIN_COUNTRY.map((c) => ({ value: c, label: c }))]} />
        <FilterSelect id="dom-status-filter" label="Status" value={values.status} onChange={(v) => set({ status: v })}
          options={[{ value: 'all', label: 'All' }, ...DOMAIN_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="dom-expiry-filter" label="Expiration" value={values.expiration} onChange={(v) => set({ expiration: v })}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'expired', label: 'Expired' },
            { value: 'expiring-7', label: 'Expiring Within 7 Days' },
            { value: 'expiring-30', label: 'Expiring Within 30 Days' },
          ]} />
      </FilterBar>

      <DataTable
        tableId="domains"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRetry={() => refetch()}
        initialSorting={[{ id: 'expirationDate', desc: false }]}
        initialHidden={['registrarUid', 'category']}
        leading={
          <div role="group" aria-label="Which domains to show" className="inline-flex rounded-md border border-border p-0.5">
            {([['active', `Active (${activeTotal})`], ['archived', `Archived (${archivedTotal})`]] as const).map(([view, label]) => (
              <button
                key={view}
                type="button"
                aria-pressed={values.view === view}
                onClick={() => set({ view })}
                className={`rounded px-2.5 py-1 text-[12px] font-medium transition-colors ${values.view === view ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
        emptyTitle={showArchived ? 'No archived domains' : 'No domains match'}
        emptyDescription="Adjust the country, status, expiration or search filters — they apply together."
        rowClassName={(d) => {
          if (d.archived) return 'opacity-80';
          const b = domainExpiryBucket(d);
          if (b === 'expired') return 'bg-danger-bg/30';
          if (b === 'expiring-7') return 'bg-danger-bg/20';
          if (b === 'expiring-30') return 'bg-warning-bg/25';
          return undefined;
        }}
      />

      <DomainFormDialog open={formOpen} onOpenChange={(v) => { setFormOpen(v); if (!v) setEditing(undefined); }} domain={editing} />
      <RotationDialog open={rotateOpen} onOpenChange={setRotateOpen} domain={rotating} />
      <DomainBulkUploadDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <ConfirmWithReason
        open={Boolean(archiving)}
        onOpenChange={(v) => !v && setArchiving(undefined)}
        title={`Archive ${archiving?.domainName ?? ''}?`}
        description="The domain leaves the active register, counts and expiry alerts. Its history is kept and it can be restored from the Archived tab. The name stays reserved."
        onConfirm={(reason) => update.mutateAsync({ id: archiving!.id, archived: true, reason })}
      />
      <ConfirmWithReason
        open={Boolean(restoring)}
        onOpenChange={(v) => !v && setRestoring(undefined)}
        title={`Restore ${restoring?.domainName ?? ''}?`}
        description="The domain returns to the active register with its details and history."
        confirmLabel="Restore domain"
        danger={false}
        placeholder="Why is this domain being restored? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={(reason) => update.mutateAsync({ id: restoring!.id, archived: false, reason })}
      />

      <Dialog open={Boolean(historyFor)} onOpenChange={(v) => !v && setHistoryFor(undefined)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Audit history — {historyFor?.domainName}</DialogTitle>
            <DialogDescription>
              Additions, edits, status changes and rotation-date changes, with actor, timestamp and previous values.
            </DialogDescription>
          </DialogHeader>
          <SectionCard title="Entries">
            <AuditTimeline entries={domainAudit} emptyTitle="No recorded changes for this domain yet" />
          </SectionCard>
        </DialogContent>
      </Dialog>
    </div>
  );
}
