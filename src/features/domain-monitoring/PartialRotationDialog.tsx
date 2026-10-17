/** Move specific domains between a group's batches — a sick domain swapped
 *  out mid-cycle — without touching the group's own schedule. See
 *  server/routes/domain-monitoring/rotation.ts's rotate-partial. */

import * as React from 'react';
import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useCrmData } from '@/hooks/useData';
import { displayUrl } from '@/lib/utils';
import type { RotationGroupRecord } from '@/lib/types';
import { useRotatePartial } from './api';

export function PartialRotationDialog({
  open, onOpenChange, group,
}: { open: boolean; onOpenChange: (v: boolean) => void; group?: RotationGroupRecord }) {
  const { data } = useCrmData();
  const rotatePartial = useRotatePartial();
  const [moves, setMoves] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState('');

  React.useEffect(() => { if (open) { setMoves({}); setReason(''); } }, [open]);

  if (!group) return null;

  const batches = (data?.rotationBatches ?? []).filter((b) => b.rotationGroupId === group.id && !b.archived);
  const members = data?.rotationBatchMembers ?? [];
  const monitors = data?.domainMonitors ?? [];
  const batchOf = new Map(members.map((m) => [m.domainMonitorId, m.rotationBatchId]));
  const groupDomains = [...batchOf.keys()]
    .map((id) => monitors.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => Boolean(d && !d.archived))
    .sort((a, b) => a.domainName.localeCompare(b.domainName));

  const setMove = (domainId: string, toBatchId: string) => setMoves((prev) => {
    const next = { ...prev };
    if (toBatchId === batchOf.get(domainId)) delete next[domainId];
    else next[domainId] = toBatchId;
    return next;
  });

  const close = () => onOpenChange(false);
  const pendingCount = Object.keys(moves).length;
  const valid = pendingCount > 0 && reason.trim().length >= 10;

  const submit = async () => {
    await rotatePartial.mutateAsync({
      groupId: group.id,
      moves: Object.entries(moves).map(([domainMonitorId, toBatchId]) => ({ domainMonitorId, toBatchId })),
      reason: reason.trim(),
    });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Partial rotation — {group.name}</DialogTitle>
          <DialogDescription>
            Move specific domains to a different batch. The schedule and every other domain stay as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {groupDomains.length === 0 && <p className="p-3 text-[13px] text-muted-foreground">No domains are assigned to a batch in this group yet.</p>}
          {groupDomains.map((d) => {
            const currentBatchId = batchOf.get(d.id)!;
            const currentBatch = batches.find((b) => b.id === currentBatchId);
            return (
              <div key={d.id} className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[13px] last:border-0">
                <span>{displayUrl(d.domainName)} <span className="text-muted-foreground">({currentBatch?.name ?? '—'})</span></span>
                <NativeSelect
                  aria-label={`Move ${d.domainName} to`}
                  value={moves[d.id] ?? currentBatchId}
                  onChange={(e) => setMove(d.id, e.target.value)}
                  className="w-auto"
                >
                  {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </NativeSelect>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="partial-reason">Reason <span className="text-danger" aria-hidden="true">*</span></Label>
          <Textarea id="partial-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are these domains moving? This is written to the audit trail." />
          <p className="text-[12px] text-muted-foreground">At least 10 characters. {pendingCount} move{pendingCount === 1 ? '' : 's'} pending.</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="button" disabled={!valid || rotatePartial.isPending} onClick={submit}>
            <ArrowRightLeft /> {rotatePartial.isPending ? 'Moving…' : `Move ${pendingCount || ''} domain${pendingCount === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
