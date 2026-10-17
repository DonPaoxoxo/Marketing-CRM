import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError, useCrmData } from '@/hooks/useData';
import { useCreateDomainMonitor, useUpdateDomainMonitor } from './api';
import { DOMAIN_MONITOR_TYPE, type DomainMonitorRecord } from '@/lib/types';
import { DOMAIN_PATTERN, normalizeDomain } from '@/lib/utils';

const schema = z.object({
  domainType: z.enum(DOMAIN_MONITOR_TYPE),
  domainName: z
    .string()
    .min(1, 'A domain URL is required.')
    .refine((v) => DOMAIN_PATTERN.test(normalizeDomain(v)), 'Enter a valid domain such as example.com.'),
  notes: z.string(),
});

type Values = z.infer<typeof schema>;

export function DomainMonitorFormDialog({
  open, onOpenChange, monitor,
}: { open: boolean; onOpenChange: (v: boolean) => void; monitor?: DomainMonitorRecord }) {
  const { data } = useCrmData();
  const create = useCreateDomainMonitor();
  const update = useUpdateDomainMonitor();
  const editing = Boolean(monitor);

  const defaults: Values = React.useMemo(() => ({
    domainType: monitor?.domainType ?? 'Free Cash',
    domainName: monitor?.domainName ?? '',
    notes: monitor?.notes ?? '',
  }), [monitor]);

  const { register, handleSubmit, reset, setError, watch, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const typed = normalizeDomain(watch('domainName'));
  const duplicate = (data?.domainMonitors ?? []).find((d) => d.id !== monitor?.id && !d.archived && d.domainName === typed && typed.length > 2);

  const onSubmit = handleSubmit(async (values) => {
    const payload = { ...values, domainName: normalizeDomain(values.domainName) };
    try {
      if (editing) await update.mutateAsync({ id: monitor!.id, ...payload, reason: 'Domain monitor edited' });
      else await create.mutateAsync({ ...payload, reason: `${values.domainType} Domain added` });
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field) setError(e.field as keyof Values, { message: e.message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${monitor!.domainName}` : 'Add a domain'}</DialogTitle>
          <DialogDescription>
            Added as Not Checked — daily accessibility is recorded separately. Invite Domains start Standby until
            assigned to a rotation batch.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Category" htmlFor="dm-type" required error={errors.domainType?.message}
            hint={editing ? 'Cannot be changed after adding — add a new domain instead.' : undefined}>
            <NativeSelect {...register('domainType')} disabled={editing}>
              {DOMAIN_MONITOR_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </Field>

          <Field
            label="Domain URL"
            htmlFor="dm-name"
            required
            error={errors.domainName?.message ?? (duplicate ? `${typed} already exists in the register (${duplicate.id}).` : undefined)}
            hint={!duplicate && typed && typed !== watch('domainName').trim() ? `Will be saved as ${typed}` : 'Scheme and www. are stripped.'}
          >
            <Input {...register('domainName')} placeholder="example.com" autoComplete="off" spellCheck={false} />
          </Field>

          <Field label="Notes" htmlFor="dm-notes" className="sm:col-span-2">
            <Textarea {...register('notes')} />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add domain'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
