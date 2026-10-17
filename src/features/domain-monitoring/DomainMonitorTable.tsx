import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { ListChecks, Pencil, Upload, X } from 'lucide-react';
import { Archive, ArchiveRestore, History } from 'lucide-react';
import { ErrorState, PageHeader, SafeExternalLink, SectionCard } from '@/components/common/bits';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmWithReason, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { useRegisterExport } from '@/components/layout/page-actions';
import { Checkbox, NativeSelect } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { displayUrl, formatDate } from '@/lib/utils';
import type { ExportColumn } from '@/lib/csv';
import { DOMAIN_ACCESSIBILITY_STATUS, type DomainAccessibilityStatus, type DomainMonitorRecord, type DomainMonitorType } from '@/lib/types';
import { dailyCheckBucket } from './badges';
import { AccessibilityCheckDialog, type CheckTarget } from './AccessibilityCheckDialog';
import { DomainMonitorFormDialog } from './DomainMonitorFormDialog';
import { DomainBulkAddDialog } from './DomainBulkAddDialog';
import { domainMonitorColumns } from './domainMonitoringExport';
import { useRecordAccessibilityCheck, useUpdateDomainMonitor } from './api';

const DEFAULTS = { search: '', status: 'all', view: 'active' };

/** Free Cash and Invite Domains share this whole table — the two differ only
 *  in whether Activation Status appears as a column, and what an added domain
 *  defaults to server-side. See migration 019: one domain_monitors table,
 *  domain_type discriminator, not two tables. */
