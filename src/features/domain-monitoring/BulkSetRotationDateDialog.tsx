import * as React from 'react';
import { CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useBulkSetNextRotationDate } from './api';

export function BulkSetRotationDateDialog({
  open, onOpenChange, ids,
}: { open: boolean; onOpenChange: (v: boolean) => void; ids: string[] }) {
  const bulkSet = useBulkSetNextRotationDate();
  const [date, setDate] = React.useState('');

  React.useEffect(() => { if (open) setDate(''); }, [open]);

  const submit = async () => {
    await bulkSet.mutateAsync({ ids, nextRotationDate: date || null });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Set rotation date for {ids.length} domain{ids.length === 1 ? '' : 's'}</DialogTitle>
          <DialogDescription>Applies the same Next Rotation Date to every selected domain. Leave it blank to clear the date instead.</DialogDescription>
        </DialogHeader>

        <Field label="Next rotation date" htmlFor="bulk-rotation-date">
          <Input id="bulk-rotation-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={bulkSet.isPending} onClick={submit}>
            <CalendarClock /> {bulkSet.isPending ? 'Saving…' : date ? 'Set date' : 'Clear date'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
