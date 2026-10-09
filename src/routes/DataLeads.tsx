import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AtSign, ListChecks, Mail, Send, Trash2, Upload, X } from 'lucide-react';
import { ErrorState, PageHeader, SafeExternalLink, SectionCard, StatusBadge } from '@/components/common/bits';
import { DataTable } from '@/components/common/DataTable';
import { ConfirmWithReason, ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Badge, Checkbox, NativeSelect } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { LeadImportDialog } from '@/features/data-leads/LeadImportDialog';
import { LeadDetailDialog } from '@/features/data-leads/LeadDetailDialog';
import { useBulkDeleteDataLeads, useCrmData, useUpdate } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { isAdmin } from '@/lib/access';
import { instagramLinkIn, promoConfidenceTone, telegramLinkIn } from '@/lib/leads';
import { displayUrl, maskEmail } from '@/lib/utils';
import { DATA_LEAD_ASSIGNEE, DATA_LEAD_STATUS, type DataLeadRecord } from '@/lib/types';

const DEFAULTS = { search: '', platform: 'all', country: 'all', status: 'all', assignee: 'all' };

export default function DataLeadsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS);
  const { can, role, showContactDetails: showContact } = useSession();
  const assign = useUpdate<DataLeadRecord>('data-leads', 'Lead');
  const bulkDelete = useBulkDeleteDataLeads();
  const mayDelete = isAdmin(role);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | undefined>();

  /* ── Select + permanently delete — System Administrator only ──── */
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelected = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const leads = data?.dataLeads ?? [];
  // Looked up fresh each render, not frozen at click time — marking a lead
  // Contacted from inside the dialog must show up in the dialog still open.
  const selected = leads.find((l) => l.id === selectedId);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return leads.filter((l) => {
      if (values.platform !== 'all' && l.platformId !== values.platform) return false;
      if (values.country !== 'all' && l.countryCode !== values.country) return false;
      if (values.status !== 'all' && l.status !== values.status) return false;
      if (values.assignee !== 'all' && (l.assignedTo ?? 'unassigned') !== values.assignee) return false;
      if (needle) {
        const hay = [l.creator, l.niche, l.keyword, l.tier, showContact ? l.publicEmail : '', l.channelUrl].join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [leads, values, showContact]);

  // A filter change can drop rows out of view; stale picks from before that
  // change must not be acted on by "Delete selected".
  React.useEffect(() => setSelectedIds(new Set()), [values]);

  const allFilteredSelected = filtered.length > 0 && filtered.every((l) => selectedIds.has(l.id));
  const toggleSelectAll = () => setSelectedIds(allFilteredSelected ? new Set() : new Set(filtered.map((l) => l.id)));

  const columns = React.useMemo<ColumnDef<DataLeadRecord, unknown>[]>(() => [
    ...(selectMode ? [{
      id: 'select', enableSorting: false, enableHiding: false,
      header: () => <Checkbox checked={allFilteredSelected} onCheckedChange={toggleSelectAll} aria-label="Select all leads shown" />,
      cell: ({ row }: { row: { original: DataLeadRecord } }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selectedIds.has(row.original.id)} onCheckedChange={() => toggleSelected(row.original.id)} aria-label={`Select ${row.original.creator}`} />
        </div>
      ),
    } satisfies ColumnDef<DataLeadRecord, unknown>] : []),
    {
      id: 'creator', header: 'Creator', accessorKey: 'creator',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.original.creator}</span>
          {row.original.keyword && <span className="text-[11px] text-muted-foreground">{row.original.keyword}</span>}
        </div>
      ),
    },
    { id: 'platform', header: 'Platform', accessorFn: (r) => lookups.platformName(r.platformId) },
    {
      id: 'channel', header: 'Channel', accessorKey: 'channelUrl', enableSorting: false,
      cell: ({ row }) => (row.original.channelUrl
        ? (
          <span onClick={(e) => e.stopPropagation()} title={row.original.channelUrl}>
            <SafeExternalLink href={row.original.channelUrl} className="block max-w-[14rem] truncate">
              {displayUrl(row.original.channelUrl)}
            </SafeExternalLink>
          </span>
        )
        : <span className="text-muted-foreground">—</span>),
    },
    { id: 'country', header: 'Country', accessorFn: (r) => lookups.countryName(r.countryCode) },
    { id: 'niche', header: 'Niche', accessorKey: 'niche', cell: ({ row }) => row.original.niche || <span className="text-muted-foreground">—</span> },
    {
      id: 'followers', header: 'Followers', accessorKey: 'followerCount',
      cell: ({ row }) => (row.original.followerCount !== null ? <span className="tabular">{row.original.followerCount.toLocaleString()}</span> : <span className="text-muted-foreground">—</span>),
    },
    { id: 'tier', header: 'Tier', accessorKey: 'tier', cell: ({ row }) => row.original.tier || <span className="text-muted-foreground">—</span> },
    {
      id: 'promoConfidence', header: 'Promo confidence', accessorKey: 'promoConfidence',
      cell: ({ row }) => (row.original.promoConfidence
        ? <Badge tone={promoConfidenceTone(row.original.promoConfidence)}>{row.original.promoConfidence}</Badge>
        : <span className="text-muted-foreground">—</span>),
    },
    {
      id: 'contact', header: 'Contact', enableSorting: false,
      cell: ({ row }) => {
        const l = row.original;
        const email = l.publicEmail.trim();
        const telegram = telegramLinkIn(l.publicTelegram);
        const instagram = instagramLinkIn(l.publicInstagram);
        if (!email && !telegram && !instagram) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground" title={[email && 'Email', telegram && 'Telegram', instagram && 'Instagram'].filter(Boolean).join(', ')}>
            {email && <Mail className="h-3.5 w-3.5" aria-label="Has email" />}
            {telegram && <Send className="h-3.5 w-3.5" aria-label="Has Telegram" />}
            {instagram && <AtSign className="h-3.5 w-3.5" aria-label="Has Instagram" />}
          </div>
        );
      },
    },
    {
      id: 'assignedTo', header: 'Assigned to', accessorFn: (r) => r.assignedTo ?? 'Unassigned',
      cell: ({ row }) => (
        <div onClick={(e) => e.stopPropagation()}>
          <NativeSelect
            aria-label={`Assign ${row.original.creator}`}
            className="h-8 min-w-[8rem] text-[12px]"
            value={row.original.assignedTo ?? ''}
            disabled={!can('edit:resources') || assign.isPending}
            onChange={(e) => assign.mutate({ id: row.original.id, assignedTo: e.target.value || null })}
          >
            <option value="">Unassigned</option>
            {DATA_LEAD_ASSIGNEE.map((name) => <option key={name} value={name}>{name}</option>)}
          </NativeSelect>
        </div>
      ),
    },
    {
      id: 'status', header: 'Status', accessorKey: 'status',
      cell: ({ row }) => <StatusBadge kind="dataLead" value={row.original.status} />,
    },
  // toggleSelectAll closes over `filtered`, so it must stay a dependency even
  // though it is not referenced by name in this callback.
  ], [lookups, can, assign, selectMode, selectedIds, allFilteredSelected, filtered]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Data Leads"
        description="Scraped creator leads for outreach, across Facebook, Instagram, Twitter/X, TikTok and YouTube — click a lead to see its evidence and reach out by email, Telegram or Instagram."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Data Lead"
              filename="data-leads"
              columns={[
                { key: 'id', header: 'Lead ID', value: (r) => r.id },
                { key: 'creator', header: 'Creator', value: (r) => r.creator },
                { key: 'platform', header: 'Platform', value: (r) => lookups.platformName(r.platformId) },
                { key: 'country', header: 'Country', value: (r) => lookups.countryName(r.countryCode) },
                { key: 'niche', header: 'Niche', value: (r) => r.niche },
                { key: 'keyword', header: 'Keyword', value: (r) => r.keyword },
                { key: 'channelUrl', header: 'Channel', value: (r) => r.channelUrl },
                { key: 'followerCount', header: 'Followers', value: (r) => r.followerCount },
                { key: 'tier', header: 'Tier', value: (r) => r.tier },
                { key: 'promoConfidence', header: 'Promo confidence', value: (r) => r.promoConfidence },
                { key: 'evidenceTitle', header: 'Evidence title', value: (r) => r.evidenceTitle },
                { key: 'evidenceUrl', header: 'Evidence URL', value: (r) => r.evidenceUrl },
                { key: 'publicEmail', header: 'Email', value: (r) => r.publicEmail, sensitive: true, masked: (r) => (r.publicEmail ? maskEmail(r.publicEmail) : '') },
                { key: 'publicTelegram', header: 'Telegram', value: (r) => r.publicTelegram, sensitive: true },
                { key: 'publicInstagram', header: 'Instagram', value: (r) => r.publicInstagram, sensitive: true },
                { key: 'status', header: 'Status', value: (r) => r.status },
                { key: 'assignedTo', header: 'Assigned to', value: (r) => r.assignedTo },
                { key: 'contactedAt', header: 'Contacted at', value: (r) => r.contactedAt },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
              ]}
            />
            <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)} disabled={!can('import:records')}
              title={can('import:records') ? 'Add many leads from a scraper sheet' : 'Your role cannot import records.'}>
              <Upload /> Bulk upload
            </Button>
            {mayDelete && filtered.length > 0 && (
              selectMode ? (
                <>
                  <Button size="sm" variant="danger" disabled={selectedIds.size === 0} onClick={() => setDeleteOpen(true)}>
                    <Trash2 /> Delete selected ({selectedIds.size})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={exitSelectMode}><X /> Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}><ListChecks /> Select</Button>
              )
            )}
          </>
        }
      />

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="leads-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search creator, keyword, channel…" className="min-w-[16rem] flex-1" />
        <FilterSelect id="leads-platform" label="Platform" value={values.platform} onChange={(v) => set({ platform: v })}
          options={[{ value: 'all', label: 'All platforms' }, ...(data?.platforms ?? []).map((p) => ({ value: p.id, label: p.name }))]} />
        <FilterSelect id="leads-country" label="Country" value={values.country} onChange={(v) => set({ country: v })}
          options={[{ value: 'all', label: 'All countries' }, ...(data?.countries ?? []).map((c) => ({ value: c.code, label: c.name }))]} />
        <FilterSelect id="leads-status" label="Status" value={values.status} onChange={(v) => set({ status: v })}
          options={[{ value: 'all', label: 'All statuses' }, ...DATA_LEAD_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="leads-assignee" label="Assigned to" value={values.assignee} onChange={(v) => set({ assignee: v })}
          options={[{ value: 'all', label: 'Anyone' }, { value: 'unassigned', label: 'Unassigned' }, ...DATA_LEAD_ASSIGNEE.map((n) => ({ value: n, label: n }))]} />
      </FilterBar>

      <SectionCard title="Leads">
        <DataTable
          tableId="data-leads"
          columns={columns}
          data={filtered}
          isLoading={isLoading}
          onRetry={() => refetch()}
          onRowClick={(r) => setSelectedId(r.id)}
          initialSorting={[{ id: 'followers', desc: true }]}
          emptyTitle="No leads match"
          emptyDescription="Adjust the filters above, or bulk upload a scraper sheet."
        />
      </SectionCard>

      <LeadImportDialog open={bulkOpen} onOpenChange={setBulkOpen} />
      <LeadDetailDialog lead={selected} onOpenChange={(v) => !v && setSelectedId(undefined)} />

      <ConfirmWithReason
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${selectedIds.size} lead${selectedIds.size === 1 ? '' : 's'} permanently?`}
        description="Each selected lead is erased from the database and cannot be recovered — leads have no archive to restore from. The audit history keeps one line per lead: who deleted it, when, and this reason."
        confirmLabel={`Delete ${selectedIds.size} permanently`}
        placeholder="Why are these leads being deleted? This line is kept in the audit history for each one."
        hint="At least 10 characters. This cannot be undone."
        onConfirm={async (reason) => {
          await bulkDelete.mutateAsync({ ids: [...selectedIds], reason });
          exitSelectMode();
        }}
      />
    </div>
  );
}
