import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError } from '@/hooks/useData';
import { useCreateRotationBatch, useUpdateRotationBatch } from './api';
import type { RotationBatchRecord, RotationGroupRecord } from '@/lib/types';

const schema = z.object({ name: z.string().min(1, 'A batch name is required.') });
type Values = z.infer<typeof schema>;

export function RotationBatchFormDialog({
  open, onOpenChange, group, batch,
}: { open: boolean; onOpenChange: (v: boolean) => void; group: RotationGroupRecord; batch?: RotationBatchRecord }) {
  const create = useCreateRotationBatch();
  const update = useUpdateRotationBatch();
  const editing = Boolean(batch);

  const defaults: Values = React.useMemo(() => ({ name: batch?.name ?? '' }), [batch]);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (editing) await update.mutateAsync({ id: batch!.id, ...values, reason: 'Rotation batch edited' });
      else await create.mutateAsync({ groupId: group.id, ...values, reason: 'Rotation batch created' });
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field) setError(e.field as keyof Values, { message: e.message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${batch!.name}` : `New batch in ${group.name}`}</DialogTitle>
          <DialogDescription>
            A new batch starts Standby. It becomes Active only once a full rotation brings it in.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <Field label="Batch name" htmlFor="rtb-name" required error={errors.name?.message}>
            <Input {...register('name')} autoComplete="off" placeholder="e.g. Batch A" />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create batch'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
