import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { PageHeader, SectionCard, ErrorState, EmptyState, RecordLink, StatusBadge, DefinitionList } from '@/components/common/bits';
import { KpiCard, KpiGrid } from '@/components/common/KpiCard';
import { Button } from '@/components/ui/button';
import { Badge, Skeleton } from '@/components/ui/primitives';
import { AssignmentList } from '@/components/common/AssignmentList';
import { useCrmData } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { evaluateReserveReadiness, reserveAccounts } from '@/lib/rules';
import { formatDate, groupCount, maskPhone } from '@/lib/utils';

export default function BrandDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, lookups, isLoading, error, refetch } = useCrmData();
  const { showContactDetails: showContact } = useSession();

  const brand = data?.brands.find((b) => b.id === id);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;
  if (!brand) {
    return <EmptyState title="Brand not found" action={<Button variant="outline" asChild><Link to="/brands">Back to brands</Link></Button>} />;
  }

  const accounts = (data?.socialAccounts ?? []).filter((a) => !a.archived && a.brandId === brand.id);
  const sims = (data?.sims ?? []).filter((s) => !s.archived && s.brandId === brand.id);
  const agents = (data?.agents ?? []).filter((a) => !a.archived && a.brandIds.includes(brand.id));
  const projects = (data?.projects ?? []).filter((p) => p.brandId === brand.id);
  const reserves = reserveAccounts(accounts);
  const ready = reserves.filter((a) => evaluateReserveReadiness(a, data!.assignments).ready);
  const assignments = (data?.assignments ?? []).filter((a) => a.brandId === brand.id);
  const byPlatform = groupCount(accounts, (a) => lookups.platformName(a.platformId));

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => navigate('/brands')}>
        <ArrowLeft /> Brands
      </Button>

      <PageHeader title={brand.name} description={`${brand.code} · ${brand.description}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={brand.active ? 'success' : 'neutral'}>{brand.active ? 'active' : 'inactive'}</Badge>
          {brand.countryCodes.map((c) => <Badge key={c} tone="outline">{lookups.countryName(c)}</Badge>)}
        </div>
      </PageHeader>

      <KpiGrid className="lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard label="Social accounts" value={accounts.length} to={`/accounts?brand=${brand.id}`} />
        <KpiCard label="SIMs" value={sims.length} to={`/sims?search=${encodeURIComponent(brand.name)}`} />
        <KpiCard label="Agents" value={agents.length} to={`/agents?brand=${brand.id}`} />
        <KpiCard label="Reserve accounts" value={reserves.length} tone="info" to={`/reserves?brand=${encodeURIComponent(brand.name)}`} />
        <KpiCard label="Ready to assign" value={ready.length} tone="success" />
        <KpiCard label="Assignments" value={assignments.length} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Accounts by platform">
          {Object.keys(byPlatform).length === 0 ? <EmptyState title="No accounts for this brand" /> : (
            <ul className="flex flex-col gap-1">
              {Object.entries(byPlatform).sort((a, b) => b[1] - a[1]).map(([name, n]) => (
                <li key={name} className="flex items-center justify-between rounded-md px-2 py-1.5 text-[13px]">
                  <span>{name}</span>
                  <span className="tabular font-medium">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Projects">
          {projects.length === 0 ? <EmptyState title="No projects" /> : (
            <ul className="flex flex-col divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <p className="text-[13px] font-medium">{p.name}</p>
                    <p className="text-[12px] text-muted-foreground tabular">{formatDate(p.startDate)} → {p.endDate ? formatDate(p.endDate) : 'ongoing'}</p>
                  </div>
                  <Badge tone={p.status === 'Running' ? 'success' : p.status === 'Paused' ? 'warning' : 'neutral'}>{p.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Agents">
          {agents.length === 0 ? <EmptyState title="No agents linked" /> : (
            <ul className="flex flex-col divide-y divide-border">
              {agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <RecordLink to={`/agents/${a.id}`}>{a.name}</RecordLink>
                    <p className="text-[12px] text-muted-foreground">{a.id} · {a.agentType}</p>
                  </div>
                  <StatusBadge kind="cooperation" value={a.cooperationStatus} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="SIMs">
          {sims.length === 0 ? <EmptyState title="No SIMs linked" /> : (
            <ul className="flex flex-col divide-y divide-border">
              {sims.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <RecordLink to={`/sims/${s.id}`}>{showContact ? s.phoneNumber : maskPhone(s.phoneNumber)}</RecordLink>
                    <p className="text-[12px] text-muted-foreground">{s.id} · {s.provider}</p>
                  </div>
                  <StatusBadge kind="allocation" value={s.allocationStatus} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <SectionCard title="Brand record">
        <DefinitionList
          columns={3}
          items={[
            { label: 'Brand ID', value: brand.id },
            { label: 'Code', value: brand.code },
            { label: 'Countries', value: brand.countryCodes.map(lookups.countryName).join(', ') },
            { label: 'Description', value: brand.description },
            { label: 'Status', value: brand.active ? 'Active' : 'Inactive' },
          ]}
        />
      </SectionCard>

      <SectionCard title="Assignments for this brand">
        <AssignmentList assignments={assignments.slice(0, 20)} personName={lookups.personName} />
      </SectionCard>
    </div>
  );
}
