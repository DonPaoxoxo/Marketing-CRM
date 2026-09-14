import { Badge } from '@/components/ui/primitives';
import { EmptyState } from './bits';
import { formatDateTime } from '@/lib/utils';
import type { AuditEntry } from '@/lib/types';

const ACTION_TONE: Record<AuditEntry['action'], React.ComponentProps<typeof Badge>['tone']> = {
  create: 'success',
  update: 'neutral',
  'status-change': 'info',
  assign: 'accent',
  archive: 'danger',
  import: 'info',
  export: 'warning',
  'credential-request': 'warning',
  rotation: 'accent',
  delete: 'danger',
  approve: 'success',
  reject: 'danger',
  restore: 'info',
  upload: 'neutral',
  download: 'neutral',
  'ai-request': 'accent',
};

export function AuditTimeline({ entries, emptyTitle = 'No audit history yet' }: { entries: AuditEntry[]; emptyTitle?: string }) {
  if (!entries.length) {
    return <EmptyState title={emptyTitle} description="Changes made in this workspace appear here with actor, time and the fields that changed." />;
  }
  return (
    <ol className="flex flex-col gap-3">
      {entries.map((e) => (
        <li key={e.id} className="rounded-md border border-border bg-surface-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ACTION_TONE[e.action]}>{e.action.replace('-', ' ')}</Badge>
              <span className="text-[13px] font-medium">{e.recordLabel}</span>
              <span className="text-[12px] text-muted-foreground">{e.recordType}</span>
            </div>
            <span className="text-[12px] text-muted-foreground tabular">{formatDateTime(e.timestamp)}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {e.actorName} · {e.actorRole}
          </p>
          {e.reason && <p className="mt-1.5 text-[13px]">{e.reason}</p>}
          {e.changes.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {e.changes.map((c, i) => (
                <li key={`${e.id}-${c.field}-${i}`} className="text-[12px]">
                  <span className="font-medium">{c.field}</span>
                  <span className="text-muted-foreground">: {c.from ?? '—'} → </span>
                  <span>{c.to ?? '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
