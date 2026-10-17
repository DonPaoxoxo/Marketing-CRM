import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError } from '@/hooks/useData';
import { useCreateRotationGroup, useUpdateRotationGroup } from './api';
import type { RotationGroupRecord } from '@/lib/types';

const schema = z.object({
  name: z.string().min(1, 'A group name is required.'),
  notes: z.string(),
  rotationIntervalDays: z.coerce.number().int().min(1, 'At least 1 day.').max(90, 'At most 90 days.'),
});

type Values = z.infer<typeof schema>;

export function RotationGroupFormDialog({
  open, onOpenChange, group,
}: { open: boolean; onOpenChange: (v: boolean) => void; group?: RotationGroupRecord }) {
  const create = useCreateRotationGroup();
  const update = useUpdateRotationGroup();
  const editing = Boolean(group);

  const defaults: Values = React.useMemo(() => ({
    name: group?.name ?? '', notes: group?.notes ?? '', rotationIntervalDays: group?.rotationIntervalDays ?? 5,
  }), [group]);

  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (editing) await update.mutateAsync({ id: group!.id, ...values, reason: 'Rotation group edited' });
      else await create.mutateAsync({ ...values, reason: 'Rotation group created' });
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field) setError(e.field as keyof Values, { message: e.message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${group!.name}` : 'New rotation group'}</DialogTitle>
          <DialogDescription>
            A rotation group holds two or more named batches of Invite Domains, one Active at a time. The interval
            is how many days each full cycle runs before the next rotation is due.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Group name" htmlFor="rtg-name" required error={errors.name?.message} className="sm:col-span-2">
            <Input {...register('name')} autoComplete="off" />
          </Field>
          <Field label="Rotation interval (days)" htmlFor="rtg-interval" required error={errors.rotationIntervalDays?.message}>
            <Input type="number" min={1} max={90} {...register('rotationIntervalDays')} />
          </Field>
          <Field label="Notes" htmlFor="rtg-notes" className="sm:col-span-2">
            <Textarea {...register('notes')} />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create group'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
