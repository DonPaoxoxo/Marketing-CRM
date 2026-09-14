import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarClock, ClipboardList, KeyRound, PackageSearch,
  ShieldQuestion, Smartphone, UserRoundX, Users,
} from 'lucide-react';
import { PageHeader, SectionCard, ErrorState, EmptyState, StatusBadge, RecordLink } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { CategoryBarChart } from '@/components/charts/CategoryBarChart';
import { useCrmData } from '@/hooks/useData';
import {
  DEFAULT_THRESHOLDS, accountMissingCredential, accountMissingOwner,
  accountUnderReviewOrRestricted, evaluateReserveReadiness, reserveAccounts, simApproachingRenewal,
} from '@/lib/rules';
import { daysUntil, formatDate, groupCount, relativeDays } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';

export default function OverviewPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const navigate = useNavigate();

  const m = useMemo(() => {
    if (!data) return null;
    const sims = data.sims.filter((s) => !s.archived);
    const accounts = data.socialAccounts.filter((a) => !a.archived);
    const agents = data.agents.filter((a) => !a.archived);
    const reserves = reserveAccounts(accounts);
    const readyReserves = reserves.filter((a) => evaluateReserveReadiness(a, data.assignments).ready);

    const followUps = agents
      .filter((a) => {
        const d = daysUntil(a.nextFollowUpDate);
        return d !== null && d <= DEFAULT_THRESHOLDS.followUpWindowDays;
      })
      .sort((a, b) => (a.nextFollowUpDate ?? '').localeCompare(b.nextFollowUpDate ?? ''));

    const pendingHandovers = data.assignments
      .filter((a) => a.active && (a.handoverStatus === 'Pending' || a.handoverStatus === 'In Progress'))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    const renewals = sims.filter((s) => simApproachingRenewal(s)).sort((a, b) => (a.planExpiryDate ?? '').localeCompare(b.planExpiryDate ?? ''));

    return {
      sims,
      totalSims: sims.length,
      renewals,
      activeAgents: agents.filter((a) => a.cooperationStatus === 'Active').length,
      totalAccounts: accounts.length,
      assignedAccounts: accounts.filter((a) => a.allocationStatus === 'Assigned').length,
      reserves,
      readyReserves,
      reserveByPlatform: groupCount(reserves, (a) => lookups.platformName(a.platformId)),
      reserveByBrand: groupCount(reserves, (a) => (a.brandId ? lookups.brandName(a.brandId) : 'No brand')),
      underReview: accounts.filter(accountUnderReviewOrRestricted),
      missingOwner: accounts.filter(accountMissingOwner),
      missingCredential: accounts.filter(accountMissingCredential),
      followUps,
      pendingHandovers,
    };
  }, [data, lookups]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="Every figure below is calculated from the same records the tables show. Select any metric to open exactly those records."
      />

      <KpiGrid>
        <KpiCard label="Total SIM records" value={m?.totalSims ?? 0} to="/sims" icon={<Smartphone className="h-4 w-4" />} loading={isLoading} />
        <KpiCard
          label="SIMs approaching expiry or renewal"
          value={m?.renewals.length ?? 0}
          to="/sims?expiry=due"
          tone="warning"
          hint={`Within ${DEFAULT_THRESHOLDS.simRenewalWindowDays} days, or already past`}
          icon={<CalendarClock className="h-4 w-4" />}
          loading={isLoading}
        />
        <KpiCard label="Active agents" value={m?.activeAgents ?? 0} to="/agents?coop=Active" icon={<Users className="h-4 w-4" />} loading={isLoading} />
        <KpiCard label="Total social media accounts" value={m?.totalAccounts ?? 0} to="/accounts" icon={<ClipboardList className="h-4 w-4" />} loading={isLoading} />
        <KpiCard label="Assigned accounts" value={m?.assignedAccounts ?? 0} to="/accounts?alloc=Assigned" tone="success" loading={isLoading} />
        <KpiCard
          label="Available reserve accounts"
          value={m?.reserves.length ?? 0}
          to="/reserves"
          tone="info"
          hint={`${m?.readyReserves.length ?? 0} meet every readiness criterion`}
          icon={<PackageSearch className="h-4 w-4" />}
          loading={isLoading}
        />
        <KpiCard
          label="Accounts under review or restricted"
          value={m?.underReview.length ?? 0}
          to="/accounts?flag=review"
          tone="warning"
          icon={<ShieldQuestion className="h-4 w-4" />}
          loading={isLoading}
        />
        <KpiCard
          label="Accounts missing an owner"
          value={m?.missingOwner.length ?? 0}
          to="/accounts?flag=no-owner"
          tone="danger"
          icon={<UserRoundX className="h-4 w-4" />}
          loading={isLoading}
        />
        <KpiCard
          label="Accounts missing a credential reference"
          value={m?.missingCredential.length ?? 0}
          to="/accounts?flag=no-credential"
          tone="danger"
          icon={<KeyRound className="h-4 w-4" />}
          loading={isLoading}
        />
        <KpiCard
          label="Upcoming agent follow-ups"
          value={m?.followUps.length ?? 0}
          to="/agents?followup=due"
          hint={`Due within ${DEFAULT_THRESHOLDS.followUpWindowDays} days, or overdue`}
          tone="info"
          loading={isLoading}
        />
        <KpiCard
          label="Handovers awaiting acknowledgment"
          value={m?.pendingHandovers.length ?? 0}
          to="/assignments?handover=open"
          tone="warning"
          icon={<AlertTriangle className="h-4 w-4" />}
          loading={isLoading}
        />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard
          title="Reserve inventory"
          description="Reserve inventory is a filtered view of the account register, not a separate list."
          actions={<Link to="/reserves" className="text-[12px] font-medium text-primary hover:underline">Open inventory</Link>}
        >
          <CategoryBarChart
            title="Reserve accounts by platform"
            description="Select a bar to open those reserve records."
            valueName="Reserve accounts"
            data={Object.entries(m?.reserveByPlatform ?? {}).map(([label, value]) => ({ label, value }))}
            onSelect={(d) => navigate(`/reserves?platform=${encodeURIComponent(d.label)}`)}
          />
        </SectionCard>

        <SectionCard title="Reserve inventory by brand" description="Counts exclude suspended, restricted and closed accounts.">
          <CategoryBarChart
            title="Reserve accounts by brand"
            description="Select a bar to open those reserve records."
            valueName="Reserve accounts"
            data={Object.entries(m?.reserveByBrand ?? {}).map(([label, value]) => ({ label, value }))}
            onSelect={(d) => navigate(`/reserves?brand=${encodeURIComponent(d.label)}`)}
          />
        </SectionCard>

        <SectionCard title="Upcoming agent follow-ups" description="Soonest first. Overdue items appear at the top.">
          {!m?.followUps.length ? (
            <EmptyState title="Nothing due" description="No agent follow-ups fall inside the window." />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {m.followUps.slice(0, 6).map((a) => {
                const d = daysUntil(a.nextFollowUpDate);
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <RecordLink to={`/agents/${a.id}`}>{a.name}</RecordLink>
                      <p className="text-[12px] text-muted-foreground">{a.id} · {a.agentType}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] tabular">{formatDate(a.nextFollowUpDate)}</p>
                      <Badge tone={d !== null && d < 0 ? 'danger' : 'warning'}>{relativeDays(d)}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Handovers awaiting acknowledgment" description="Assignments recorded but not yet confirmed by the recipient.">
          {!m?.pendingHandovers.length ? (
            <EmptyState title="All handovers acknowledged" />
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {m.pendingHandovers.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">{a.resourceId}</p>
                    <p className="truncate text-[12px] text-muted-foreground">
                      {a.resourceType} → {lookups.personName(a.newAssigneeId)}
                    </p>
                  </div>
                  <div className="text-right">
                    <StatusBadge kind="handover" value={a.handoverStatus} />
                    <p className="mt-0.5 text-[11px] text-muted-foreground tabular">{formatDate(a.startDate)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
