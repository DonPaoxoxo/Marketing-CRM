import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowLeft, Pencil, UserPlus } from 'lucide-react';
import {
  PageHeader, DefinitionList, StatusBadge, ErrorState, EmptyState, RecordLink,
  SectionCard, NotConnectedNotice, Measured, SafeExternalLink,
} from '@/components/common/bits';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { AssignmentList } from '@/components/common/AssignmentList';
import { ConfirmWithReason } from '@/components/common/controls';
import { AccountFormDialog } from '@/features/accounts/AccountFormDialog';
import { AssignDrawer } from '@/features/assignments/AssignDrawer';
import { ReadinessChecklist } from '@/features/reserves/ReadinessChecklist';
import { useCrmData, useUpdate } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { DEFAULT_THRESHOLDS, evaluateReserveReadiness } from '@/lib/rules';
import { daysSince, formatDate, formatNumber, maskEmail, maskPhone } from '@/lib/utils';
import { RECOVERY_DETAIL_HELP } from '@/lib/recovery';
import type { SocialAccount } from '@/lib/types';

export default function AccountDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { can, showContactDetails: showContact } = useSession();
  const update = useUpdate<SocialAccount>('social-accounts', 'Account');
  const [editOpen, setEditOpen] = React.useState(false);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const account = data?.socialAccounts.find((a) => a.id === id);
  const assignments = (data?.assignments ?? []).filter((a) => a.resourceType === 'Social Account' && a.resourceId === id);
  const audit = (data?.auditEntries ?? []).filter((a) => a.recordId === id);
  const credential = data?.credentials.find((c) => c.id === account?.credentialId);
  const linkedSims = (data?.sims ?? []).filter((s) => account?.simIds.includes(s.id));

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!account) {
    return <EmptyState title="Account not found" description={`No account with ID ${id}.`} action={<Button variant="outline" asChild><Link to="/accounts">Back to register</Link></Button>} />;
  }

  const readiness = evaluateReserveReadiness(account, data!.assignments);
  const sinceVerified = daysSince(account.lastAccessVerifiedDate);

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => navigate('/accounts')}>
        <ArrowLeft /> Account register
      </Button>

      <PageHeader
        title={`@${account.username}`}
        description={`${account.id} · ${lookups.platformName(account.platformId)} ${account.assetType} · ${account.displayName}`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAssignOpen(true)} disabled={!can('assign:resources')}>
              <UserPlus /> Assign
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={!can('edit:resources')}><Pencil /> Edit</Button>
            <Button variant="outline" size="sm" onClick={() => setArchiveOpen(true)} disabled={!can('archive:records') || account.archived}><Archive /> Archive</Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="accountOperational" value={account.operationalStatus} />
          <StatusBadge kind="accountAllocation" value={account.allocationStatus} />
          {account.twoFaEnabled ? <Badge tone="success">2FA {account.twoFaMethod}</Badge> : <Badge tone="warning">2FA off</Badge>}
          {!account.responsibleTeamMemberId && <Badge tone="danger">no owner</Badge>}
          {!account.credentialId && <Badge tone="warning">no credential reference</Badge>}
          {(sinceVerified === null || sinceVerified > DEFAULT_THRESHOLDS.accessVerificationWindowDays) && (
            <Badge tone="warning">access verification overdue</Badge>
          )}
          {account.archived && <Badge tone="danger">archived</Badge>}
        </div>
      </PageHeader>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="access">Access &amp; recovery</TabsTrigger>
          <TabsTrigger value="sims">Linked SIMs ({linkedSims.length})</TabsTrigger>
          <TabsTrigger value="assignments">Assignments ({assignments.length})</TabsTrigger>
          <TabsTrigger value="history">History ({audit.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-4">
          <SectionCard title="Account record">
            <DefinitionList
              columns={3}
              items={[
                { label: 'Internal account ID', value: account.id },
                { label: 'Platform', value: lookups.platformName(account.platformId) },
                { label: 'Asset type', value: account.assetType },
                { label: 'Display name', value: account.displayName },
                { label: 'Username or handle', value: `@${account.username}` },
                {
                  label: 'Profile URL',
                  value: account.profileUrl ? <SafeExternalLink href={account.profileUrl} /> : '—',
                },
                { label: 'Platform account ID', value: account.platformAccountId || '—' },
                { label: 'Associated brand', value: lookups.brandName(account.brandId) },
                { label: 'Project', value: lookups.projectName(account.projectId) },
                { label: 'Target country', value: lookups.countryName(account.targetCountryCode) },
                { label: 'Content language', value: account.contentLanguage },
                { label: 'Responsible employee', value: lookups.personName(account.responsibleTeamMemberId) },
                { label: 'Operational status', value: <StatusBadge kind="accountOperational" value={account.operationalStatus} /> },
                { label: 'Allocation status', value: <StatusBadge kind="accountAllocation" value={account.allocationStatus} /> },
                { label: 'Reserved for project', value: lookups.projectName(account.reservedForProjectId) },
                { label: 'Last posting date', value: formatDate(account.lastPostingDate) },
                {
                  label: 'Follower count',
                  value: <span className="flex flex-col"><span className="tabular">{formatNumber(account.followerCount)}</span><Measured date={account.followerCountMeasuredAt} /></span>,
                  hint: 'Manually entered figure',
                },
                { label: 'Notes', value: account.notes || '—' },
              ]}
            />
          </SectionCard>

          <SectionCard title="Reserve readiness" description="The same criteria the reserve inventory uses. Shown here so the gaps on any one account are obvious.">
            <ReadinessChecklist result={readiness} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="access" className="flex flex-col gap-4">
          <NotConnectedNotice what="Vault access and secret retrieval are not connected. This screen shows references only — no password, token, recovery code or session cookie is stored anywhere in this system." />
          <SectionCard title="Credential and recovery references">
            <DefinitionList
              columns={2}
              items={[
                { label: 'Login email reference', value: account.loginEmailRef || '—', hint: 'An identifier, not a credential' },
                {
                  label: 'Credential vault reference',
                  value: credential ? <RecordLink to={`/credentials?search=${credential.id}`}>{credential.vaultRef}</RecordLink> : <Badge tone="warning">not recorded</Badge>,
                },
                { label: 'Credential owner', value: credential ? lookups.personName(credential.ownerTeamMemberId) : '—' },
                { label: 'Access-request status', value: credential ? <StatusBadge kind="credential" value={credential.accessStatus} /> : '—' },
                { label: 'Recovery method', value: account.recoveryMethod },
                {
                  label: RECOVERY_DETAIL_HELP[account.recoveryMethod].label,
                  value: !account.recoveryRef ? '—'
                    : showContact ? account.recoveryRef
                      : account.recoveryMethod === 'Recovery Email' ? maskEmail(account.recoveryRef)
                        : account.recoveryMethod === 'Recovery Phone' ? maskPhone(account.recoveryRef)
                          : account.recoveryRef,
                  hint: 'Which recovery route exists — never a code',
                },
                { label: '2FA status', value: account.twoFaEnabled ? 'Enabled' : 'Disabled' },
                { label: '2FA method', value: account.twoFaMethod },
                { label: 'Last access verification', value: formatDate(account.lastAccessVerifiedDate, 'never'), hint: sinceVerified === null ? 'Never verified' : `${sinceVerified} days ago` },
                { label: 'Last rotation', value: credential ? formatDate(credential.lastRotationDate, 'never') : '—' },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="sims">
          <SectionCard title="Linked SIMs" description="One SIM may serve several accounts where that is operationally intended.">
            {linkedSims.length === 0 ? <EmptyState title="No linked SIMs" /> : (
              <ul className="flex flex-col divide-y divide-border">
                {linkedSims.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <RecordLink to={`/sims/${s.id}`}>{showContact ? s.phoneNumber : maskPhone(s.phoneNumber)}</RecordLink>
                      <p className="text-[12px] text-muted-foreground">{s.id} · {s.provider} · {lookups.countryName(s.countryCode)}</p>
                    </div>
                    <div className="flex gap-1.5">
                      <StatusBadge kind="simOperational" value={s.operationalStatus} />
                      <StatusBadge kind="allocation" value={s.allocationStatus} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="assignments">
          <SectionCard
            title="Assignment and handover history"
            actions={<Button size="sm" variant="outline" onClick={() => setAssignOpen(true)} disabled={!can('assign:resources')}><UserPlus /> New assignment</Button>}
          >
            <AssignmentList assignments={assignments} personName={lookups.personName} />
          </SectionCard>
        </TabsContent>

        <TabsContent value="history">
          <SectionCard title="Audit history">
            <AuditTimeline entries={audit} />
          </SectionCard>
        </TabsContent>
      </Tabs>

      <AccountFormDialog open={editOpen} onOpenChange={setEditOpen} account={account} />
      <AssignDrawer open={assignOpen} onOpenChange={setAssignOpen} resourceType="Social Account" resourceId={account.id} lockResource />
      <ConfirmWithReason
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Archive ${account.id}?`}
        description="Archiving removes the account from registers, reserve inventory and reports. History is preserved."
        onConfirm={(reason) => update.mutateAsync({ id: account.id, archived: true, reason })}
      />
    </div>
  );
}
