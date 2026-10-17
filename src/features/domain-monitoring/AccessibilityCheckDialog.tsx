import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useBulkRecordAccessibilityCheck, useRecordAccessibilityCheck } from './api';
import { DOMAIN_ACCESSIBILITY_STATUS, type DomainAccessibilityStatus } from '@/lib/types';

/** One domain, or many selected at once (see the Select mode on both tables).
 *  No reason is required here — a daily check is high-frequency and already
 *  attributed; see src/lib/access.ts's ConfirmWithReason usage elsewhere for
 *  the higher-stakes actions that do require one. */
export type CheckTarget = { kind: 'single'; id: string; name: string } | { kind: 'bulk'; ids: string[] };

export function AccessibilityCheckDialog({
  open, onOpenChange, target,
}: { open: boolean; onOpenChange: (v: boolean) => void; target: CheckTarget | undefined }) {
  const single = useRecordAccessibilityCheck();
  const bulk = useBulkRecordAccessibilityCheck();
  const [status, setStatus] = React.useState<DomainAccessibilityStatus>('Accessible');
  const [notes, setNotes] = React.useState('');
  const busy = single.isPending || bulk.isPending;

  React.useEffect(() => {
    if (open) { setStatus('Accessible'); setNotes(''); }
  }, [open]);

  if (!target) return null;
  const count = target.kind === 'single' ? 1 : target.ids.length;

  const onSubmit = async () => {
    if (target.kind === 'single') {
      await single.mutateAsync({ id: target.id, accessibilityStatus: status, notes });
    } else {
      await bulk.mutateAsync({ domainMonitorIds: target.ids, accessibilityStatus: status, notes });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{target.kind === 'single' ? `Check ${target.name}` : `Check ${count} domain${count === 1 ? '' : 's'}`}</DialogTitle>
          <DialogDescription>Recorded for today, by you. Checking again today replaces this entry rather than adding another.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="check-status">Accessibility</Label>
          <NativeSelect id="check-status" value={status} onChange={(e) => setStatus(e.target.value as DomainAccessibilityStatus)}>
            {DOMAIN_ACCESSIBILITY_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
          </NativeSelect>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="check-notes">Notes (optional)</Label>
          <Textarea id="check-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. loads slowly, SSL warning…" />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSubmit} disabled={busy}>{busy ? 'Saving…' : 'Record check'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
