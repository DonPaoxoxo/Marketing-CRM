import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Archive, ArchiveRestore, History, Pencil, Plus } from 'lucide-react';
import { ErrorState, PageHeader, SafeExternalLink, SectionCard } from '@/components/common/bits';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmWithReason, ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { CompetitorFormDialog } from '@/features/pakistan-competitors/CompetitorFormDialog';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import type { CompetitorRecord } from '@/lib/types';
import { displayUrl } from '@/lib/utils';

const DEFAULTS = { search: '', platform: 'all', view: 'active' };

export default function PakistanCompetitorsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS, { notFilters: ['view'] });
  const { can } = useSession();
  const showArchived = values.view === 'archived';
  const update = useUpdate<CompetitorRecord>('pakistan-competitors', 'Competitor');
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CompetitorRecord | undefined>();
  const [archiving, setArchiving] = React.useState<CompetitorRecord | undefined>();
  const [restoring, setRestoring] = React.useState<CompetitorRecord | undefined>();
  const [historyFor, setHistoryFor] = React.useState<CompetitorRecord | undefined>();

  const all = data?.pakistanCompetitors ?? [];
  const activeTotal = all.filter((c) => !c.archived).length;
  const archivedTotal = all.length - activeTotal;
  const competitors = React.useMemo(() => all.filter((c) => c.archived === showArchived), [all, showArchived]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return competitors.filter((c) => {
      if (values.platform !== 'all' && c.platformId !== values.platform) return false;
      if (needle) {
        const hay = `${c.linkOrDomain} ${c.whatsapp} ${c.telegram} ${c.others}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [competitors, values]);

  const openEdit = (c: CompetitorRecord) => { setEditing(c); setFormOpen(true); };

  const columns = React.useMemo<ColumnDef<CompetitorRecord, unknown>[]>(() => [
    { id: 'platform', header: 'Platform', accessorFn: (r) => lookups.platformName(r.platformId) },
    {
      id: 'linkOrDomain', header: 'Link / Domain', accessorKey: 'linkOrDomain',
      cell: ({ row }) => {
        const v = row.original.linkOrDomain;
        return /^https?:\/\//i.test(v)
          ? <SafeExternalLink href={v} className="max-w-[20rem] text-[13px]">{displayUrl(v)}</SafeExternalLink>
          : <span className="text-[13px]">{v}</span>;
      },
    },
    {
      id: 'whatsapp', header: 'WhatsApp', accessorKey: 'whatsapp',
      cell: ({ row }) => row.original.whatsapp || <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'telegram', header: 'Telegram', accessorKey: 'telegram',
      cell: ({ row }) => row.original.telegram || <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'others', header: 'Others', accessorKey: 'others', enableSorting: false,
      cell: ({ row }) => row.original.others || <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const c = row.original;
        if (c.archived) {
          return (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" disabled={!can('archive:records')} onClick={() => setRestoring(c)}>
                <ArchiveRestore /> Restore
              </Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Audit history for ${c.id}`} onClick={() => setHistoryFor(c)}>
                <History />
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.id}`} disabled={!can('edit:resources')} onClick={() => openEdit(c)}>
              <Pencil />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Audit history for ${c.id}`} onClick={() => setHistoryFor(c)}>
              <History />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Archive ${c.id}`} title="Archive" disabled={!can('archive:records')} onClick={() => setArchiving(c)}>
              <Archive />
            </Button>
          </div>
        );
      },
    },
  ], [can, lookups]);

  const competitorAudit = React.useMemo(
    () => (data?.auditEntries ?? []).filter((a) => a.recordType === 'Pakistan Competitor' && a.recordId === historyFor?.id),
    [data, historyFor],
  );

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Pakistan Competitor"
        description="Competitor presence across platforms for the Pakistan market — where they are found and how to reach them, not performance figures."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Pakistan Competitor"
              filename="pakistan-competitors"
              columns={[
                { key: 'id', header: 'Record ID', value: (r) => r.id },
                { key: 'platform', header: 'Platform', value: (r) => lookups.platformName(r.platformId) },
                { key: 'linkOrDomain', header: 'Link / Domain', value: (r) => r.linkOrDomain },
                { key: 'whatsapp', header: 'WhatsApp', value: (r) => r.whatsapp },
                { key: 'telegram', header: 'Telegram', value: (r) => r.telegram },
                { key: 'others', header: 'Others', value: (r) => r.others },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
              ]}
            />
            <Button size="sm" onClick={() => { setEditing(undefined); setFormOpen(true); }} disabled={!can('edit:resources')}>
              <Plus /> Add competitor
            </Button>
          </>
        }
      />

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="cmp-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search link, domain, WhatsApp, Telegram…" className="min-w-[16rem] flex-1" />
        <FilterSelect id="cmp-platform-filter" label="Platform" value={values.platform} onChange={(v) => set({ platform: v })}
          options={[{ value: 'all', label: 'All platforms' }, ...(data?.platforms ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
      </FilterBar>

      <SectionCard title="Register">
        <DataTable
          tableId="pakistan-competitors"
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          onRetry={() => refetch()}
          leading={
            <div role="group" aria-label="Which competitors to show" className="inline-flex rounded-md border border-border p-0.5">
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
          emptyTitle={showArchived ? 'No archived competitors' : 'No competitors match'}
          emptyDescription="Adjust the platform or search filters, or add one."
        />
      </SectionCard>

      <CompetitorFormDialog open={formOpen} onOpenChange={(v) => { setFormOpen(v); if (!v) setEditing(undefined); }} competitor={editing} />

      <ConfirmWithReason
        open={Boolean(archiving)}
        onOpenChange={(v) => !v && setArchiving(undefined)}
        title={`Archive ${archiving?.linkOrDomain ?? ''}?`}
        description="The record leaves the active register and counts. It is kept and can be restored from the Archived tab."
        onConfirm={(reason) => update.mutateAsync({ id: archiving!.id, archived: true, reason })}
      />
      <ConfirmWithReason
        open={Boolean(restoring)}
        onOpenChange={(v) => !v && setRestoring(undefined)}
        title={`Restore ${restoring?.linkOrDomain ?? ''}?`}
        description="The record returns to the active register with its details and history."
        confirmLabel="Restore competitor"
        danger={false}
        placeholder="Why is this being restored? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={(reason) => update.mutateAsync({ id: restoring!.id, archived: false, reason })}
      />

      <Dialog open={Boolean(historyFor)} onOpenChange={(v) => !v && setHistoryFor(undefined)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Audit history — {historyFor?.id}</DialogTitle>
            <DialogDescription>Additions, edits and archive changes, with actor, timestamp and previous values.</DialogDescription>
          </DialogHeader>
          <SectionCard title="Entries">
            <AuditTimeline entries={competitorAudit} emptyTitle="No recorded changes for this record yet" />
          </SectionCard>
        </DialogContent>
      </Dialog>
    </div>
  );
}