export function DomainMonitorTable({ domainType, title, description }: { domainType: DomainMonitorType; title: string; description: string }) {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS, { notFilters: ['view'] });
  const { can } = useSession();
  const update = useUpdateDomainMonitor();
  const check = useRecordAccessibilityCheck();
  const showArchived = values.view === 'archived';

  const [formOpen, setFormOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<DomainMonitorRecord | undefined>();
  const [archiving, setArchiving] = React.useState<DomainMonitorRecord | undefined>();
  const [restoring, setRestoring] = React.useState<DomainMonitorRecord | undefined>();
  const [checkTarget, setCheckTarget] = React.useState<CheckTarget | undefined>();
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  const all = (data?.domainMonitors ?? []).filter((d) => d.domainType === domainType);
  const activeTotal = all.filter((d) => !d.archived).length;
  const archivedTotal = all.length - activeTotal;
  const byView = React.useMemo(() => all.filter((d) => d.archived === showArchived), [all, showArchived]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return byView.filter((d) => {
      if (values.status !== 'all' && d.lastAccessibilityStatus !== values.status) return false;
      if (needle && !`${d.domainName} ${d.notes}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [byView, values]);

  React.useEffect(() => setSelectedIds(new Set()), [values, showArchived]);
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelected = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allFilteredSelected = filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id));
  // toggleSelectAll closes over `filtered`, so it must stay a dependency of the
  // columns memo below even though it is not referenced there by name.
  const toggleSelectAll = () => setSelectedIds(allFilteredSelected ? new Set() : new Set(filtered.map((d) => d.id)));

  const openEdit = (d: DomainMonitorRecord) => { setEditing(d); setFormOpen(true); };

  // Invite only: a domain's next rotation date is whatever its batch's group
  // is next due — derived from bootstrap data, nothing stored per domain.
  const nextRotationByDomainId = React.useMemo(() => {
    if (domainType !== 'Invite') return new Map<string, string | null>();
    const groupById = new Map((data?.rotationGroups ?? []).map((g) => [g.id, g]));
    const batchById = new Map((data?.rotationBatches ?? []).map((b) => [b.id, b]));
    const map = new Map<string, string | null>();
    for (const m of data?.rotationBatchMembers ?? []) {
      const batch = batchById.get(m.rotationBatchId);
      const group = batch ? groupById.get(batch.rotationGroupId) : undefined;
      map.set(m.domainMonitorId, group?.nextRotationDueAt ?? null);
    }
    return map;
  }, [domainType, data]);

  // "Current Filtered Results" and "Selected Domains" are tab-specific — the
  // other export scopes are page-level and registered once in DomainMonitoring.tsx.
  const exportColumns = React.useMemo(() => domainMonitorColumns(lookups.personName) as unknown as ExportColumn<never>[], [lookups]);
  useRegisterExport({
    label: `${title} — Filtered Results`, filename: `domain-monitoring-${domainType === 'Free Cash' ? 'free-cash' : 'invite'}-filtered`,
    recordType: 'Domain Monitor', rows: filtered, columns: exportColumns,
  });
  useRegisterExport({
    label: `${title} — Selected`, filename: `domain-monitoring-${domainType === 'Free Cash' ? 'free-cash' : 'invite'}-selected`,
    recordType: 'Domain Monitor', rows: filtered.filter((d) => selectedIds.has(d.id)), columns: exportColumns,
    disabledReason: selectedIds.size === 0 ? 'No domains selected.' : undefined,
  });

  const columns = React.useMemo<ColumnDef<DomainMonitorRecord, unknown>[]>(() => [
    ...(selectMode ? [{
      id: 'select', enableSorting: false, enableHiding: false,
      header: () => <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label="Select all domains shown" />,
      cell: ({ row }: { row: { original: DomainMonitorRecord } }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selectedIds.has(row.original.id)} onCheckedChange={() => toggleSelected(row.original.id)} aria-label={`Select ${row.original.domainName}`} />
        </div>
      ),
    } satisfies ColumnDef<DomainMonitorRecord, unknown>] : []),
    {
      id: 'domainName', header: 'Domain URL', accessorKey: 'domainName',
      cell: ({ row }) => {
        const v = row.original.domainName;
        const href = /^https?:\/\//i.test(v) ? v : `https://${v}`;
        return <SafeExternalLink href={href} className="text-[13px]">{displayUrl(v)}</SafeExternalLink>;
      },
    },
    {
      id: 'accessibility', header: 'Accessibility', accessorKey: 'lastAccessibilityStatus',
      cell: ({ row }) => {
        const d = row.original;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <NativeSelect
              aria-label={`Accessibility of ${d.domainName}`}
              className="h-8 w-auto text-[13px]"
              value={d.lastAccessibilityStatus}
              disabled={!can('record:domain-checks')}
              onChange={(e) => check.mutate({ id: d.id, accessibilityStatus: e.target.value as DomainAccessibilityStatus })}
            >
              {DOMAIN_ACCESSIBILITY_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </div>
        );
      },
    },
    {
      id: 'dailyCheck', header: 'Daily Check', enableSorting: false,
      cell: ({ row }) => {
        const checkedToday = dailyCheckBucket(row.original.lastCheckedDate) === 'checked-today';
        return (
          <NativeSelect aria-label="Daily check status" className="h-8 w-auto text-[13px]" value={checkedToday ? 'Check' : 'Pending'} disabled>
            <option value="Check">Check</option>
            <option value="Pending">Pending</option>
          </NativeSelect>
        );
      },
    },
    {
      id: 'enabled', header: 'Enabled', accessorFn: (r: DomainMonitorRecord) => (r.enabled ? 'Enabled' : 'Disabled'),
      cell: ({ row }) => {
        const d = row.original;
        return (
          <div onClick={(e) => e.stopPropagation()}>
            <NativeSelect
              aria-label={`Enabled state of ${d.domainName}`}
              className="h-8 w-auto text-[13px]"
              value={d.enabled ? 'Enabled' : 'Disabled'}
              disabled={!can('edit:resources')}
              onChange={(e) => update.mutate({ id: d.id, enabled: e.target.value === 'Enabled' })}
            >
              <option value="Enabled">Enabled</option>
              <option value="Disabled">Disabled</option>
            </NativeSelect>
          </div>
        );
      },
    },
    {
      id: 'dateEnabled', header: 'Date Enabled', accessorKey: 'enabledDate',
      cell: ({ row }) => row.original.enabledDate
        ? <span className="tabular">{formatDate(row.original.enabledDate)}</span>
        : <span className="text-muted-foreground">Never</span>,
    },
    ...(domainType === 'Invite' ? [{
      id: 'nextRotation', header: 'Next Rotation Date', enableSorting: false,
      cell: ({ row }: { row: { original: DomainMonitorRecord } }) => {
        const due = nextRotationByDomainId.get(row.original.id);
        return due ? <span className="tabular">{formatDate(due)}</span> : <span className="text-muted-foreground">Not scheduled</span>;
      },
    } satisfies ColumnDef<DomainMonitorRecord, unknown>] : []),
    {
      id: 'checkedBy', header: 'Checked By', enableSorting: false,
      cell: ({ row }) => lookups.personName(row.original.lastCheckedById),
    },
    { id: 'notes', header: 'Notes', accessorKey: 'notes', enableSorting: false, cell: ({ row }) => row.original.notes || <span className="text-muted-foreground">—</span> },
    {
      id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const d = row.original;
        if (d.archived) {
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" disabled={!can('archive:records')} onClick={() => setRestoring(d)}>
                <ArchiveRestore /> Restore
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${d.domainName}`} disabled={!can('edit:resources')} onClick={() => openEdit(d)}>
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Archive ${d.domainName}`} title="Archive" disabled={!can('archive:records')} onClick={() => setArchiving(d)}>
              <Archive />
            </Button>
          </div>
        );
      },
    },
  ], [domainType, lookups, can, selectMode, selectedIds, allFilteredSelected, filtered, check, update, nextRotationByDomainId]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {can('record:domain-checks') && all.length > 0 && (
              selectMode ? (
                <>
                  <Button size="sm" disabled={selectedIds.size === 0} onClick={() => setCheckTarget({ kind: 'bulk', ids: [...selectedIds] })}>
                    <History /> Check selected ({selectedIds.size})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={exitSelectMode}><X /> Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}><ListChecks /> Select</Button>
              )
            )}
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} disabled={!can('import:records')}>
              <Upload /> Bulk add
            </Button>
            <Button size="sm" onClick={() => { setEditing(undefined); setFormOpen(true); }} disabled={!can('edit:resources')}>
              Add domain
            </Button>
          </>
        }
      />

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id={`dm-${domainType}-search`} value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search domain, notes…" className="min-w-[16rem] flex-1" />
        <FilterSelect id={`dm-${domainType}-status`} label="Accessibility" value={values.status} onChange={(v) => set({ status: v })}
          options={[{ value: 'all', label: 'All statuses' }, ...DOMAIN_ACCESSIBILITY_STATUS.map((s) => ({ value: s, label: s }))]} />
      </FilterBar>

      <SectionCard title="Domains">
        <DataTable
          tableId={`domain-monitoring-${domainType}`}
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          onRetry={() => refetch()}
          initialSorting={[{ id: 'domainName', desc: false }]}
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
          emptyDescription="Adjust the filters above, add one, or bulk upload a list."
        />
      </SectionCard>

      <DomainMonitorFormDialog open={formOpen} onOpenChange={(v) => { setFormOpen(v); if (!v) setEditing(undefined); }} monitor={editing} />
      <DomainBulkAddDialog open={bulkOpen} onOpenChange={setBulkOpen} domainType={domainType} />
      <AccessibilityCheckDialog open={Boolean(checkTarget)} onOpenChange={(v) => { if (!v) { setCheckTarget(undefined); exitSelectMode(); } }} target={checkTarget} />

      <ConfirmWithReason
        open={Boolean(archiving)}
        onOpenChange={(v) => !v && setArchiving(undefined)}
        title={`Archive ${archiving?.domainName ?? ''}?`}
        description="The domain leaves the active register and counts. It is kept and can be restored from the Archived tab."
        onConfirm={(reason) => update.mutateAsync({ id: archiving!.id, archived: true, reason })}
      />
      <ConfirmWithReason
        open={Boolean(restoring)}
        onOpenChange={(v) => !v && setRestoring(undefined)}
        title={`Restore ${restoring?.domainName ?? ''}?`}
        description="The domain returns to the active register with its details and history."
        confirmLabel="Restore domain"
        danger={false}
        placeholder="Why is this being restored? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={(reason) => update.mutateAsync({ id: restoring!.id, archived: false, reason })}
      />
    </div>
  );
}
