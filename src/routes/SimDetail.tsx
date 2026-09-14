import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Archive, Pencil } from 'lucide-react';
import { PageHeader, DefinitionList, StatusBadge, ErrorState, EmptyState, RecordLink, SectionCard, SafeExternalLink } from '@/components/common/bits';
import { telegramUrl } from '@/lib/identity';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { AssignmentList } from '@/components/common/AssignmentList';
import { ConfirmWithReason } from '@/components/common/controls';
import { SimFormDialog } from '@/features/sims/SimFormDialog';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { DEFAULT_THRESHOLDS } from '@/lib/rules';
import { daysUntil, formatDate, maskEmail, maskPhone, relativeDays } from '@/lib/utils';
import type { Sim } from '@/lib/types';

export default function SimDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { can, showContactDetails: showContact } = useSession();
  const update = useUpdate<Sim>('sims', 'SIM record');
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const sim = data?.sims.find((s) => s.id === id);
  const linkedAccounts = (data?.socialAccounts ?? []).filter((a) => a.simIds.includes(id ?? ''));
  const simAssignments = (data?.assignments ?? []).filter((a) => a.resourceType === 'SIM' && a.resourceId === id);
  const audit = (data?.auditEntries ?? []).filter((a) => a.recordId === id);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!sim) {
    return <EmptyState title="SIM record not found" description={`No record with ID ${id}.`} action={<Button variant="outline" asChild><Link to="/sims">Back to register</Link></Button>} />;
  }

  const expiryDays = daysUntil(sim.planExpiryDate);

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => navigate('/sims')}>
        <ArrowLeft /> SIM register
      </Button>

      <PageHeader
        title={showContact ? sim.phoneNumber : maskPhone(sim.phoneNumber)}
        description={`${sim.id} · ${sim.provider} · ${lookups.countryName(sim.countryCode)} · ${sim.form}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!can('edit:resources')}>
              <Pencil /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)} disabled={!can('archive:records') || sim.archived}>
              <Archive /> Archive
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="simOperational" value={sim.operationalStatus} />
          <StatusBadge kind="allocation" value={sim.allocationStatus} />
          {sim.archived && <Badge tone="danger">archived</Badge>}
          {expiryDays !== null && expiryDays <= DEFAULT_THRESHOLDS.simRenewalWindowDays && (
            <Badge tone={expiryDays < 0 ? 'danger' : 'warning'}>
              {expiryDays < 0 ? 'Expired' : 'Renewal due'} {relativeDays(expiryDays)}
            </Badge>
          )}
        </div>
      </PageHeader>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="accounts">Linked accounts ({linkedAccounts.length})</TabsTrigger>
          <TabsTrigger value="assignments">Assignments ({simAssignments.length})</TabsTrigger>
          <TabsTrigger value="history">History ({audit.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <SectionCard title="SIM record">
            <DefinitionList
              columns={3}
              items={[
                { label: 'SIM record ID', value: sim.id },
                { label: 'Full phone number', value: <span className="tabular">{showContact ? sim.phoneNumber : maskPhone(sim.phoneNumber)}</span>, hint: showContact ? undefined : 'Masked for your role' },
                { label: 'Country', value: lookups.countryName(sim.countryCode) },
                { label: 'Network provider', value: sim.provider },
                { label: 'SIM form', value: sim.form },
                { label: 'Created For', value: sim.createdFor || '—' },
                {
                  label: 'Email',
                  value: sim.email ? (showContact ? sim.email : maskEmail(sim.email)) : '—',
                  hint: sim.email && !showContact ? 'Masked for your role' : undefined,
                },
                {
                  label: 'Telegram',
                  value: sim.telegramUsername
                    ? <SafeExternalLink href={telegramUrl(sim.telegramUsername)}>{telegramUrl(sim.telegramUsername)}</SafeExternalLink>
                    : '—',
                },
                { label: 'Assigned employee or agent', value: lookups.personName(sim.assigneeId), hint: sim.assigneeType ?? undefined },
                { label: 'Associated brand', value: lookups.brandName(sim.brandId) },
                { label: 'Project', value: lookups.projectName(sim.projectId) },
                { label: 'Operational status', value: <StatusBadge kind="simOperational" value={sim.operationalStatus} /> },
                { label: 'Allocation status', value: <StatusBadge kind="allocation" value={sim.allocationStatus} /> },
                { label: 'Plan expiry / renewal', value: formatDate(sim.planExpiryDate), hint: relativeDays(expiryDays) },
                { label: 'Last verified', value: formatDate(sim.lastVerifiedDate) },
                { label: 'Notes', value: sim.notes || '—' },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="accounts">
          <SectionCard
            title="Social accounts using this number"
            description="One SIM may legitimately serve several accounts. Unusually high fan-out is flagged for review rather than blocked."
          >
            {linkedAccounts.length === 0 ? (
              <EmptyState title="No linked accounts" description="This number is not referenced by any social account record." />
            ) : (
              <>
                {linkedAccounts.length > DEFAULT_THRESHOLDS.simFanOutReviewThreshold && (
                  <p className="mb-3 rounded-md border border-warning/40 bg-warning-bg/50 px-3 py-2 text-[12px]">
                    This number is linked to {linkedAccounts.length} accounts, above the review threshold of{' '}
                    {DEFAULT_THRESHOLDS.simFanOutReviewThreshold}. Worth a human check — not necessarily invalid.
                  </p>
                )}
                <ul className="flex flex-col divide-y divide-border">
                  {linkedAccounts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <RecordLink to={`/accounts/${a.id}`}>@{a.username}</RecordLink>
                        <p className="text-[12px] text-muted-foreground">
                          {a.id} · {lookups.platformName(a.platformId)} · {a.assetType} · {lookups.brandName(a.brandId)}
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        <StatusBadge kind="accountOperational" value={a.operationalStatus} />
                        <StatusBadge kind="accountAllocation" value={a.allocationStatus} />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="assignments">
          <SectionCard title="Assignment and handover history">
            <AssignmentList assignments={simAssignments} personName={lookups.personName} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="history">
          <SectionCard title="Audit history" description="Actor, timestamp, action, reason and safe field changes. Secret values are never recorded.">
            <AuditTimeline entries={audit} />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <SimFormDialog open={editOpen} onOpenChange={setEditOpen} sim={sim} />
      <ConfirmWithReason
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${sim.id}?`}
        description="Archiving hides the record from registers and reports. It is reversible and nothing is deleted."
        onConfirm={(reason) => update.mutateAsync({ id: sim.id, archived: true, reason })}
      />
    </div>
  );
}
