/** Postpone the next rotation, mark the current cycle complete early, or
 *  change the interval going forward — written as an override, never a
 *  plain edit, so it reads differently from a rotation in the history. */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import type { RotationGroupRecord } from '@/lib/types';
import { useRotationOverride } from './api';

const ACTIONS = [
  { value: 'postpone', label: 'Postpone the next rotation' },
  { value: 'early_complete', label: 'Mark the current cycle complete now' },
  { value: 'change_interval', label: 'Change the rotation interval' },
] as const;

export function RotationOverrideDialog({
  open, onOpenChange, group,
}: { open: boolean; onOpenChange: (v: boolean) => void; group?: RotationGroupRecord }) {
  const override = useRotationOverride();
  const [action, setAction] = React.useState<(typeof ACTIONS)[number]['value']>('postpone');
  const [newDueAt, setNewDueAt] = React.useState('');
  const [newIntervalDays, setNewIntervalDays] = React.useState(group?.rotationIntervalDays ?? 5);
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (open) { setAction('postpone'); setNewDueAt(''); setNewIntervalDays(group?.rotationIntervalDays ?? 5); setReason(''); }
  }, [open, group]);

  if (!group) return null;

  const close = () => onOpenChange(false);
  const fieldsValid = action === 'postpone' ? Boolean(newDueAt) : action === 'change_interval' ? newIntervalDays >= 1 && newIntervalDays <= 90 : true;
  const valid = fieldsValid && reason.trim().length >= 10;

  const submit = async () => {
    await override.mutateAsync({
      groupId: group.id, action, reason: reason.trim(),
      ...(action === 'postpone' ? { newDueAt: new Date(newDueAt).toISOString() } : {}),
      ...(action === 'change_interval' ? { newIntervalDays } : {}),
    });
    close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Override schedule — {group.name}</DialogTitle>
          <DialogDescription>
            Current next rotation: {group.nextRotationDueAt ? new Date(group.nextRotationDueAt).toLocaleString() : 'not set — no rotation has run yet'}.
          </DialogDescription>
        </DialogHeader>

        <Field label="Action" htmlFor="override-action" required>
          <NativeSelect id="override-action" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
            {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </NativeSelect>
        </Field>

        {action === 'postpone' && (
          <Field label="New rotation date" htmlFor="override-due" required>
            <Input id="override-due" type="datetime-local" value={newDueAt} onChange={(e) => setNewDueAt(e.target.value)} />
          </Field>
        )}
        {action === 'change_interval' && (
          <Field label="Interval (days)" htmlFor="override-interval" required hint="1 to 90 days.">
            <Input id="override-interval" type="number" min={1} max={90} value={newIntervalDays} onChange={(e) => setNewIntervalDays(Number(e.target.value))} />
          </Field>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="override-reason">Reason <span className="text-danger" aria-hidden="true">*</span></Label>
          <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the schedule changing? This is written to the audit trail." />
          <p className="text-[12px] text-muted-foreground">At least 10 characters.</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="button" disabled={!valid || override.isPending} onClick={submit}>{override.isPending ? 'Applying…' : 'Apply override'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
