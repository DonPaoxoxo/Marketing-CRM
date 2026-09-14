import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Pencil } from 'lucide-react';
import { PageHeader, DefinitionList, StatusBadge, ErrorState, EmptyState, RecordLink, SectionCard, SecurityNotice, NotConnectedNotice, SafeExternalLink } from '@/components/common/bits';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { AssignmentList } from '@/components/common/AssignmentList';
import { ConfirmWithReason } from '@/components/common/controls';
import { AgentFormDialog } from '@/features/agents/AgentFormDialog';
import { ProofGallery, useAgentProofs, useMayEditAgent } from '@/features/agents/proofs';
import { agentLockReason, mayArchiveAgent } from '@/lib/access';
import { SalaryStatusControl } from '@/features/agents/SalaryStatus';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { daysUntil, formatDate, maskEmail, maskPhone, relativeDays } from '@/lib/utils';
import type { Agent } from '@/lib/types';

export default function AgentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { showContactDetails: showContact, actorId, role, permissions } = useSession();
  const update = useUpdate<Agent>('agents', 'Agent');
  const [editOpen, setEditOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [restoreOpen, setRestoreOpen] = React.useState(false);

  const agent = data?.agents.find((a) => a.id === id);
  const mayEdit = useMayEditAgent(agent);
  const proofs = useAgentProofs(agent?.id);
  const agentAssignments = (data?.assignments ?? []).filter((a) => a.newAssigneeType === 'Agent' && a.newAssigneeId === id);
  const activeAssignments = agentAssignments.filter((a) => a.active);
  const sims = (data?.sims ?? []).filter((s) => s.assigneeType === 'Agent' && s.assigneeId === id);
  const audit = (data?.auditEntries ?? []).filter((a) => a.recordId === id || agentAssignments.some((x) => x.resourceId === a.recordId));

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!agent) {
    return <EmptyState title="Agent not found" description={`No agent with ID ${id}.`} action={<Button variant="outline" asChild><Link to="/agents">Back to register</Link></Button>} />;
  }

  const followUpDays = daysUntil(agent.nextFollowUpDate);
  const lockReason = agentLockReason({ id: actorId, role, permissions }, agent, lookups.personName(agent.managerId));
  const mayArchive = mayArchiveAgent({ role, permissions });

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => navigate('/agents')}>
        <ArrowLeft /> Agent register
      </Button>

      <PageHeader
        title={agent.name}
        description={`${agent.id} · ${agent.agentType} · managed by ${lookups.personName(agent.managerId)}`}
        actions={
          <>
            <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">Salary status <SalaryStatusControl agent={agent} /></span>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!mayEdit} title={lockReason ?? undefined}><Pencil /> Edit</Button>
            {agent.archived ? (
              <Button variant="outline" size="sm" onClick={() => setRestoreOpen(true)} disabled={!mayArchive} title={mayArchive ? undefined : 'Your role cannot archive or restore agents.'}><ArchiveRestore /> Restore</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)} disabled={!mayArchive} title={mayArchive ? undefined : 'Your role cannot archive or restore agents.'}><Archive /> Archive</Button>
            )}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="cooperation" value={agent.cooperationStatus} />
          {agent.archived && <Badge tone="danger">archived</Badge>}
          {followUpDays !== null && followUpDays <= 14 && (
            <Badge tone={followUpDays < 0 ? 'danger' : 'warning'}>Follow-up {relativeDays(followUpDays)}</Badge>
          )}
          {!agent.agreementRef && <Badge tone="warning">no agreement reference</Badge>}
        </div>
        {lockReason && <p className="mt-2 text-[12px] text-muted-foreground">{lockReason}</p>}
      </PageHeader>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="resources">Assigned resources ({activeAssignments.length + sims.length})</TabsTrigger>
          <TabsTrigger value="proofs">Proofs ({proofs.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="history">History ({agentAssignments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <SecurityNotice>This agent has no CRM login. Workspace access is granted separately under Roles &amp; Audit.</SecurityNotice>
          <SectionCard title="Agent record">
            <DefinitionList
              columns={3}
              items={[
                { label: 'Agent UID', value: agent.id },
                { label: 'UID', value: agent.externalUid || '—' },
                { label: 'Name or business name', value: agent.name },
                { label: 'Agent type', value: agent.agentType },
                { label: 'Contact number', value: <span className="tabular">{showContact ? agent.contactNumber : maskPhone(agent.contactNumber)}</span>, hint: showContact ? undefined : 'Masked for your role' },
                { label: 'Email', value: showContact ? agent.email : maskEmail(agent.email) },
                { label: 'Preferred channel', value: agent.preferredChannel },
                { label: 'Assigned manager', value: lookups.personName(agent.managerId) },
                { label: 'Associated brands', value: agent.brandIds.length ? agent.brandIds.map(lookups.brandName).join(', ') : '—' },
                { label: 'Projects', value: agent.projectIds.length ? agent.projectIds.map(lookups.projectName).join(', ') : '—' },
                { label: 'Cooperation status', value: <StatusBadge kind="cooperation" value={agent.cooperationStatus} /> },
                { label: 'Start date', value: formatDate(agent.startDate) },
                { label: 'Last contacted', value: formatDate(agent.lastContactedDate) },
                { label: 'Next follow-up', value: formatDate(agent.nextFollowUpDate), hint: relativeDays(followUpDays) },
                { label: 'Agreement reference', value: agent.agreementRef || '—' },
                { label: 'Notes', value: agent.notes || '—' },
              ]}
            />
          </SectionCard>

          <SectionCard title="Channels and profile URLs">
            {agent.channelUrls.length === 0 ? (
              <EmptyState title="No channels recorded" />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {agent.channelUrls.map((url) => (
                  <li key={url}>
                    <SafeExternalLink href={url} className="text-[13px]" />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="resources" className="flex flex-col gap-4">
          <SectionCard title="SIMs assigned to this agent">
            {sims.length === 0 ? <EmptyState title="No SIMs assigned" /> : (
              <ul className="flex flex-col divide-y divide-border">
                {sims.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <RecordLink to={`/sims/${s.id}`}>{showContact ? s.phoneNumber : maskPhone(s.phoneNumber)}</RecordLink>
                      <p className="text-[12px] text-muted-foreground">{s.id} · {s.provider} · {lookups.brandName(s.brandId)}</p>
                    </div>
                    <StatusBadge kind="simOperational" value={s.operationalStatus} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
          <SectionCard title="Active resource assignments" description="Accounts and other resources this agent currently holds.">
            <AssignmentList assignments={activeAssignments} personName={lookups.personName} emptyTitle="No active assignments" />
          </SectionCard>
        </TabsContent>

        <TabsContent value="proofs">
          <SectionCard title="Proofs">
            <ProofGallery agent={agent} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="activity">
          <SectionCard title="Contact activity" description="Derived from the contact dates on this record. Manual entry only — no messaging integration.">
            <NotConnectedNotice what="Messaging and call platforms are not connected. Dates below are entered by the team." className="mb-4" />
            <DefinitionList
              items={[
                { label: 'Last contacted', value: formatDate(agent.lastContactedDate), hint: relativeDays(daysUntil(agent.lastContactedDate)) },
                { label: 'Next follow-up', value: formatDate(agent.nextFollowUpDate), hint: relativeDays(followUpDays) },
                { label: 'Preferred channel', value: agent.preferredChannel },
                { label: 'Cooperation since', value: formatDate(agent.startDate) },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="documents">
          <SectionCard title="Documents">
            <NotConnectedNotice what="Document storage is out of scope for this phase. Only reference identifiers are recorded." className="mb-4" />
            {agent.agreementRef ? (
              <DefinitionList items={[{ label: 'Agreement or document reference', value: agent.agreementRef }]} />
            ) : (
              <EmptyState title="No document reference" description="Add an agreement reference on this record." />
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="history" className="flex flex-col gap-4">
          <SectionCard title="Assignment history">
            <AssignmentList assignments={agentAssignments} personName={lookups.personName} />
          </SectionCard>
          <SectionCard title="Audit history">
            <AuditTimeline entries={audit} />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <AgentFormDialog open={editOpen} onOpenChange={setEditOpen} agent={agent} />
      <ConfirmWithReason
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${agent.name}?`}
        description="Archiving removes the agent from the register and reports. Assignment history is preserved."
        onConfirm={(reason) => update.mutateAsync({ id: agent.id, archived: true, reason })}
      />
      <ConfirmWithReason
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        title={`Restore ${agent.name}?`}
        description="The agent returns to the active register and reports. Its history is kept."
        confirmLabel="Restore agent"
        danger={false}
        placeholder="Why is this agent being restored? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={(reason) => update.mutateAsync({ id: agent.id, archived: false, reason })}
      />
    </div>
  );
}
