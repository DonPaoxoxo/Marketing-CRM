import * as React from 'react';
import { ChevronLeft, ChevronRight, ListChecks, Trash2, X } from 'lucide-react';
import { PageHeader, SectionCard, EmptyState, ErrorState } from '@/components/common/bits';
import { ConfirmWithReason } from '@/components/common/controls';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Label, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { useCrmData } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import {
  PERIOD_LABEL, REPORT_PERIODS, mayDeleteReport, mayFileReports, mayReview, periodEndOf, periodLabel, periodStartOf,
  type ReportPeriod,
} from '@/lib/team-reports';
import { ReportCard, ReportForm, ReportStatusBadge } from '@/features/team-reports/ReportCard';
import { useBulkDeleteReports, useTeamReports } from '@/features/team-reports/api';

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function shift(period: ReportPeriod, start: string, by: number): string {
  const d = new Date(`${start}T00:00:00Z`);
  if (period === 'daily') d.setUTCDate(d.getUTCDate() + by);
  if (period === 'weekly') d.setUTCDate(d.getUTCDate() + 7 * by);
  if (period === 'monthly') d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 10);
}

function PeriodTab({ period }: { period: ReportPeriod }) {
  const { actorId, role, permissions } = useSession();
  const person = { id: actorId, role, permissions };
  const { data } = useCrmData();
  const reports = useTeamReports(period);
  const today = localToday();
  const [date, setDate] = React.useState(today);
  const [personFilter, setPersonFilter] = React.useState('all');
  const start = periodStartOf(period, date) ?? periodStartOf(period, today)!;
  const current = periodStartOf(period, today)!;

  const all = reports.data ?? [];
  const inPeriod = all.filter((r) => r.periodStart === start);
  const mine = inPeriod.find((r) => r.authorId === actorId);
  const others = inPeriod.filter((r) => r.authorId !== actorId);
  const earlier = all
    .filter((r) => r.periodStart < start && (personFilter === 'all' || r.authorId === personFilter))
    .slice(0, 50);

  /* ── Bulk select + delete, Earlier reports only ──────────────── */
  const bulkDelete = useBulkDeleteReports();
  const [selectMode, setSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = React.useState(false);

  // A filter or date change can drop rows out of view; stale picks from before
  // that change should not be acted on.
  React.useEffect(() => setSelectedIds(new Set()), [start, personFilter]);

  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };
  const toggleSelected = (id: string) => setSelectedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allEarlierSelected = earlier.length > 0 && earlier.every((r) => selectedIds.has(r.id));
  const toggleSelectAll = () => setSelectedIds(allEarlierSelected ? new Set() : new Set(earlier.map((r) => r.id)));

  // Everyone expected to report: active people who can edit records.
  const expected = (data?.teamMembers ?? []).filter((m) => m.active && ROLE_PERMISSIONS[m.role]?.includes('edit:resources'));

  if (reports.error) return <ErrorState message={reports.error.message} onRetry={() => reports.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Button size="icon-sm" variant="outline" aria-label={`Previous ${period.replace('ly', '')}`} onClick={() => setDate(shift(period, start, -1))}><ChevronLeft /></Button>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`period-${period}`}>{period === 'daily' ? 'Day' : period === 'weekly' ? 'Any day in the week' : 'Any day in the month'}</Label>
          <Input id={`period-${period}`} type="date" value={date} max={today} className="w-44" onChange={(e) => e.target.value && setDate(e.target.value)} />
        </div>
        <Button size="icon-sm" variant="outline" aria-label={`Next ${period.replace('ly', '')}`} disabled={start >= current} onClick={() => setDate(shift(period, start, 1))}><ChevronRight /></Button>
        <p className="pb-1.5 text-[14px] font-medium">
          {periodLabel(period, start)}
          {period !== 'daily' && <span className="ml-2 text-[12px] font-normal text-muted-foreground">{start} to {periodEndOf(period, start)}</span>}
        </p>
      </div>

      {reports.isLoading ? <Skeleton className="h-40 w-full" /> : (
        <>
          {mayReview(person) && (
            <SectionCard title="Who has reported" description={`${inPeriod.length} of ${expected.length} for ${periodLabel(period, start)}.`}>
              <ul className="flex flex-wrap gap-2">
                {expected.map((m) => {
                  const report = inPeriod.find((r) => r.authorId === m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[12px]">
                      <span className="font-medium">{m.name}</span>
                      {report ? <ReportStatusBadge status={report.status} /> : <span className="text-danger">Missing</span>}
                    </li>
                  );
                })}
              </ul>
            </SectionCard>
          )}

          {mayFileReports(person) && (
            <SectionCard title={`My ${period} report — ${periodLabel(period, start)}`}>
              {mine ? <ReportCard report={mine} defaultOpen /> : <ReportForm key={`${period}-${start}`} period={period} date={start} />}
            </SectionCard>
          )}

          {mayReview(person) && (
            <SectionCard title={`Team reports — ${periodLabel(period, start)}`}>
              {others.length ? (
                <div className="flex flex-col gap-2">{others.map((r) => <ReportCard key={r.id} report={r} />)}</div>
              ) : <EmptyState title="No other reports for this period yet" />}
            </SectionCard>
          )}

          <SectionCard
            title="Earlier reports"
            description={mayReview(person) ? 'Everyone’s reports before this period, newest first.' : 'Your reports before this period, newest first.'}
            actions={mayDeleteReport(person) && earlier.length > 0 ? (
              selectMode ? (
                <>
                  <Button size="sm" variant="danger" disabled={selectedIds.size === 0} onClick={() => setBulkDeleteOpen(true)}>
                    <Trash2 /> Delete selected ({selectedIds.size})
                  </Button>
                  <Button size="sm" variant="ghost" onClick={exitSelectMode}><X /> Cancel</Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setSelectMode(true)}><ListChecks /> Select</Button>
              )
            ) : undefined}
          >
            {mayReview(person) && (
              <div className="mb-3 flex items-center gap-2 text-[13px]">
                <Label htmlFor={`person-${period}`}>Person</Label>
                <NativeSelect id={`person-${period}`} className="w-48" value={personFilter} onChange={(e) => setPersonFilter(e.target.value)}>
                  <option value="all">Everyone</option>
                  {expected.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </NativeSelect>
              </div>
            )}
            {selectMode && earlier.length > 0 && (
              <label className="mb-2 flex items-center gap-2 text-[13px]">
                <Checkbox checked={allEarlierSelected} onCheckedChange={toggleSelectAll} aria-label="Select all earlier reports shown" />
                Select all ({earlier.length})
              </label>
            )}
            {earlier.length ? (
              <div className="flex flex-col gap-2">
                {earlier.map((r) => (
                  <ReportCard key={r.id} report={r} selectable={selectMode} selected={selectedIds.has(r.id)} onToggleSelect={toggleSelected} />
                ))}
              </div>
            ) : <EmptyState title="No earlier reports" />}
          </SectionCard>
        </>
      )}

      <ConfirmWithReason
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selectedIds.size} report${selectedIds.size === 1 ? '' : 's'} permanently?`}
        description="Each selected report, its files and all replies are erased from the database and cannot be recovered. The audit history keeps one line per report: who deleted it, when, and this reason."
        confirmLabel={`Delete ${selectedIds.size} permanently`}
        placeholder="Why are these reports being deleted? This line is kept in the audit history for each one."
        hint="At least 10 characters. This cannot be undone."
        onConfirm={async (reason) => {
          await bulkDelete.mutateAsync({ ids: [...selectedIds], reason });
          exitSelectMode();
        }}
      />
    </div>
  );
}

export default function TeamReportsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Team Reports"
        description="Daily, weekly and monthly work reports with reference files, recommendations and replies from the system owner. You see your own reports; the System Administrator sees everyone’s."
      />
      <Tabs defaultValue="daily">
        <TabsList className="max-w-full overflow-x-auto">
          {REPORT_PERIODS.map((p) => <TabsTrigger key={p} value={p}>{PERIOD_LABEL[p]} reporting</TabsTrigger>)}
        </TabsList>
        {REPORT_PERIODS.map((p) => (
          <TabsContent key={p} value={p}><PeriodTab period={p} /></TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
