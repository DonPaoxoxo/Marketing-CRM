import { Badge } from '@/components/ui/primitives';
import { EmptyState, StatusBadge } from './bits';
import { formatDate } from '@/lib/utils';
import type { Assignment } from '@/lib/types';

export function AssignmentList({
  assignments, personName, emptyTitle = 'No assignments recorded',
}: { assignments: Assignment[]; personName: (id: string | null) => string; emptyTitle?: string }) {
  if (!assignments.length) {
    return <EmptyState title={emptyTitle} description="Allocations and handovers for this record will appear here." />;
  }
  return (
    <ol className="flex flex-col gap-3">
      {[...assignments]
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .map((a) => (
          <li key={a.id} className="rounded-md border border-border bg-surface-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium">{a.id}</span>
                <StatusBadge kind="handover" value={a.handoverStatus} />
                <Badge tone={a.role === 'Primary Custodian' ? 'accent' : 'neutral'}>{a.role}</Badge>
                {a.active ? <Badge tone="success">active</Badge> : <Badge tone="neutral">closed</Badge>}
              </div>
              <span className="text-[12px] text-muted-foreground tabular">
                {formatDate(a.startDate)}{a.returnedDate ? ` → ${formatDate(a.returnedDate)}` : ''}
              </span>
            </div>
            <p className="mt-1.5 text-[13px]">
              {a.previousAssigneeId ? `${personName(a.previousAssigneeId)} → ` : ''}
              <span className="font-medium">{personName(a.newAssigneeId)}</span>
              <span className="text-muted-foreground"> ({a.newAssigneeType})</span>
            </p>
            {a.purpose && <p className="mt-1 text-[12px] text-muted-foreground">Purpose: {a.purpose}</p>}
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
              {a.expectedReturnDate && <span>Expected return {formatDate(a.expectedReturnDate)}</span>}
              <span>
                Credential action:{' '}
                <span className={a.credentialAction === 'None' ? '' : 'font-medium text-foreground'}>{a.credentialAction}</span>
              </span>
              <span>
                Acknowledgment: {a.acknowledgedBy ? `${a.acknowledgedBy} (${formatDate(a.acknowledgedAt)})` : 'not acknowledged'}
              </span>
            </div>
          </li>
        ))}
    </ol>
  );
}
