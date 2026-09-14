import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Check, RotateCcw, UserPlus } from 'lucide-react';
import { PageHeader, StatusBadge, ErrorState, RecordLink, SecurityNotice } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { DataTable } from '@/components/common/DataTable';
import { ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { AssignDrawer } from '@/features/assignments/AssignDrawer';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { HANDOVER_STATUS, RESOURCE_TYPE, type Assignment } from '@/lib/types';
import { formatDate, toISODate } from '@/lib/utils';

const DEFAULTS = { search: '', type: 'all', handover: 'all', role: 'all', state: 'all', assignee: 'all' };

export default function AssignmentsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS);
  const { can } = useSession();
  const update = useUpdate<Assignment>('assignments', 'Assignment');
  const [assignOpen, setAssignOpen] = React.useState(false);

  const assignments = data?.assignments ?? [];

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return assignments.filter((a) => {
      if (values.type !== 'all' && a.resourceType !== values.type) return false;
      if (values.role !== 'all' && a.role !== values.role) return false;
      if (values.assignee !== 'all' && a.newAssigneeId !== values.assignee) return false;
      if (values.state === 'active' && !a.active) return false;
      if (values.state === 'closed' && a.active) return false;
      if (values.handover === 'open' && !(a.active && (a.handoverStatus === 'Pending' || a.handoverStatus === 'In Progress'))) return false;
      if (values.handover !== 'all' && values.handover !== 'open' && a.handoverStatus !== values.handover) return false;
      if (needle) {
        const hay = [a.id, a.resourceId, a.purpose, lookups.personName(a.newAssigneeId), lookups.personName(a.previousAssigneeId), a.notes]
          .join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [assignments, values, lookups]);

  const resourceHref = (a: Assignment) =>
    a.resourceType === 'SIM' ? `/sims/${a.resourceId}`
      : a.resourceType === 'Social Account' ? `/accounts/${a.resourceId}`
      : `/domains?search=${a.resourceId}`;

  const columns = React.useMemo<ColumnDef<Assignment, unknown>[]>(() => [
    { id: 'id', header: 'Assignment ID', accessorKey: 'id' },
    { id: 'resourceType', header: 'Resource type', accessorKey: 'resourceType' },
    {
      id: 'resourceId', header: 'Resource', accessorKey: 'resourceId',
      cell: ({ row }) => <RecordLink to={resourceHref(row.original)}>{row.original.resourceId}</RecordLink>,
    },
    { id: 'previous', header: 'Previous assignee', accessorFn: (r) => lookups.personName(r.previousAssigneeId) },
    {
      id: 'newAssignee', header: 'New assignee', accessorFn: (r) => lookups.personName(r.newAssigneeId),
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className="font-medium">{lookups.personName(row.original.newAssigneeId)}</span>
          <span className="text-[11px] text-muted-foreground">{row.original.newAssigneeType}</span>
        </span>
      ),
    },
    {
      id: 'role', header: 'Role', accessorKey: 'role',
      cell: ({ row }) => <Badge tone={row.original.role === 'Primary Custodian' ? 'accent' : 'neutral'}>{row.original.role}</Badge>,
    },
    { id: 'brand', header: 'Brand', accessorFn: (r) => lookups.brandName(r.brandId) },
    { id: 'project', header: 'Project', accessorFn: (r) => lookups.projectName(r.projectId) },
    { id: 'startDate', header: 'Start date', accessorKey: 'startDate', cell: ({ row }) => <span className="tabular">{formatDate(row.original.startDate)}</span> },
    { id: 'expectedReturnDate', header: 'Expected return', accessorKey: 'expectedReturnDate', cell: ({ row }) => <span className="tabular">{formatDate(row.original.expectedReturnDate)}</span> },
    { id: 'purpose', header: 'Purpose', accessorKey: 'purpose' },
    {
      id: 'handoverStatus', header: 'Handover', accessorKey: 'handoverStatus',
      cell: ({ row }) => <StatusBadge kind="handover" value={row.original.handoverStatus} />,
    },
    {
      id: 'acknowledged', header: 'Acknowledgment', accessorFn: (r) => r.acknowledgedBy ?? '',
      cell: ({ row }) => row.original.acknowledgedBy
        ? <span className="flex flex-col"><span className="text-[12px]">{row.original.acknowledgedBy}</span><span className="text-[11px] text-muted-foreground tabular">{formatDate(row.original.acknowledgedAt)}</span></span>
        : <Badge tone="warning">not acknowledged</Badge>,
    },
    {
      id: 'credentialAction', header: 'Credential action', accessorKey: 'credentialAction',
      cell: ({ row }) => row.original.credentialAction === 'None'
        ? <span className="text-muted-foreground">—</span>
        : <Badge tone="info">{row.original.credentialAction}</Badge>,
    },
    { id: 'returnedDate', header: 'Returned', accessorKey: 'returnedDate', cell: ({ row }) => <span className="tabular">{formatDate(row.original.returnedDate)}</span> },
    {
      id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const a = row.original;
        if (!a.active) return <Badge tone="neutral">closed</Badge>;
        return (
          <div className="flex items-center gap-1">
            <Button
              size="sm" variant="outline" disabled={!can('assign:resources') || Boolean(a.acknowledgedAt)}
              onClick={() => update.mutate({
                id: a.id, handoverStatus: 'Acknowledged',
                acknowledgedAt: new Date().toISOString(), acknowledgedBy: 'Recipient acknowledged in CRM',
                reason: 'Recipient acknowledged the handover',
              })}
            >
              <Check /> Acknowledge
            </Button>
            <Button
              size="sm" variant="outline" disabled={!can('assign:resources')}
              onClick={() => update.mutate({
                id: a.id, handoverStatus: 'Returned', active: false, returnedDate: toISODate(new Date()),
                credentialAction: 'Access Revoked', reason: 'Resource returned and access revoked',
              })}
            >
              <RotateCcw /> Return
            </Button>
          </div>
        );
      },
    },
  ], [lookups, can, update]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  const active = assignments.filter((a) => a.active);
  const openHandovers = active.filter((a) => a.handoverStatus === 'Pending' || a.handoverStatus === 'In Progress');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Assignments and handovers"
        description="A complete allocation history. A resource can have only one active primary custodian; collaborators are recorded separately."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Assignment"
              filename="assignments"
              columns={[
                { key: 'id', header: 'Assignment ID', value: (r) => r.id },
                { key: 'resourceType', header: 'Resource type', value: (r) => r.resourceType },
                { key: 'resourceId', header: 'Resource', value: (r) => r.resourceId },
                { key: 'previous', header: 'Previous assignee', value: (r) => lookups.personName(r.previousAssigneeId) },
                { key: 'newAssignee', header: 'New assignee', value: (r) => lookups.personName(r.newAssigneeId) },
                { key: 'role', header: 'Role', value: (r) => r.role },
                { key: 'brand', header: 'Brand', value: (r) => lookups.brandName(r.brandId) },
                { key: 'project', header: 'Project', value: (r) => lookups.projectName(r.projectId) },
                { key: 'startDate', header: 'Start date', value: (r) => r.startDate },
                { key: 'expectedReturnDate', header: 'Expected return date', value: (r) => r.expectedReturnDate },
                { key: 'purpose', header: 'Purpose', value: (r) => r.purpose },
                { key: 'handoverStatus', header: 'Handover status', value: (r) => r.handoverStatus },
                { key: 'acknowledged', header: 'Recipient acknowledgment', value: (r) => r.acknowledgedBy },
                { key: 'credentialAction', header: 'Credential action', value: (r) => r.credentialAction },
                { key: 'returnedDate', header: 'Return date', value: (r) => r.returnedDate },
                { key: 'notes', header: 'Notes', value: (r) => r.notes },
              ]}
            />
            <Button size="sm" onClick={() => setAssignOpen(true)} disabled={!can('assign:resources')}>
              <UserPlus /> New assignment
            </Button>
          </>
        }
      />

      <SecurityNotice>
        Credential handovers record whether access was <strong>granted, revoked or rotated</strong>. No password, token
        or recovery code is ever written to the handover log.
      </SecurityNotice>

      <KpiGrid className="lg:grid-cols-4">
        <KpiCard label="Total assignment records" value={assignments.length} />
        <KpiCard label="Active assignments" value={active.length} tone="success" to="/assignments?state=active" />
        <KpiCard label="Awaiting acknowledgment" value={openHandovers.length} tone="warning" to="/assignments?handover=open" />
        <KpiCard label="Collaborator records" value={assignments.filter((a) => a.role === 'Collaborator').length} to="/assignments?role=Collaborator" />
      </KpiGrid>

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="asg-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search assignment, resource, person, purpose…" className="min-w-[16rem] flex-1" />
        <FilterSelect id="asg-type-filter" label="Resource type" value={values.type} onChange={(v) => set({ type: v })}
          options={[{ value: 'all', label: 'All' }, ...RESOURCE_TYPE.map((t) => ({ value: t, label: t }))]} />
        <FilterSelect id="asg-handover-filter" label="Handover" value={values.handover} onChange={(v) => set({ handover: v })}
          options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Awaiting acknowledgment' }, ...HANDOVER_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="asg-role-filter" label="Role" value={values.role} onChange={(v) => set({ role: v })}
          options={[{ value: 'all', label: 'All' }, { value: 'Primary Custodian', label: 'Primary custodian' }, { value: 'Collaborator', label: 'Collaborator' }]} />
        <FilterSelect id="asg-state-filter" label="State" value={values.state} onChange={(v) => set({ state: v })}
          options={[{ value: 'all', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'closed', label: 'Closed' }]} />
        <FilterSelect id="asg-assignee-filter" label="Assignee" value={values.assignee} onChange={(v) => set({ assignee: v })}
          options={[
            { value: 'all', label: 'Anyone' },
            ...(data?.teamMembers ?? []).map((m) => ({ value: m.id, label: m.name })),
            ...(data?.agents ?? []).slice(0, 25).map((a) => ({ value: a.id, label: `${a.name} (agent)` })),
          ]} />
      </FilterBar>

      <DataTable
        tableId="assignments"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRetry={() => refetch()}
        initialSorting={[{ id: 'startDate', desc: true }]}
        initialHidden={['previous', 'project', 'expectedReturnDate', 'returnedDate']}
        emptyTitle="No assignments match"
      />

      <AssignDrawer open={assignOpen} onOpenChange={setAssignOpen} />
    </div>
  );
}
