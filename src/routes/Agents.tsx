import * as React from 'react';
import { ProofCell, ProofPaymentCell, ProofVerdictCell } from '@/features/agents/proofs';
import { SalaryStatusControl } from '@/features/agents/SalaryStatus';
import { salaryLabel } from '@/lib/salary';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { PageHeader, StatusBadge, ErrorState, RecordLink, SecurityNotice } from '@/components/common/bits';
import { DataTable } from '@/components/common/DataTable';
import { ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { AgentFormDialog } from '@/features/agents/AgentFormDialog';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { DEFAULT_THRESHOLDS } from '@/lib/rules';
import { AGENT_TYPE, COOPERATION_STATUS, type Agent } from '@/lib/types';
import { daysUntil, formatDate, maskEmail, maskPhone, relativeDays } from '@/lib/utils';

const DEFAULTS = { search: '', coop: 'all', type: 'all', manager: 'all', brand: 'all', followup: 'all', view: 'active' };

export default function AgentsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  // `view` lives in the address so a refresh keeps you on Archived, but it is not a filter.
  const { values, set, clear, activeCount } = useFilters(DEFAULTS, { notFilters: ['view'] });
  const showArchived = values.view === 'archived';
  const { can, showContactDetails: showContact } = useSession();
  const navigate = useNavigate();
  const [formOpen, setFormOpen] = React.useState(false);

  const liveCount = (data?.agents ?? []).filter((a) => !a.archived).length;
  const archivedCount = (data?.agents ?? []).length - liveCount;
  const agents = React.useMemo(
    () => (data?.agents ?? []).filter((a) => a.archived === showArchived),
    [data, showArchived],
  );

  // When and why each agent was archived: its latest archive entry in the history.
  const archivedBy = React.useMemo(() => {
    const map = new Map<string, { timestamp: string; actorName: string; reason: string }>();
    for (const e of data?.auditEntries ?? []) {
      if (e.recordType !== 'Agent' || e.action !== 'archive' || e.changes.some((c) => c.field === 'proofPostUrl')) continue;
      const known = map.get(e.recordId);
      if (!known || e.timestamp > known.timestamp) map.set(e.recordId, { timestamp: e.timestamp, actorName: e.actorName, reason: e.reason });
    }
    return map;
  }, [data]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return agents.filter((a) => {
      if (values.coop !== 'all' && a.cooperationStatus !== values.coop) return false;
      if (values.type !== 'all' && a.agentType !== values.type) return false;
      if (values.manager !== 'all' && a.managerId !== values.manager) return false;
      if (values.brand !== 'all' && !a.brandIds.includes(values.brand)) return false;
      if (values.followup === 'due') {
        const d = daysUntil(a.nextFollowUpDate);
        if (d === null || d > DEFAULT_THRESHOLDS.followUpWindowDays) return false;
      }
      if (values.followup === 'overdue') {
        const d = daysUntil(a.nextFollowUpDate);
        if (d === null || d >= 0) return false;
      }
      if (values.followup === 'none' && a.nextFollowUpDate) return false;
      if (needle) {
        const hay = [a.id, a.name, a.email, a.contactNumber, a.agreementRef, a.notes, a.brandIds.map(lookups.brandName).join(' ')]
          .join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [agents, values, lookups]);

  const columns = React.useMemo<ColumnDef<Agent, unknown>[]>(() => {
    // Archived view only: when, by whom and why, beside the name so it is read first.
    const archivedColumn = {
      id: 'archivedAt', header: 'Archived', enableSorting: false,
      cell: ({ row }: { row: { original: Agent } }) => {
        const info = archivedBy.get(row.original.id);
        return info ? (
          <span className="flex max-w-[16rem] flex-col text-[12px]">
            <span className="tabular">{formatDate(info.timestamp.slice(0, 10))} · {info.actorName}</span>
            <span className="truncate text-muted-foreground" title={info.reason}>{info.reason}</span>
          </span>
        ) : <span className="text-muted-foreground">—</span>;
      },
    } satisfies ColumnDef<Agent, unknown>;
    return [
    { id: 'id', header: 'Agent UID', accessorKey: 'id', cell: ({ row }) => <RecordLink to={`/agents/${row.original.id}`}>{row.original.id}</RecordLink> },
    { id: 'name', header: 'Name', accessorKey: 'name', cell: ({ row }) => <span className="font-medium">{row.original.name}</span> },
    ...(showArchived ? [archivedColumn] : []),
    {
      id: 'externalUid', header: 'UID', accessorKey: 'externalUid',
      cell: ({ row }) => row.original.externalUid ? <span className="tabular">{row.original.externalUid}</span> : <span className="text-muted-foreground">—</span>,
    },
    { id: 'agentType', header: 'Type', accessorKey: 'agentType' },
    {
      id: 'contactNumber', header: 'Contact number', accessorKey: 'contactNumber',
      cell: ({ row }) => <span className="tabular">{showContact ? row.original.contactNumber : maskPhone(row.original.contactNumber)}</span>,
    },
    {
      id: 'email', header: 'Email', accessorKey: 'email',
      cell: ({ row }) => <span className="break-all">{showContact ? row.original.email : maskEmail(row.original.email)}</span>,
    },
    { id: 'preferredChannel', header: 'Preferred channel', accessorKey: 'preferredChannel' },
    { id: 'manager', header: 'Manager', accessorFn: (r) => lookups.personName(r.managerId) },
    { id: 'proof', header: 'Proof', enableSorting: false, cell: ({ row }) => <ProofCell agent={row.original} /> },
    // Per agent. Everyone can read it; only the System Administrator sets it.
    { id: 'salaryStatus', header: 'Salary Status', accessorFn: (r) => salaryLabel(r), cell: ({ row }) => <div onClick={(e) => e.stopPropagation()}><SalaryStatusControl agent={row.original} /></div> },
    // Latest proof's verdict and payment. Everyone can read them; only the System Administrator changes them.
    { id: 'proofVerdict', header: 'Verdict', enableSorting: false, cell: ({ row }) => <ProofVerdictCell agent={row.original} /> },
    { id: 'proofPayment', header: 'Payment', enableSorting: false, cell: ({ row }) => <ProofPaymentCell agent={row.original} /> },
    { id: 'brands', header: 'Brands', accessorFn: (r) => r.brandIds.map(lookups.brandName).join(', '), enableSorting: false },
    {
      id: 'cooperationStatus', header: 'Cooperation', accessorKey: 'cooperationStatus',
      cell: ({ row }) => <StatusBadge kind="cooperation" value={row.original.cooperationStatus} />,
    },
    { id: 'startDate', header: 'Start date', accessorKey: 'startDate', cell: ({ row }) => <span className="tabular">{formatDate(row.original.startDate)}</span> },
    { id: 'lastContactedDate', header: 'Last contacted', accessorKey: 'lastContactedDate', cell: ({ row }) => <span className="tabular">{formatDate(row.original.lastContactedDate)}</span> },
    {
      id: 'nextFollowUpDate', header: 'Next follow-up', accessorKey: 'nextFollowUpDate',
      cell: ({ row }) => {
        const d = daysUntil(row.original.nextFollowUpDate);
        if (d === null) return <span className="text-muted-foreground">—</span>;
        return (
          <span className="flex flex-col">
            <span className="tabular">{formatDate(row.original.nextFollowUpDate)}</span>
            <span className={`text-[11px] ${d < 0 ? 'text-danger' : d <= DEFAULT_THRESHOLDS.followUpWindowDays ? 'text-warning' : 'text-muted-foreground'}`}>
              {relativeDays(d)}
            </span>
          </span>
        );
      },
    },
    {
      id: 'agreementRef', header: 'Agreement ref', accessorKey: 'agreementRef',
      cell: ({ row }) => row.original.agreementRef || <Badge tone="warning">missing</Badge>,
    },
  ];
  }, [lookups, showContact, showArchived, archivedBy]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Agent register"
        description="Marketing agents and agencies, their managers, cooperation status and follow-up schedule."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Agent"
              filename="agents"
              columns={[
                { key: 'id', header: 'Agent UID', value: (r) => r.id },
                { key: 'name', header: 'Name', value: (r) => r.name },
                { key: 'externalUid', header: 'UID', value: (r) => r.externalUid },
                { key: 'agentType', header: 'Type', value: (r) => r.agentType },
                { key: 'contactNumber', header: 'Contact number', value: (r) => r.contactNumber, sensitive: true, masked: (r) => maskPhone(r.contactNumber) },
                { key: 'email', header: 'Email', value: (r) => r.email, sensitive: true, masked: (r) => maskEmail(r.email) },
                { key: 'preferredChannel', header: 'Preferred channel', value: (r) => r.preferredChannel },
                { key: 'manager', header: 'Manager', value: (r) => lookups.personName(r.managerId) },
                { key: 'salaryStatus', header: 'Salary status', value: (r) => salaryLabel(r) },
                { key: 'brands', header: 'Brands', value: (r) => r.brandIds.map(lookups.brandName).join('; ') },
                { key: 'channelUrls', header: 'Channel URLs', value: (r) => r.channelUrls.join('; ') },
                { key: 'cooperationStatus', header: 'Cooperation status', value: (r) => r.cooperationStatus },
                { key: 'startDate', header: 'Start date', value: (r) => r.startDate },
                { key: 'lastContactedDate', header: 'Last contacted', value: (r) => r.lastContactedDate },
                { key: 'nextFollowUpDate', header: 'Next follow-up', value: (r) => r.nextFollowUpDate },
                { key: 'agreementRef', header: 'Agreement reference', value: (r) => r.agreementRef },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
              ]}
            />
            <Button size="sm" onClick={() => setFormOpen(true)} disabled={!can('edit:resources')}>
              <Plus /> Add agent
            </Button>
          </>
        }
      />

      <SecurityNotice>
        Agent records are contact records. They are kept separate from CRM login users and never create an account
        automatically.
      </SecurityNotice>

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="agents-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search agent, email, number, document reference…" className="min-w-[16rem] flex-1" />
        <FilterSelect id="agents-coop" label="Cooperation" value={values.coop} onChange={(v) => set({ coop: v })}
          options={[{ value: 'all', label: 'All statuses' }, ...COOPERATION_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="agents-type" label="Type" value={values.type} onChange={(v) => set({ type: v })}
          options={[{ value: 'all', label: 'All' }, ...AGENT_TYPE.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="agents-manager" label="Manager" value={values.manager} onChange={(v) => set({ manager: v })}
          options={[{ value: 'all', label: 'All managers' }, ...(data?.teamMembers ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
        <FilterSelect id="agents-brand" label="Brand" value={values.brand} onChange={(v) => set({ brand: v })}
          options={[{ value: 'all', label: 'All brands' }, ...(data?.brands ?? []).map((b) => ({ value: b.id, label: b.name }))]} />
        <FilterSelect id="agents-followup" label="Follow-up" value={values.followup} onChange={(v) => set({ followup: v })}
          options={[
            { value: 'all', label: 'Any' },
            { value: 'due', label: `Due within ${DEFAULT_THRESHOLDS.followUpWindowDays} days` },
            { value: 'overdue', label: 'Overdue' },
            { value: 'none', label: 'No follow-up set' },
          ]} />
      </FilterBar>

      <DataTable
        tableId="agents"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRetry={() => refetch()}
        onRowClick={(r) => navigate(`/agents/${r.id}`)}
        initialSorting={[{ id: 'name', desc: false }]}
        initialHidden={['preferredChannel', 'startDate', 'agreementRef']}
        leading={
          <div role="group" aria-label="Which agents to show" className="inline-flex rounded-md border border-border p-0.5">
            {([['active', `Active (${liveCount})`], ['archived', `Archived (${archivedCount})`]] as const).map(([view, label]) => (
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
        rowClassName={showArchived ? () => 'opacity-80' : undefined}
        emptyTitle={showArchived ? 'No archived agents' : 'No agents match'}
      />

      <AgentFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
