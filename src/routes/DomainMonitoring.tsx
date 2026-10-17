import { PageHeader } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { useCrmData } from '@/hooks/useData';
import { toISODate, addDays } from '@/lib/utils';
import { dailyCheckBucket } from '@/features/domain-monitoring/badges';
import { DomainMonitorTable } from '@/features/domain-monitoring/DomainMonitorTable';
import { useDomainMonitoringExportSources } from '@/features/domain-monitoring/useDomainMonitoringExportSources';

export default function DomainMonitoringPage() {
  const { data, isLoading } = useCrmData();
  useDomainMonitoringExportSources();
  const monitors = data?.domainMonitors ?? [];
  const live = monitors.filter((d) => !d.archived);

  const accessible = live.filter((d) => d.lastAccessibilityStatus === 'Accessible').length;
  const inaccessible = live.filter((d) => d.lastAccessibilityStatus === 'Inaccessible').length;
  const pendingToday = live.filter((d) => dailyCheckBucket(d.lastCheckedDate) !== 'checked-today').length;
  const freeCash = live.filter((d) => d.domainType === 'Free Cash');
  const invite = live.filter((d) => d.domainType === 'Invite');
  const enabledFreeCash = freeCash.filter((d) => d.enabled).length;
  const enabledInvite = invite.filter((d) => d.enabled).length;
  const tomorrow = toISODate(addDays(new Date(), 1));
  const dueTomorrow = live.filter((d) => d.nextRotationDate === tomorrow).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Domain Monitoring"
        description="Manage daily domain checks, accessibility records, and a manual rotation reminder date."
      />

      <KpiGrid>
        <KpiCard label="Total Domains" value={live.length} loading={isLoading} />
        <KpiCard label="Accessible Domains" value={accessible} tone="success" loading={isLoading} />
        <KpiCard label="Pending Daily Checks" value={pendingToday} tone="warning" loading={isLoading} />
        <KpiCard label="Inaccessible Domains" value={inaccessible} tone="danger" loading={isLoading} />
        <KpiCard label="Enabled Free Cash Domains" value={`${enabledFreeCash}/${freeCash.length}`} tone="info" loading={isLoading} />
        <KpiCard label="Enabled Invite Domains" value={`${enabledInvite}/${invite.length}`} tone="info" loading={isLoading} />
        <KpiCard label="Rotation Due Tomorrow" value={dueTomorrow} tone={dueTomorrow > 0 ? 'warning' : undefined} hint="Next Rotation Date is tomorrow." loading={isLoading} />
      </KpiGrid>

      <Tabs defaultValue="free-cash">
        <TabsList>
          <TabsTrigger value="free-cash">Free Cash Domains</TabsTrigger>
          <TabsTrigger value="invite">Invite Domains</TabsTrigger>
        </TabsList>

        <TabsContent value="free-cash">
          <DomainMonitorTable
            domainType="Free Cash"
            title="Free Cash Domains"
            description="Daily accessibility monitoring."
          />
        </TabsContent>

        <TabsContent value="invite">
          <DomainMonitorTable
            domainType="Invite"
            title="Invite Domains"
            description="Daily accessibility monitoring, plus a manual Enabled/Disabled switch and rotation reminder date."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
