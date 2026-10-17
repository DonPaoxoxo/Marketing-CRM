/** Full rotation, guided: pick which Standby batch comes in, review exactly
 *  which domains flip Active/Standby and when the next rotation falls due,
 *  then confirm with a written reason. The only place a batch's Active flag
 *  — and a group's schedule — actually changes; see server's rotation.ts. */

import * as React from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useCrmData } from '@/hooks/useData';
import { displayUrl } from '@/lib/utils';
import type { RotationGroupRecord } from '@/lib/types';
import { useRotateFull } from './api';

type Stage = { kind: 'pick' } | { kind: 'preview'; incomingBatchId: string };

export function RotateBatchWizard({
  open, onOpenChange, group,
}: { open: boolean; onOpenChange: (v: boolean) => void; group?: RotationGroupRecord }) {
  const { data } = useCrmData();
  const rotateFull = useRotateFull();
  const [stage, setStage] = React.useState<Stage>({ kind: 'pick' });
  const [incomingBatchId, setIncomingBatchId] = React.useState('');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => { if (open) { setStage({ kind: 'pick' }); setIncomingBatchId(''); setReason(''); } }, [open]);

  if (!group) return null;

  const batches = (data?.rotationBatches ?? []).filter((b) => b.rotationGroupId === group.id && !b.archived);
  const members = data?.rotationBatchMembers ?? [];
  const monitors = data?.domainMonitors ?? [];
  const domainsOf = (batchId: string) => members.filter((m) => m.rotationBatchId === batchId).map((m) => monitors.find((d) => d.id === m.domainMonitorId)).filter((d): d is NonNullable<typeof d> => Boolean(d));

  const outgoing = batches.find((b) => b.status === 'Active');
  const candidates = batches.filter((b) => b.status !== 'Active' && domainsOf(b.id).length > 0);

  const close = () => onOpenChange(false);
  const valid = reason.trim().length >= 10;

  const submit = async () => {
    await rotateFull.mutateAsync({ groupId: group.id, incomingBatchId, reason: reason.trim() });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {stage.kind === 'pick' && (
          <>
            <DialogHeader>
              <DialogTitle>Run a full rotation — {group.name}</DialogTitle>
              <DialogDescription>
                {outgoing ? `${outgoing.name} is currently Active. Choose which batch comes in.` : 'No batch is Active yet. Choose which batch starts as Active.'}
              </DialogDescription>
            </DialogHeader>

            {candidates.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No eligible batch — add a Standby batch with at least one domain first.</p>
            ) : (
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Incoming batch">
                {candidates.map((b) => (
                  <label key={b.id} className="flex items-center gap-2 rounded-md border border-border p-3 text-[13px] hover:bg-muted">
                    <input type="radio" name="incoming-batch" className="accent-[var(--primary)]" checked={incomingBatchId === b.id} onChange={() => setIncomingBatchId(b.id)} />
                    <span className="font-medium">{b.name}</span>
                    <span className="text-muted-foreground">({domainsOf(b.id).length} domains)</span>
                  </label>
                ))}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="button" disabled={!incomingBatchId} onClick={() => setStage({ kind: 'preview', incomingBatchId })}>Next</Button>
            </DialogFooter>
          </>
        )}

        {stage.kind === 'preview' && (() => {
          const incoming = batches.find((b) => b.id === stage.incomingBatchId)!;
          const incomingDomains = domainsOf(incoming.id);
          const outgoingDomains = outgoing ? domainsOf(outgoing.id) : [];
          const notAccessible = incomingDomains.filter((d) => d.lastAccessibilityStatus !== 'Accessible');
          const newDue = new Date(Date.now() + group.rotationIntervalDays * 86_400_000);

          return (
            <>
              <DialogHeader>
                <DialogTitle>Review the rotation</DialogTitle>
                <DialogDescription>Nothing changes until you confirm below.</DialogDescription>
              </DialogHeader>

              <div className="grid gap-3 sm:grid-cols-2">
                {outgoing && (
                  <div className="rounded-md border border-border p-3 text-[13px]">
                    <p className="font-medium">{outgoing.name} → Standby</p>
                    <ul className="mt-1 text-muted-foreground">{outgoingDomains.map((d) => <li key={d.id}>{displayUrl(d.domainName)}</li>)}</ul>
                  </div>
                )}
                <div className="rounded-md border border-border p-3 text-[13px]">
                  <p className="font-medium">{incoming.name} → Active</p>
                  <ul className="mt-1 text-muted-foreground">{incomingDomains.map((d) => <li key={d.id}>{displayUrl(d.domainName)}</li>)}</ul>
                </div>
              </div>

              <p className="text-[13px]">Next rotation due: <span className="font-medium">{newDue.toLocaleString()}</span></p>

              {notAccessible.length > 0 && (
                <p role="alert" className="rounded-md border border-warning/40 bg-warning-bg/50 px-3 py-2 text-[12px]">
                  {notAccessible.length} domain{notAccessible.length === 1 ? '' : 's'} in {incoming.name} did not read Accessible on the latest check — it still goes live.
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rotate-reason">Reason <span className="text-danger" aria-hidden="true">*</span></Label>
                <Textarea id="rotate-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this rotation running now? This is written to the audit trail." />
                <p className="text-[12px] text-muted-foreground">At least 10 characters.</p>
              </div>

              <DialogFooter className="sm:justify-between">
                <Button type="button" variant="ghost" onClick={() => setStage({ kind: 'pick' })}><ArrowLeft /> Back</Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={close}>Cancel</Button>
                  <Button type="button" disabled={!valid || rotateFull.isPending} onClick={submit}>
                    <RefreshCw /> {rotateFull.isPending ? 'Rotating…' : 'Run full rotation'}
                  </Button>
                </div>
              </DialogFooter>
            </>
          );
        })()}
      </DialogContent>
    </Dialog>
  );
}
