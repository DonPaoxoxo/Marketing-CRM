import { PageHeader } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { useCrmData } from '@/hooks/useData';
import { rotationScheduleBucket } from '@/lib/rules';
import { dailyCheckBucket } from '@/features/domain-monitoring/badges';
import { DomainMonitorTable } from '@/features/domain-monitoring/DomainMonitorTable';
import { RotationBatchPanel } from '@/features/domain-monitoring/RotationBatchPanel';
import { useDomainMonitoringExportSources } from '@/features/domain-monitoring/useDomainMonitoringExportSources';

export default function DomainMonitoringPage() {
  const { data, isLoading } = useCrmData();
  useDomainMonitoringExportSources();
  const monitors = data?.domainMonitors ?? [];
  const live = monitors.filter((d) => !d.archived);

  const accessible = live.filter((d) => d.lastAccessibilityStatus === 'Accessible').length;
  const inaccessible = live.filter((d) => d.lastAccessibilityStatus === 'Inaccessible').length;
  const pendingToday = live.filter((d) => dailyCheckBucket(d.lastCheckedDate) !== 'checked-today').length;
  const activeInvite = live.filter((d) => d.domainType === 'Invite' && d.activationStatus === 'Active').length;
  const rotationGroups = data?.rotationGroups ?? [];
  const rotationDue = rotationGroups.filter((g) => !g.archived && rotationScheduleBucket(g.nextRotationDueAt) !== 'on-schedule').length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Domain Monitoring & Rotation"
        description="Manage daily domain checks, accessibility records, and five-day Invite Domain rotation schedules."
      />

      <KpiGrid>
        <KpiCard label="Total Domains" value={live.length} loading={isLoading} />
        <KpiCard label="Accessible Domains" value={accessible} tone="success" loading={isLoading} />
        <KpiCard label="Pending Daily Checks" value={pendingToday} tone="warning" loading={isLoading} />
        <KpiCard label="Inaccessible Domains" value={inaccessible} tone="danger" loading={isLoading} />
        <KpiCard label="Active Invite Domains" value={activeInvite} tone="info" loading={isLoading} />
        <KpiCard label="Rotation Due" value={rotationDue} tone={rotationDue > 0 ? 'warning' : undefined} hint="Groups Due Soon (within 24h) or Overdue." loading={isLoading} />
      </KpiGrid>

      <Tabs defaultValue="free-cash">
        <TabsList>
          <TabsTrigger value="free-cash">Free Cash Domains</TabsTrigger>
          <TabsTrigger value="invite">Invite Domains</TabsTrigger>
          <TabsTrigger value="rotation">Rotation Management</TabsTrigger>
        </TabsList>

        <TabsContent value="free-cash">
          <DomainMonitorTable
            domainType="Free Cash"
            title="Free Cash Domains"
            description="Daily accessibility monitoring. No rotation — these are checked, not scheduled."
          />
        </TabsContent>

        <TabsContent value="invite">
          <DomainMonitorTable
            domainType="Invite"
            title="Invite Domains"
            description="Daily accessibility monitoring, plus activation status from the 5-day rotation cycle below."
          />
        </TabsContent>

        <TabsContent value="rotation">
          <RotationBatchPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
