import { Link } from 'react-router-dom';
import { PageHeader, SectionCard, ErrorState, StatusBadge, EmptyState } from '@/components/common/bits';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Badge, Card, Skeleton } from '@/components/ui/primitives';
import { useCrmData } from '@/hooks/useData';
import {
  ACCOUNT_ALLOCATION_STATUS, ACCOUNT_OPERATIONAL_STATUS, ALLOCATION_STATUS,
  COOPERATION_STATUS, HANDOVER_STATUS, SIM_OPERATIONAL_STATUS,
} from '@/lib/types';
import { formatDate } from '@/lib/utils';

const STATUS_DEFINITIONS: { group: string; note: string; values: readonly string[]; kind: Parameters<typeof StatusBadge>[0]['kind'] }[] = [
  { group: 'SIM operational status', note: 'Whether the SIM itself works.', values: SIM_OPERATIONAL_STATUS, kind: 'simOperational' },
  { group: 'SIM allocation status', note: 'Whether the SIM is spoken for.', values: ALLOCATION_STATUS, kind: 'allocation' },
  { group: 'Account operational status', note: 'Whether the account works and is in good standing.', values: ACCOUNT_OPERATIONAL_STATUS, kind: 'accountOperational' },
  { group: 'Account allocation status', note: 'Whether the account is held, reserved or in use.', values: ACCOUNT_ALLOCATION_STATUS, kind: 'accountAllocation' },
  { group: 'Agent cooperation status', note: 'Where an agent sits in the working relationship.', values: COOPERATION_STATUS, kind: 'cooperation' },
  { group: 'Handover status', note: 'Progress of an allocation handover.', values: HANDOVER_STATUS, kind: 'handover' },
];

export default function BrandsPage() {
  const { data, lookups, isLoading, error, refetch } = useCrmData();

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;
  if (isLoading) return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-64" /><Skeleton className="h-64 w-full" /></div>;

  const brands = data?.brands ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Brands, projects and team"
        description="The configurable records the rest of the workspace refers to. Each brand page summarises its agents, SIMs, accounts, reserves and assignments."
      />

      <Tabs defaultValue="brands">
        <TabsList>
          <TabsTrigger value="brands">Brands ({brands.length})</TabsTrigger>
          <TabsTrigger value="projects">Projects ({data?.projects.length ?? 0})</TabsTrigger>
          <TabsTrigger value="platforms">Platforms ({data?.platforms.length ?? 0})</TabsTrigger>
          <TabsTrigger value="countries">Countries ({data?.countries.length ?? 0})</TabsTrigger>
          <TabsTrigger value="team">Team ({data?.teamMembers.length ?? 0})</TabsTrigger>
          <TabsTrigger value="statuses">Status definitions</TabsTrigger>
        </TabsList>

        <TabsContent value="brands">
          {brands.length === 0 ? <EmptyState title="No brands configured" /> : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {brands.map((b) => {
                const accounts = (data?.socialAccounts ?? []).filter((a) => !a.archived && a.brandId === b.id);
                const sims = (data?.sims ?? []).filter((s) => !s.archived && s.brandId === b.id);
                const agents = (data?.agents ?? []).filter((a) => !a.archived && a.brandIds.includes(b.id));
                return (
                  <Link key={b.id} to={`/brands/${b.id}`} className="group">
                    <Card className="flex h-full flex-col p-4 transition-colors hover:border-primary/50 hover:bg-surface-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold">{b.name}</p>
                          <p className="text-[12px] text-muted-foreground">{b.code} · {b.id}</p>
                        </div>
                        <Badge tone={b.active ? 'success' : 'neutral'}>{b.active ? 'active' : 'inactive'}</Badge>
                      </div>
                      <p className="mt-2 text-[13px] text-muted-foreground">{b.description}</p>
                      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                        {[['Accounts', accounts.length], ['SIMs', sims.length], ['Agents', agents.length]].map(([label, n]) => (
                          <div key={label as string}>
                            <dt className="text-[11px] text-muted-foreground">{label}</dt>
                            <dd className="text-base font-semibold tabular">{n as number}</dd>
                          </div>
                        ))}
                      </dl>
                    </Card>
                  </Link>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="projects">
          <SectionCard title="Marketing projects">
            <ul className="flex flex-col divide-y divide-border">
              {(data?.projects ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="text-[13px] font-medium">{p.name}</p>
                    <p className="text-[12px] text-muted-foreground">{p.id} · {lookups.brandName(p.brandId)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] text-muted-foreground tabular">
                      {formatDate(p.startDate)} → {p.endDate ? formatDate(p.endDate) : 'ongoing'}
                    </span>
                    <Badge tone={p.status === 'Running' ? 'success' : p.status === 'Paused' ? 'warning' : 'neutral'}>{p.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        </TabsContent>

        <TabsContent value="platforms">
          <SectionCard title="Platforms" description="Additional platforms are configurable — Threads below is a non-built-in example.">
            <ul className="flex flex-col divide-y divide-border">
              {(data?.platforms ?? []).map((p) => {
                const n = (data?.socialAccounts ?? []).filter((a) => !a.archived && a.platformId === p.id).length;
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="flex items-center gap-2 text-[13px] font-medium">
                        {p.name}
                        {!p.builtIn && <Badge tone="info">custom</Badge>}
                      </p>
                      <p className="text-[12px] text-muted-foreground">Supports: {p.supportsAssetTypes.join(', ')}</p>
                    </div>
                    <Link to={`/accounts?platform=${p.id}`} className="text-[13px] font-medium text-primary hover:underline tabular">
                      {n} account{n === 1 ? '' : 's'}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </TabsContent>

        <TabsContent value="countries">
          <SectionCard title="Countries">
            <ul className="flex flex-col divide-y divide-border">
              {(data?.countries ?? []).map((c) => {
                const sims = (data?.sims ?? []).filter((s) => !s.archived && s.countryCode === c.code).length;
                const accounts = (data?.socialAccounts ?? []).filter((a) => !a.archived && a.targetCountryCode === c.code).length;
                return (
                  <li key={c.code} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="text-[13px] font-medium">{c.name}</p>
                      <p className="text-[12px] text-muted-foreground">{c.code} · {c.dialCode}</p>
                    </div>
                    <p className="text-[12px] text-muted-foreground tabular">{sims} SIMs · {accounts} accounts</p>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </TabsContent>

        <TabsContent value="team">
          <SectionCard title="Team members and resource ownership">
            <ul className="flex flex-col divide-y divide-border">
              {(data?.teamMembers ?? []).map((m) => {
                const owned = (data?.socialAccounts ?? []).filter((a) => !a.archived && a.responsibleTeamMemberId === m.id).length;
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div>
                      <p className="flex items-center gap-2 text-[13px] font-medium">
                        {m.name}
                        {!m.active && <Badge tone="neutral">inactive</Badge>}
                      </p>
                      <p className="text-[12px] text-muted-foreground">{m.title} · {m.email}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge tone="accent">{m.role}</Badge>
                      <Link to={`/accounts?search=${encodeURIComponent(m.name)}`} className="text-[12px] font-medium text-primary hover:underline tabular">
                        owns {owned}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        </TabsContent>

        <TabsContent value="statuses" className="flex flex-col gap-4">
          {STATUS_DEFINITIONS.map((d) => (
            <SectionCard key={d.group} title={d.group} description={d.note}>
              <div className="flex flex-wrap gap-2">
                {d.values.map((v) => <StatusBadge key={v} kind={d.kind} value={v} />)}
              </div>
            </SectionCard>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
