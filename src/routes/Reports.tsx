import * as React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, SectionCard, ErrorState, EmptyState, StatusBadge, SecurityNotice, Measured } from '@/components/common/bits';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { ExportButton } from '@/components/common/controls';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { CategoryBarChart } from '@/components/charts/CategoryBarChart';
import { findIntegrityIssues, summariseIssues } from '@/lib/integrity';
import { StackedBarChart } from '@/components/charts/StackedBarChart';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { useCrmData } from '@/hooks/useData';
import {
  DEFAULT_THRESHOLDS, accountAwaitingVerification, accountMissingCredential,
  accountMissingOwner, evaluateReserveReadiness, reserveAccounts, simApproachingRenewal,
} from '@/lib/rules';
import { daysSince, daysUntil, formatDate, groupCount, relativeDays } from '@/lib/utils';

/** Small presentational table used by every report tab. */
function ReportTable<T>({ rows, columns, empty }: {
  rows: T[];
  columns: { header: string; cell: (r: T) => React.ReactNode; className?: string }[];
  empty: string;
}) {
  if (!rows.length) return <EmptyState title={empty} />;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead className="bg-surface-2">
          <tr>
            {columns.map((c) => (
              <th key={c.header} scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border last:border-0">
              {columns.map((c) => <td key={c.header} className={`px-3 py-2 ${c.className ?? ''}`}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();

  const r = React.useMemo(() => {
    if (!data) return null;
    const accounts = data.socialAccounts.filter((a) => !a.archived);
    const sims = data.sims.filter((s) => !s.archived);
    const agents = data.agents.filter((a) => !a.archived);
    const reserves = reserveAccounts(accounts);

    const byPlatform = groupCount(accounts, (a) => lookups.platformName(a.platformId));
    const byBrand = groupCount(accounts, (a) => (a.brandId ? lookups.brandName(a.brandId) : 'No brand'));
    const byCountry = groupCount(accounts, (a) => lookups.countryName(a.targetCountryCode));
    const toData = (g: Record<string, number>) => Object.entries(g).map(([label, value]) => ({ label, value }));

    const inventory = [
      ...Object.entries(byPlatform).map(([k, v]) => ({ dimension: 'Platform', value: k, count: v })),
      ...Object.entries(byBrand).map(([k, v]) => ({ dimension: 'Brand', value: k, count: v })),
      ...Object.entries(byCountry).map(([k, v]) => ({ dimension: 'Country', value: k, count: v })),
    ];

    const allocation = [
      { resource: 'Social accounts', assigned: accounts.filter((a) => a.allocationStatus === 'Assigned').length, reserved: accounts.filter((a) => a.allocationStatus === 'Reserved').length, available: accounts.filter((a) => a.allocationStatus === 'Unassigned').length, total: accounts.length },
      { resource: 'SIMs', assigned: sims.filter((s) => s.allocationStatus === 'Assigned').length, reserved: sims.filter((s) => s.allocationStatus === 'Reserved').length, available: sims.filter((s) => s.allocationStatus === 'Available').length, total: sims.length },
    ];

    return {
      inventory,
      inventoryCharts: [
        { title: 'Accounts by platform', data: toData(byPlatform) },
        { title: 'Accounts by brand', data: toData(byBrand) },
        { title: 'Accounts by target country', data: toData(byCountry) },
      ],
      allocation,
      reserveReadiness: reserves.map((a) => ({ account: a, result: evaluateReserveReadiness(a, data.assignments) })),
      renewals: sims.filter((s) => simApproachingRenewal(s)).sort((a, b) => (a.planExpiryDate ?? '').localeCompare(b.planExpiryDate ?? '')),
      followUps: agents.filter((a) => {
        const d = daysUntil(a.nextFollowUpDate);
        return d !== null && d <= DEFAULT_THRESHOLDS.followUpWindowDays;
      }).sort((x, y) => (x.nextFollowUpDate ?? '').localeCompare(y.nextFollowUpDate ?? '')),
      awaitingVerification: accounts.filter((a) => accountAwaitingVerification(a)),
      missingInfo: accounts.filter((a) => accountMissingOwner(a) || accountMissingCredential(a) || a.recoveryMethod === 'None'),
      assignments: data.assignments,
      accounts,
      issues: findIntegrityIssues(data),
    };
  }, [data, lookups]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (isLoading || !r) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-72 w-full" /></div>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Reports"
        description="Reporting over the same records the registers show. Every export excludes secrets and credential-recovery material, and manually entered metrics carry their measurement date."
      />

      <SecurityNotice>
        Follower counts and similar metrics are <strong>manually entered</strong> and are labelled with the date they
        were measured. Nothing on this page is synchronised live from a platform.
      </SecurityNotice>

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="allocation">Assigned vs available</TabsTrigger>
          <TabsTrigger value="readiness">Reserve readiness</TabsTrigger>
          <TabsTrigger value="renewals">SIM renewals</TabsTrigger>
          <TabsTrigger value="followups">Agent follow-ups</TabsTrigger>
          <TabsTrigger value="verification">Awaiting verification</TabsTrigger>
          <TabsTrigger value="missing">Missing information</TabsTrigger>
          <TabsTrigger value="handovers">Handover history</TabsTrigger>
          <TabsTrigger value="quality">Data quality</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <SectionCard
            title="Resource inventory by platform, brand and country"
            actions={<ExportButton rows={r.inventory} recordType="Report" filename="inventory-report"
              columns={[
                { key: 'dimension', header: 'Dimension', value: (x) => x.dimension },
                { key: 'value', header: 'Value', value: (x) => x.value },
                { key: 'count', header: 'Accounts', value: (x) => x.count },
              ]} />}
          >
            {/* Small multiples: three separate magnitude comparisons, each a single
                series on one shared hue — never one chart with three stacked scales. */}
            <div className="grid gap-6 lg:grid-cols-3">
              {r.inventoryCharts.map((c) => (
                <CategoryBarChart key={c.title} title={c.title} data={c.data} valueName="Accounts" />
              ))}
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="allocation">
          <SectionCard
            title="Assigned versus available resources"
            actions={<ExportButton rows={r.allocation} recordType="Report" filename="allocation-report"
              columns={[
                { key: 'resource', header: 'Resource', value: (x) => x.resource },
                { key: 'assigned', header: 'Assigned', value: (x) => x.assigned },
                { key: 'reserved', header: 'Reserved', value: (x) => x.reserved },
                { key: 'available', header: 'Available', value: (x) => x.available },
                { key: 'total', header: 'Total', value: (x) => x.total },
              ]} />}
          >
            <StackedBarChart
              title="Allocation state by resource type"
              description="Part-to-whole across the two resource registers."
              rows={r.allocation.map((x) => x.resource)}
              series={[
                { label: 'Assigned', values: r.allocation.map((x) => x.assigned) },
                { label: 'Reserved', values: r.allocation.map((x) => x.reserved) },
                { label: 'Available', values: r.allocation.map((x) => x.available) },
              ]}
              valueName="Resources"
              showPercent
              footnote="Allocation state only — an account can be Active and still unassigned. Operational status is reported separately."
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="readiness">
          <SectionCard
            title="Reserve readiness"
            description={`${r.reserveReadiness.filter((x) => x.result.ready).length} of ${r.reserveReadiness.length} reserve accounts meet every criterion.`}
            actions={<ExportButton rows={r.reserveReadiness} recordType="Report" filename="reserve-readiness-report"
              columns={[
                { key: 'id', header: 'Account ID', value: (x) => x.account.id },
                { key: 'platform', header: 'Platform', value: (x) => lookups.platformName(x.account.platformId) },
                { key: 'username', header: 'Username', value: (x) => x.account.username },
                { key: 'brand', header: 'Brand', value: (x) => lookups.brandName(x.account.brandId) },
                { key: 'ready', header: 'Ready to assign', value: (x) => (x.result.ready ? 'Yes' : 'No') },
                { key: 'gaps', header: 'Unmet criteria', value: (x) => x.result.failed.map((f) => f.label).join('; ') },
              ]} />}
          >
            <ReportTable
              rows={r.reserveReadiness}
              empty="No reserve accounts"
              columns={[
                { header: 'Account', cell: (x) => <Link to={`/accounts/${x.account.id}`} className="font-medium text-primary hover:underline">{x.account.id}</Link> },
                { header: 'Handle', cell: (x) => `@${x.account.username}` },
                { header: 'Platform', cell: (x) => lookups.platformName(x.account.platformId) },
                { header: 'Brand', cell: (x) => lookups.brandName(x.account.brandId) },
                { header: 'Ready', cell: (x) => <Badge tone={x.result.ready ? 'success' : 'warning'}>{x.result.ready ? 'ready' : `${x.result.failed.length} gaps`}</Badge> },
                { header: 'Unmet criteria', cell: (x) => <span className="text-[12px] text-muted-foreground">{x.result.failed.map((f) => f.label).join('; ') || '—'}</span> },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="renewals">
          <SectionCard
            title="Upcoming SIM renewals"
            description={`Plan expiry within ${DEFAULT_THRESHOLDS.simRenewalWindowDays} days, or already past.`}
            actions={<ExportButton rows={r.renewals} recordType="Report" filename="sim-renewals-report"
              columns={[
                { key: 'id', header: 'SIM ID', value: (x) => x.id },
                { key: 'phoneNumber', header: 'Phone number', value: (x) => x.phoneNumber },
                { key: 'provider', header: 'Provider', value: (x) => x.provider },
                { key: 'brand', header: 'Brand', value: (x) => lookups.brandName(x.brandId) },
                { key: 'planExpiryDate', header: 'Expiry date', value: (x) => x.planExpiryDate },
                { key: 'operationalStatus', header: 'Operational status', value: (x) => x.operationalStatus },
              ]} />}
          >
            <ReportTable
              rows={r.renewals}
              empty="No renewals due"
              columns={[
                { header: 'SIM', cell: (x) => <Link to={`/sims/${x.id}`} className="font-medium text-primary hover:underline">{x.id}</Link> },
                { header: 'Provider', cell: (x) => x.provider },
                { header: 'Brand', cell: (x) => lookups.brandName(x.brandId) },
                { header: 'Expiry', cell: (x) => <span className="tabular">{formatDate(x.planExpiryDate)}</span> },
                { header: 'Due', cell: (x) => { const d = daysUntil(x.planExpiryDate); return <Badge tone={d !== null && d < 0 ? 'danger' : 'warning'}>{relativeDays(d)}</Badge>; } },
                { header: 'Status', cell: (x) => <StatusBadge kind="simOperational" value={x.operationalStatus} /> },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="followups">
          <SectionCard
            title="Agent follow-ups"
            actions={<ExportButton rows={r.followUps} recordType="Report" filename="agent-followups-report"
              columns={[
                { key: 'id', header: 'Agent UID', value: (x) => x.id },
                { key: 'name', header: 'Name', value: (x) => x.name },
                { key: 'cooperationStatus', header: 'Cooperation status', value: (x) => x.cooperationStatus },
                { key: 'manager', header: 'Manager', value: (x) => lookups.personName(x.managerId) },
                { key: 'lastContactedDate', header: 'Last contacted', value: (x) => x.lastContactedDate },
                { key: 'nextFollowUpDate', header: 'Next follow-up', value: (x) => x.nextFollowUpDate },
              ]} />}
          >
            <ReportTable
              rows={r.followUps}
              empty="No follow-ups due"
              columns={[
                { header: 'Agent', cell: (x) => <Link to={`/agents/${x.id}`} className="font-medium text-primary hover:underline">{x.name}</Link> },
                { header: 'Status', cell: (x) => <StatusBadge kind="cooperation" value={x.cooperationStatus} /> },
                { header: 'Manager', cell: (x) => lookups.personName(x.managerId) },
                { header: 'Last contacted', cell: (x) => <span className="tabular">{formatDate(x.lastContactedDate)}</span> },
                { header: 'Next follow-up', cell: (x) => <span className="tabular">{formatDate(x.nextFollowUpDate)}</span> },
                { header: 'Due', cell: (x) => { const d = daysUntil(x.nextFollowUpDate); return <Badge tone={d !== null && d < 0 ? 'danger' : 'warning'}>{relativeDays(d)}</Badge>; } },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="verification">
          <SectionCard
            title="Accounts awaiting access verification"
            description={`Never verified, or last verified more than ${DEFAULT_THRESHOLDS.accessVerificationWindowDays} days ago.`}
            actions={<ExportButton rows={r.awaitingVerification} recordType="Report" filename="awaiting-verification-report"
              columns={[
                { key: 'id', header: 'Account ID', value: (x) => x.id },
                { key: 'platform', header: 'Platform', value: (x) => lookups.platformName(x.platformId) },
                { key: 'username', header: 'Username', value: (x) => x.username },
                { key: 'owner', header: 'Responsible employee', value: (x) => lookups.personName(x.responsibleTeamMemberId) },
                { key: 'lastAccessVerifiedDate', header: 'Last access verified', value: (x) => x.lastAccessVerifiedDate },
              ]} />}
          >
            <ReportTable
              rows={r.awaitingVerification}
              empty="Everything verified inside the window"
              columns={[
                { header: 'Account', cell: (x) => <Link to={`/accounts/${x.id}`} className="font-medium text-primary hover:underline">{x.id}</Link> },
                { header: 'Handle', cell: (x) => `@${x.username}` },
                { header: 'Platform', cell: (x) => lookups.platformName(x.platformId) },
                { header: 'Responsible', cell: (x) => lookups.personName(x.responsibleTeamMemberId) },
                { header: 'Last verified', cell: (x) => { const s = daysSince(x.lastAccessVerifiedDate); return <span className="tabular">{s === null ? 'never' : `${s} days ago`}</span>; } },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="missing">
          <SectionCard
            title="Missing ownership or recovery information"
            actions={<ExportButton rows={r.missingInfo} recordType="Report" filename="missing-information-report"
              columns={[
                { key: 'id', header: 'Account ID', value: (x) => x.id },
                { key: 'username', header: 'Username', value: (x) => x.username },
                { key: 'platform', header: 'Platform', value: (x) => lookups.platformName(x.platformId) },
                { key: 'ownerPresent', header: 'Owner documented', value: (x) => (x.responsibleTeamMemberId ? 'Yes' : 'No') },
                { key: 'credentialPresent', header: 'Credential reference present', value: (x) => (x.credentialId ? 'Yes' : 'No') },
                { key: 'recoveryPresent', header: 'Recovery method set', value: (x) => (x.recoveryMethod === 'None' ? 'No' : 'Yes') },
              ]} />}
          >
            <ReportTable
              rows={r.missingInfo}
              empty="No gaps found"
              columns={[
                { header: 'Account', cell: (x) => <Link to={`/accounts/${x.id}`} className="font-medium text-primary hover:underline">{x.id}</Link> },
                { header: 'Handle', cell: (x) => `@${x.username}` },
                { header: 'Owner', cell: (x) => x.responsibleTeamMemberId ? lookups.personName(x.responsibleTeamMemberId) : <Badge tone="danger">missing</Badge> },
                { header: 'Credential ref', cell: (x) => x.credentialId ?? <Badge tone="warning">missing</Badge> },
                { header: 'Recovery', cell: (x) => x.recoveryMethod === 'None' ? <Badge tone="danger">none</Badge> : x.recoveryMethod },
                { header: 'Followers', cell: (x) => <span className="flex flex-col"><span className="tabular">{x.followerCount?.toLocaleString() ?? '—'}</span><Measured date={x.followerCountMeasuredAt} /></span> },
              ]}
            />
          </SectionCard>
        </TabsContent>

        <TabsContent value="handovers">
          <SectionCard
            title="Assignment and handover history"
            actions={<ExportButton rows={r.assignments} recordType="Report" filename="handover-history-report"
              columns={[
                { key: 'id', header: 'Assignment ID', value: (x) => x.id },
                { key: 'resourceType', header: 'Resource type', value: (x) => x.resourceType },
                { key: 'resourceId', header: 'Resource', value: (x) => x.resourceId },
                { key: 'previous', header: 'Previous assignee', value: (x) => lookups.personName(x.previousAssigneeId) },
                { key: 'newAssignee', header: 'New assignee', value: (x) => lookups.personName(x.newAssigneeId) },
                { key: 'role', header: 'Role', value: (x) => x.role },
                { key: 'startDate', header: 'Start date', value: (x) => x.startDate },
                { key: 'returnedDate', header: 'Return date', value: (x) => x.returnedDate },
                { key: 'handoverStatus', header: 'Handover status', value: (x) => x.handoverStatus },
                { key: 'credentialAction', header: 'Credential action', value: (x) => x.credentialAction },
              ]} />}
          >
            <ReportTable
              rows={r.assignments.slice(0, 100)}
              empty="No assignments recorded"
              columns={[
                { header: 'Assignment', cell: (x) => x.id },
                { header: 'Resource', cell: (x) => x.resourceId },
                { header: 'From → to', cell: (x) => `${lookups.personName(x.previousAssigneeId)} → ${lookups.personName(x.newAssigneeId)}` },
                { header: 'Role', cell: (x) => x.role },
                { header: 'Start', cell: (x) => <span className="tabular">{formatDate(x.startDate)}</span> },
                { header: 'Handover', cell: (x) => <StatusBadge kind="handover" value={x.handoverStatus} /> },
                { header: 'Credential action', cell: (x) => x.credentialAction },
              ]}
            />
            {r.assignments.length > 100 && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Showing the first 100 of {r.assignments.length}. Export includes every row.
              </p>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="quality" className="flex flex-col gap-4">
          {(() => {
            const summary = summariseIssues(r.issues);
            return (
              <>
                <KpiGrid className="lg:grid-cols-4">
                  <KpiCard label="Issues found" value={summary.total} tone={summary.total ? 'warning' : 'success'} />
                  <KpiCard label="Errors" value={summary.errors} tone={summary.errors ? 'danger' : 'success'}
                    hint="Broken references and contradictory state" />
                  <KpiCard label="Warnings" value={summary.warnings} tone={summary.warnings ? 'warning' : 'success'}
                    hint="Missing information and orphaned records" />
                  <KpiCard label="Records checked"
                    value={r.accounts.length + r.allocation.reduce((n, a) => n + a.total, 0)} />
                </KpiGrid>

                <SectionCard
                  title="Data quality"
                  description="Broken references, contradictory state, missing information and duplicates, checked across every register."
                  actions={<ExportButton rows={r.issues} recordType="Report" filename="data-quality-report"
                    columns={[
                      { key: 'severity', header: 'Severity', value: (x) => x.severity },
                      { key: 'category', header: 'Category', value: (x) => x.category },
                      { key: 'recordType', header: 'Record type', value: (x) => x.recordType },
                      { key: 'recordId', header: 'Record ID', value: (x) => x.recordId },
                      { key: 'recordLabel', header: 'Record', value: (x) => x.recordLabel },
                      { key: 'field', header: 'Field', value: (x) => x.field },
                      { key: 'message', header: 'Issue', value: (x) => x.message },
                    ]} />}
                >
                  <ReportTable
                    rows={r.issues}
                    empty="Nothing to fix — every reference resolves and no required field is blank"
                    columns={[
                      { header: 'Severity', cell: (x) => <Badge tone={x.severity === 'error' ? 'danger' : 'warning'}>{x.severity}</Badge> },
                      { header: 'Category', cell: (x) => <Badge tone="outline">{x.category}</Badge> },
                      { header: 'Record', cell: (x) => <Link to={x.to} className="font-medium text-primary hover:underline">{x.recordLabel}</Link> },
                      { header: 'Type', cell: (x) => x.recordType },
                      { header: 'Field', cell: (x) => <span className="text-[12px] text-muted-foreground">{x.field}</span> },
                      { header: 'Issue', cell: (x) => x.message },
                    ]}
                  />
                </SectionCard>
              </>
            );
          })()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
