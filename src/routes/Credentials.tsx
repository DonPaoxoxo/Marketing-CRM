import * as React from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { KeyRound, Lock, RotateCw, ShieldCheck } from 'lucide-react';
import { PageHeader, StatusBadge, ErrorState, RecordLink, SectionCard, NotConnectedNotice, SecurityNotice } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { DataTable } from '@/components/common/DataTable';
import { ExportButton, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { CREDENTIAL_ACCESS_STATUS, type CredentialRef } from '@/lib/types';
import { daysSince, formatDate, toISODate } from '@/lib/utils';

const DEFAULTS = { search: '', status: 'all', twofa: 'all', recovery: 'all', rotation: 'all' };
const ROTATION_OVERDUE_DAYS = 180;

export default function CredentialsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS);
  const { can } = useSession();
  const update = useUpdate<CredentialRef>('credentials', 'Credential reference');
  const [historyFor, setHistoryFor] = React.useState<CredentialRef | undefined>();

  const credentials = React.useMemo(() => (data?.credentials ?? []).filter((c) => !c.archived), [data]);

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return credentials.filter((c) => {
      if (values.status !== 'all' && c.accessStatus !== values.status) return false;
      if (values.twofa === 'on' && !c.twoFaEnabled) return false;
      if (values.twofa === 'off' && c.twoFaEnabled) return false;
      if (values.recovery === 'ready' && !c.recoveryReady) return false;
      if (values.recovery === 'not-ready' && c.recoveryReady) return false;
      if (values.rotation === 'overdue') {
        const since = daysSince(c.lastRotationDate);
        if (since !== null && since <= ROTATION_OVERDUE_DAYS) return false;
      }
      if (values.rotation === 'never' && c.lastRotationDate) return false;
      if (needle) {
        const hay = [c.id, c.resourceId, c.provider, c.loginIdentifier, c.vaultRef, lookups.personName(c.ownerTeamMemberId)]
          .join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [credentials, values, lookups]);

  const columns = React.useMemo<ColumnDef<CredentialRef, unknown>[]>(() => [
    { id: 'id', header: 'Reference ID', accessorKey: 'id' },
    {
      id: 'resourceId', header: 'Linked resource', accessorKey: 'resourceId',
      cell: ({ row }) => <RecordLink to={`/accounts/${row.original.resourceId}`}>{row.original.resourceId}</RecordLink>,
    },
    { id: 'provider', header: 'Provider', accessorKey: 'provider' },
    {
      id: 'loginIdentifier', header: 'Authorised login identifier', accessorKey: 'loginIdentifier',
      cell: ({ row }) => <span className="break-all text-[12px]">{row.original.loginIdentifier}</span>,
    },
    {
      id: 'vaultRef', header: 'Vault item reference', accessorKey: 'vaultRef',
      cell: ({ row }) => (
        <span className="flex items-center gap-1.5">
          <Lock className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          <code className="break-all text-[11px]">{row.original.vaultRef}</code>
        </span>
      ),
    },
    { id: 'owner', header: 'Credential owner', accessorFn: (r) => lookups.personName(r.ownerTeamMemberId) },
    {
      id: 'accessStatus', header: 'Access-request status', accessorKey: 'accessStatus',
      cell: ({ row }) => <StatusBadge kind="credential" value={row.original.accessStatus} />,
    },
    {
      id: 'lastRotationDate', header: 'Last rotation', accessorKey: 'lastRotationDate',
      cell: ({ row }) => {
        const since = daysSince(row.original.lastRotationDate);
        return (
          <span className="flex flex-col">
            <span className="tabular">{formatDate(row.original.lastRotationDate, 'never')}</span>
            <span className={`text-[11px] ${since === null || since > ROTATION_OVERDUE_DAYS ? 'text-warning' : 'text-muted-foreground'}`}>
              {since === null ? 'never rotated' : `${since} days ago`}
            </span>
          </span>
        );
      },
    },
    {
      id: 'twoFaEnabled', header: '2FA', accessorFn: (r) => (r.twoFaEnabled ? 'Enabled' : 'Disabled'),
      cell: ({ row }) => row.original.twoFaEnabled ? <Badge tone="success">enabled</Badge> : <Badge tone="warning">disabled</Badge>,
    },
    {
      id: 'recoveryReady', header: 'Recovery readiness', accessorFn: (r) => (r.recoveryReady ? 'Ready' : 'Not ready'),
      cell: ({ row }) => row.original.recoveryReady ? <Badge tone="success">ready</Badge> : <Badge tone="danger">not ready</Badge>,
    },
    {
      id: 'lastAccessVerifiedDate', header: 'Last access verification', accessorKey: 'lastAccessVerifiedDate',
      cell: ({ row }) => <span className="tabular">{formatDate(row.original.lastAccessVerifiedDate, 'never')}</span>,
    },
    {
      id: 'actions', header: 'Actions', enableSorting: false, enableHiding: false,
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              size="sm" variant="outline"
              disabled={!can('request:credential-access') || c.accessStatus === 'Requested'}
              onClick={() => update.mutate({ id: c.id, accessStatus: 'Requested', reason: 'Access requested through the CRM' })}
            >
              <KeyRound /> Request access
            </Button>
            <Button
              size="sm" variant="outline" disabled={!can('manage:credential-refs')}
              onClick={() => update.mutate({ id: c.id, lastRotationDate: toISODate(new Date()), reason: 'Rotation recorded' })}
            >
              <RotateCw /> Record rotation
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setHistoryFor(c)}>History</Button>
          </div>
        );
      },
    },
  ], [lookups, can, update]);

  const audit = React.useMemo(
    () => (data?.auditEntries ?? []).filter((a) => a.recordId === historyFor?.id || a.recordId === historyFor?.resourceId),
    [data, historyFor],
  );

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  const rotationOverdue = credentials.filter((c) => {
    const since = daysSince(c.lastRotationDate);
    return since === null || since > ROTATION_OVERDUE_DAYS;
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Credential references"
        description="Pointers to an external vault, plus the operational facts around them. This system stores no passwords, tokens, recovery codes or session cookies — anywhere."
        actions={
          <>
            <ExportButton
              rows={filtered}
              recordType="Credential Reference"
              filename="credential-references"
              columns={[
                { key: 'id', header: 'Reference ID', value: (r) => r.id },
                { key: 'resourceId', header: 'Linked resource', value: (r) => r.resourceId },
                { key: 'provider', header: 'Provider', value: (r) => r.provider },
                { key: 'owner', header: 'Credential owner', value: (r) => lookups.personName(r.ownerTeamMemberId) },
                { key: 'accessStatus', header: 'Access-request status', value: (r) => r.accessStatus },
                { key: 'lastRotationDate', header: 'Last rotation date', value: (r) => r.lastRotationDate },
                { key: 'twoFaEnabled', header: '2FA enabled', value: (r) => (r.twoFaEnabled ? 'Yes' : 'No') },
                { key: 'recoveryReady', header: 'Recovery readiness', value: (r) => (r.recoveryReady ? 'Ready' : 'Not ready') },
                { key: 'lastAccessVerifiedDate', header: 'Last access verification', value: (r) => r.lastAccessVerifiedDate },
              ]}
              disabledReason="Vault references and login identifiers are excluded from exports."
            />
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        <NotConnectedNotice what="No password manager or server-side vault is wired up. “Request access” and “Record rotation” update this register only — they do not reach a vault, and no secret can be retrieved from this screen." />
        <SecurityNotice>
          The interface is integration-ready: each record already carries the vault item reference, owner and
          access-request state a real vault integration would need in a later phase.
        </SecurityNotice>
      </div>

      <KpiGrid className="lg:grid-cols-4">
        <KpiCard label="Credential references" value={credentials.length} icon={<KeyRound className="h-4 w-4" />} />
        <KpiCard label="Access approved" value={credentials.filter((c) => c.accessStatus === 'Approved').length} tone="success" to="/credentials?status=Approved" />
        <KpiCard label="Recovery not ready" value={credentials.filter((c) => !c.recoveryReady).length} tone="danger" to="/credentials?recovery=not-ready" icon={<ShieldCheck className="h-4 w-4" />} />
        <KpiCard label={`Rotation older than ${ROTATION_OVERDUE_DAYS} days`} value={rotationOverdue.length} tone="warning" to="/credentials?rotation=overdue" />
      </KpiGrid>

      <FilterBar onClear={clear} activeCount={activeCount}>
        <SearchInput id="cred-search" value={values.search} onChange={(v) => set({ search: v })}
          placeholder="Search reference, resource, provider, owner…" className="min-w-[16rem] flex-1" />
        <FilterSelect id="cred-status" label="Access status" value={values.status} onChange={(v) => set({ status: v })}
          options={[{ value: 'all', label: 'All' }, ...CREDENTIAL_ACCESS_STATUS.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="cred-2fa" label="2FA" value={values.twofa} onChange={(v) => set({ twofa: v })}
          options={[{ value: 'all', label: 'All' }, { value: 'on', label: 'Enabled' }, { value: 'off', label: 'Disabled' }]} />
        <FilterSelect id="cred-recovery" label="Recovery" value={values.recovery} onChange={(v) => set({ recovery: v })}
          options={[{ value: 'all', label: 'All' }, { value: 'ready', label: 'Ready' }, { value: 'not-ready', label: 'Not ready' }]} />
        <FilterSelect id="cred-rotation" label="Rotation" value={values.rotation} onChange={(v) => set({ rotation: v })}
          options={[{ value: 'all', label: 'Any' }, { value: 'overdue', label: `Older than ${ROTATION_OVERDUE_DAYS} days` }, { value: 'never', label: 'Never rotated' }]} />
      </FilterBar>

      <DataTable
        tableId="credentials"
        columns={columns}
        data={filtered}
        isLoading={isLoading}
        onRetry={() => refetch()}
        initialSorting={[{ id: 'id', desc: false }]}
        initialHidden={['loginIdentifier', 'lastAccessVerifiedDate']}
        emptyTitle="No credential references match"
      />

      <Dialog open={Boolean(historyFor)} onOpenChange={(v) => !v && setHistoryFor(undefined)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Credential lifecycle — {historyFor?.id}</DialogTitle>
            <DialogDescription>
              Requests, approvals, rotations and verification events. Secret values never appear in this history.
            </DialogDescription>
          </DialogHeader>
          <SectionCard title="Lifecycle entries">
            <AuditTimeline entries={audit} emptyTitle="No lifecycle events recorded yet" />
          </SectionCard>
        </DialogContent>
      </Dialog>
    </div>
  );
}
