import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Archive, ArchiveRestore, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { ErrorState, PageHeader, SafeExternalLink, SectionCard } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmWithReason, ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { PostFormDialog } from '@/features/social-media-posts/PostFormDialog';
import { useBulkDeleteSocialPosts, useBulkSetSocialPostsStatus } from '@/features/social-media-posts/api';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import {
  DATE_FILTER_PRESET, effectivePlatform, inWindow, resolveDateWindow, summarisePosts, type DateFilterPreset,
} from '@/lib/social-posts';
import { SOCIAL_POST_PLATFORM, SOCIAL_POST_PURPOSE, type SocialMediaPost } from '@/lib/types';
import { formatDate, matches, toISODate } from '@/lib/utils';

const DEFAULTS = {
  search: '', datePreset: 'today', customDate: '', rangeFrom: '', rangeTo: '',
  member: 'all', platform: 'all', purpose: 'all', view: 'active',
};

const DATE_PRESET_LABEL: Record<DateFilterPreset, string> = {
  today: 'Today', yesterday: 'Yesterday', custom: 'Custom Date', range: 'Date Range',
};

export default function SocialMediaPostingPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS, { notFilters: ['view'] });
  const { can } = useSession();
  const today = toISODate(new Date());
  const showArchived = values.view === 'archived';

  const update = useUpdate<SocialMediaPost>('social-media-posts', 'Post');
  const bulkStatus = useBulkSetSocialPostsStatus();
  const bulkDelete = useBulkDeleteSocialPosts();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<SocialMediaPost | undefined>();
  const [archiving, setArchiving] = React.useState<SocialMediaPost | undefined>();
  const [restoring, setRestoring] = React.useState<SocialMediaPost | undefined>();
  const [deleting, setDeleting] = React.useState<SocialMediaPost | undefined>();
  const [historyFor, setHistoryFor] = React.useState<SocialMediaPost | undefined>();
  const [bulkArchiveOpen, setBulkArchiveOpen] = React.useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());

  // The seven (or however many) people this log tracks — active staff who may
  // record resources, the same people Team Reports expects a report from.
  const members = React.useMemo(
    () => (data?.teamMembers ?? []).filter((m) => m.active && ROLE_PERMISSIONS[m.role]?.includes('edit:resources')),
    [data],
  );

  // Guarded against a stale or hand-edited URL carrying a preset that no
  // longer exists — falls back to Today rather than crashing the page.
  const datePreset: DateFilterPreset = (DATE_FILTER_PRESET as readonly string[]).includes(values.datePreset)
    ? (values.datePreset as DateFilterPreset) : 'today';

  const dateWindow = React.useMemo(
    () => resolveDateWindow(datePreset, today, values.customDate, values.rangeFrom, values.rangeTo),
    [datePreset, values.customDate, values.rangeFrom, values.rangeTo, today],
  );

  const all = data?.socialMediaPosts ?? [];

  // Every filter but Active/Archived — shared by the dashboard (always active-only)
  // and the table (active or archived, per the view switch).
  const otherFiltered = React.useMemo(() => {
    const needle = values.search.trim();
    return all.filter((p) => {
      if (!inWindow(p.postDate, dateWindow)) return false;
      if (values.member !== 'all' && p.marketingMemberId !== values.member) return false;
      if (values.platform !== 'all' && effectivePlatform(p) !== values.platform) return false;
      if (values.purpose !== 'all' && p.purpose !== values.purpose) return false;
      if (needle) {
        const hay = [
          lookups.personName(p.marketingMemberId), p.postLink, p.customPurpose, p.customPlatform, p.notes,
        ].join(' ');
        if (!matches(hay, needle)) return false;
      }
      return true;
    });
  }, [all, dateWindow, values.member, values.platform, values.purpose, values.search, lookups]);

  // Dashboard and breakdowns never include archived posts, regardless of which
  // table view is open (see ARCHIVE RULES).
  const activeFiltered = React.useMemo(() => otherFiltered.filter((p) => p.status === 'active'), [otherFiltered]);
  const summary = React.useMemo(() => summarisePosts(activeFiltered, members), [activeFiltered, members]);

  // What the table actually shows.
  const tableRows = React.useMemo(
    () => otherFiltered.filter((p) => p.status === (showArchived ? 'archived' : 'active')),
    [otherFiltered, showArchived],
  );
  const activeTotal = all.filter((p) => p.status === 'active').length;
  const archivedTotal = all.length - activeTotal;

  // Custom platform names ever used, for the filter dropdown — computed from
  // every active post, independent of the other filters (including the
  // platform filter itself), so picking one platform doesn't hide the rest.
  const customPlatforms = React.useMemo(
    () => [...new Set(
      all.filter((p) => p.status === 'active' && p.platform === 'Others' && p.customPlatform.trim()).map((p) => p.customPlatform.trim()),
    )].sort((a, b) => a.localeCompare(b)),
    [all],
  );

  // A changed filter or view can drop selected rows out of sight; a stale pick
  // from before that change must not be acted on.
  React.useEffect(() => setSelectedIds(new Set()), [
    values.search, values.datePreset, values.customDate, values.rangeFrom, values.rangeTo,
    values.member, values.platform, values.purpose, values.view,
  ]);

  const toggleOne = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allRowsSelected = tableRows.length > 0 && tableRows.every((r) => selectedIds.has(r.id));
  const toggleSelectAll = () => setSelectedIds(allRowsSelected ? new Set() : new Set(tableRows.map((r) => r.id)));
  const deselectAll = () => setSelectedIds(new Set());

  const openEdit = (p: SocialMediaPost) => { setEditing(p); setFormOpen(true); };

  const columns = React.useMemo<ColumnDef<SocialMediaPost, unknown>[]>(() => [
    {
      id: 'select', enableSorting: false, enableHiding: false,
      header: () => <Checkbox checked={allRowsSelected} onCheckedChange={toggleSelectAll} aria-label="Select all posts shown" />,
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selectedIds.has(row.original.id)} onCheckedChange={() => toggleOne(row.original.id)}
            aria-label={`Select post ${row.original.id}`} />
        </div>
      ),
    },
    {
      id: 'date', header: 'Date', accessorKey: 'postDate',
      cell: ({ row }) => <span className="tabular">{formatDate(row.original.postDate)}</span>,
    },
    {
      id: 'name', header: 'Name', accessorFn: (r) => lookups.personName(r.marketingMemberId),
    },
    {
      id: 'link', header: 'Link', enableSorting: false,
      cell: ({ row }) => <SafeExternalLink href={row.original.postLink}>View Post</SafeExternalLink>,
    },
    {
      id: 'platform', header: 'Social Media Platform', accessorFn: effectivePlatform,
    },
    {
      id: 'purpose', header: 'Purpose', accessorFn: (r) => r.purpose,
      cell: ({ row }) => {
        const p = row.original;
        return p.purpose === 'Others' && p.customPurpose ? `${p.purpose} (${p.customPurpose})` : p.purpose;
      },
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {p.status === 'archived' ? (
              <Button size="icon-sm" variant="ghost" aria-label={`Restore ${p.id}`} title="Restore" disabled={!can('archive:records')} onClick={() => setRestoring(p)}>
                <ArchiveRestore />
              </Button>
            ) : (
              <>
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${p.id}`} disabled={!can('edit:resources')} onClick={() => openEdit(p)}>
                  <Pencil />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Archive ${p.id}`} title="Archive" disabled={!can('archive:records')} onClick={() => setArchiving(p)}>
                  <Archive />
                </Button>
              </>
            )}
            <Button size="icon-sm" variant="ghost" aria-label={`Audit history for ${p.id}`} onClick={() => setHistoryFor(p)}>
              <History />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label={`Delete ${p.id} permanently`} title="Delete permanently" className="text-danger"
              disabled={!can('archive:records')} onClick={() => setDeleting(p)}>
              <Trash2 />
            </Button>
          </div>
        );
      },
    },
  ], [can, lookups, allRowsSelected, selectedIds]);

  const postAudit = React.useMemo(
    () => (data?.auditEntries ?? []).filter((a) => a.recordType === 'Social Media Post' && a.recordId === historyFor?.id),
    [data, historyFor],
  );

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Social Media Posting"
        description="Every post the marketing team puts out, with an automatic daily, weekly and date-range overview of posting activity."
        actions={
          <>
            <ExportButton
              rows={tableRows}
              recordType="Social Media Post"
              filename="social-media-posts"
              columns={[
                { key: 'id', header: 'Record ID', value: (r) => r.id },
                { key: 'date', header: 'Date', value: (r) => r.postDate },
                { key: 'name', header: 'Marketing Name', value: (r) => lookups.personName(r.marketingMemberId) },
                { key: 'platform', header: 'Platform', value: (r) => effectivePlatform(r) },
                { key: 'purpose', header: 'Purpose', value: (r) => (r.purpose === 'Others' ? `Others (${r.customPurpose})` : r.purpose) },
                { key: 'link', header: 'Post Link', value: (r) => r.postLink },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
                { key: 'status', header: 'Status', value: (r) => r.status },
              ]}
            />
            <Button size="sm" onClick={() => { setEditing(undefined); setFormOpen(true); }} disabled={!can('edit:resources') || members.length === 0}>
              <Plus /> Add Social Media Post
            </Button>
          </>
        }
      />

      <KpiGrid className="lg:grid-cols-4">
        <KpiCard label="Total Posts" value={summary.totalPosts} hint={DATE_PRESET_LABEL[datePreset]} />
        <KpiCard label="Active Marketing Members" value={`${summary.activeMarketers} / ${members.length}`} />
        <KpiCard label="Platforms Used" value={summary.platformsUsed} />
        <KpiCard label="Event Posts" value={summary.eventPosts} to="/social-media-posting?purpose=Event" />
      </KpiGrid>

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="smp-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search name, link, purpose, platform, notes…" className="min-w-[14rem] flex-1" />
        <FilterSelect id="smp-date-preset" label="Date" value={values.datePreset} onChange={(v) => set({ datePreset: v, customDate: '', rangeFrom: '', rangeTo: '' })}
          options={DATE_FILTER_PRESET.map((p) => ({ value: p, label: DATE_PRESET_LABEL[p] }))} />
        {datePreset === 'custom' && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="smp-custom-date" className="text-[11px] uppercase tracking-wide text-muted-foreground">Which day</Label>
            <Input id="smp-custom-date" type="date" max={today} value={values.customDate} onChange={(e) => set({ customDate: e.target.value })} className="w-44" />
          </div>
        )}
        {datePreset === 'range' && (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="smp-range-from" className="text-[11px] uppercase tracking-wide text-muted-foreground">From</Label>
              <Input id="smp-range-from" type="date" max={today} value={values.rangeFrom} onChange={(e) => set({ rangeFrom: e.target.value })} className="w-44" />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="smp-range-to" className="text-[11px] uppercase tracking-wide text-muted-foreground">To</Label>
              <Input id="smp-range-to" type="date" max={today} value={values.rangeTo} onChange={(e) => set({ rangeTo: e.target.value })} className="w-44" />
            </div>
          </>
        )}
        <FilterSelect id="smp-member" label="Marketing Name" value={values.member} onChange={(v) => set({ member: v })}
          options={[{ value: 'all', label: 'Everyone' }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
        <FilterSelect id="smp-platform" label="Platform" value={values.platform} onChange={(v) => set({ platform: v })}
          options={[
            { value: 'all', label: 'All platforms' },
            ...SOCIAL_POST_PLATFORM.filter((p) => p !== 'Others').map((p) => ({ value: p, label: p })),
            ...customPlatforms.map((p) => ({ value: p, label: p })),
          ]} />
        <FilterSelect id="smp-purpose" label="Purpose" value={values.purpose} onChange={(v) => set({ purpose: v })}
          options={[{ value: 'all', label: 'All purposes' }, ...SOCIAL_POST_PURPOSE.map((p) => ({ value: p, label: p }))]} />
      </FilterBar>

      <p className="-mt-2 text-[12px] text-muted-foreground">
        Showing {DATE_PRESET_LABEL[datePreset].toLowerCase()}
        {datePreset === 'range' ? ` (${formatDate(dateWindow.from)} – ${formatDate(dateWindow.to)})` : datePreset !== 'today' ? ` (${formatDate(dateWindow.from)})` : ''}.
        Dashboard figures count active posts only, regardless of the Active / Archived view below.
      </p>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Posts by Platform">
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {summary.byPlatform.map((p) => (
              <li key={p.label} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.label}</span>
                <span className="tabular font-medium">{p.count}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
        <SectionCard title="Posts by Marketing Staff" description="An activity tracker, not a ranking.">
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {summary.byMember.map((m) => (
              <li key={m.memberId} className="flex items-center justify-between gap-2">
                <span className="truncate">{m.label}</span>
                <span className="tabular font-medium">{m.count}</span>
              </li>
            ))}
            {summary.byMember.length === 0 && <li className="text-muted-foreground">No marketing team members configured.</li>}
          </ul>
        </SectionCard>
        <SectionCard title="Posts by Purpose">
          <ul className="flex flex-col gap-1.5 text-[13px]">
            {summary.byPurpose.map((p) => (
              <li key={p.purpose} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.purpose}</span>
                <span className="tabular font-medium">{p.count}</span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>

      <SectionCard title="Posting Records">
        {selectedIds.size > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-[13px]">
            <span className="font-medium">{selectedIds.size} selected</span>
            <Button size="sm" variant="ghost" onClick={toggleSelectAll}>Select All</Button>
            <Button size="sm" variant="ghost" onClick={deselectAll}>Deselect All</Button>
            <div className="ml-auto flex items-center gap-2">
              {showArchived ? (
                <Button size="sm" variant="outline" disabled={!can('archive:records')} onClick={() => setBulkArchiveOpen(true)}>
                  <ArchiveRestore /> Restore
                </Button>
              ) : (
                <Button size="sm" variant="outline" disabled={!can('archive:records')} onClick={() => setBulkArchiveOpen(true)}>
                  <Archive /> Archive
                </Button>
              )}
              <Button size="sm" variant="danger" disabled={!can('archive:records')} onClick={() => setBulkDeleteOpen(true)}>
                <Trash2 /> Delete
              </Button>
            </div>
          </div>
        )}
        <DataTable
          tableId="social-media-posts"
          columns={columns}
          data={tableRows}
          isLoading={isLoading}
          onRetry={() => refetch()}
          getRowId={(r) => r.id}
          initialSorting={[{ id: 'date', desc: true }]}
          leading={
            <div role="group" aria-label="Which posts to show" className="inline-flex rounded-md border border-border p-0.5">
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
          emptyTitle={showArchived ? 'No archived posts' : 'No posts match'}
          emptyDescription="Adjust the date, filters or search, or add one."
        />
      </SectionCard>

      <PostFormDialog
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditing(undefined); }}
        post={editing}
        members={members}
      />

      <ConfirmWithReason
        open={Boolean(archiving)}
        onOpenChange={(v) => !v && setArchiving(undefined)}
        title="Archive this post?"
        description="The post is moved to the archive and leaves the active totals. It is kept and can be restored from the Archived tab."
        confirmLabel="Archive"
        onConfirm={(reason) => update.mutateAsync({ id: archiving!.id, status: 'archived', reason })}
      />
      <ConfirmWithReason
        open={Boolean(restoring)}
        onOpenChange={(v) => !v && setRestoring(undefined)}
        title="Restore this post?"
        description="The post returns to the active register and counts again in the dashboard."
        confirmLabel="Restore"
        danger={false}
        placeholder="Why is this being restored? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={(reason) => update.mutateAsync({ id: restoring!.id, status: 'active', reason })}
      />
      <ConfirmWithReason
        open={Boolean(deleting)}
        onOpenChange={(v) => !v && setDeleting(undefined)}
        title="Delete this post permanently?"
        description="This posting record is erased from the database and cannot be recovered."
        confirmLabel="Delete permanently"
        placeholder="Why is this post being deleted? This is written to the audit trail."
        hint="At least 10 characters. This cannot be undone."
        onConfirm={(reason) => bulkDelete.mutateAsync({ ids: [deleting!.id], reason })}
      />

      <ConfirmWithReason
        open={bulkArchiveOpen}
        onOpenChange={setBulkArchiveOpen}
        title={showArchived ? `Restore ${selectedIds.size} selected posts?` : `Archive ${selectedIds.size} selected posts?`}
        description={showArchived
          ? `${selectedIds.size} posting record${selectedIds.size === 1 ? '' : 's'} will return to the active register.`
          : `${selectedIds.size} posting record${selectedIds.size === 1 ? '' : 's'} will be moved to the archive.`}
        confirmLabel={showArchived ? 'Restore' : 'Archive'}
        danger={!showArchived}
        onConfirm={async (reason) => {
          await bulkStatus.mutateAsync({ ids: [...selectedIds], status: showArchived ? 'active' : 'archived', reason });
          deselectAll();
        }}
      />
      <ConfirmWithReason
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title="Delete selected posts?"
        description={`You are about to permanently delete ${selectedIds.size} posting record${selectedIds.size === 1 ? '' : 's'}. This action cannot be undone.`}
        confirmLabel="Delete"
        placeholder="Why are these posts being deleted? This line is kept in the audit history for each one."
        hint="At least 10 characters. This cannot be undone."
        onConfirm={async (reason) => {
          await bulkDelete.mutateAsync({ ids: [...selectedIds], reason });
          deselectAll();
        }}
      />

      <Dialog open={Boolean(historyFor)} onOpenChange={(v) => !v && setHistoryFor(undefined)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Audit history — {historyFor?.id}</DialogTitle>
            <DialogDescription>Additions, edits, archive/restore and deletion, with actor, timestamp and previous values.</DialogDescription>
          </DialogHeader>
          <SectionCard title="Entries">
            <AuditTimeline entries={postAudit} emptyTitle="No recorded changes for this record yet" />
          </SectionCard>
        </DialogContent>
      </Dialog>
    </div>
  );
}
