import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError, useCreate, useCrmData, useUpdate } from '@/hooks/useData';
import type { CompetitorRecord } from '@/lib/types';

const schema = z.object({
  platformId: z.string().min(1, 'Select a platform.'),
  linkOrDomain: z.string().min(1, 'Enter a link or domain.'),
  whatsapp: z.string(),
  telegram: z.string(),
  others: z.string(),
  notes: z.string(),
});

type Values = z.infer<typeof schema>;

export function CompetitorFormDialog({
  open, onOpenChange, competitor,
}: { open: boolean; onOpenChange: (v: boolean) => void; competitor?: CompetitorRecord }) {
  const { data } = useCrmData();
  const create = useCreate<CompetitorRecord>('pakistan-competitors', 'Competitor');
  const update = useUpdate<CompetitorRecord>('pakistan-competitors', 'Competitor');
  const editing = Boolean(competitor);

  const defaults: Values = React.useMemo(() => ({
    platformId: competitor?.platformId ?? data?.platforms[0]?.id ?? '',
    linkOrDomain: competitor?.linkOrDomain ?? '',
    whatsapp: competitor?.whatsapp ?? '',
    telegram: competitor?.telegram ?? '',
    others: competitor?.others ?? '',
    notes: competitor?.notes ?? '',
  }), [competitor, data]);

  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const payload = { ...values, reason: editing ? 'Competitor record edited' : 'Competitor added to register' };
    try {
      if (editing) await update.mutateAsync({ id: competitor!.id, ...payload });
      else await create.mutateAsync(payload);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field) setError(e.field as keyof Values, { message: e.message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${competitor!.id}` : 'Add a Pakistan competitor'}</DialogTitle>
          <DialogDescription>
            Where a competitor is found and how to reach them — not their performance figures.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Platform" htmlFor="cmp-platform" required error={errors.platformId?.message}>
            <NativeSelect {...register('platformId')}>
              {(data?.platforms ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Link / Domain" htmlFor="cmp-link" required error={errors.linkOrDomain?.message} hint="A profile link or a bare domain.">
            <Input {...register('linkOrDomain')} placeholder="https://… or example.com" />
          </Field>

          <Field label="WhatsApp" htmlFor="cmp-whatsapp" hint="Number or invite link, as published.">
            <Input {...register('whatsapp')} placeholder="+92…" />
          </Field>
          <Field label="Telegram" htmlFor="cmp-telegram" hint="@handle or invite link.">
            <Input {...register('telegram')} placeholder="@handle" />
          </Field>

          <Field label="Others" htmlFor="cmp-others" className="sm:col-span-2" hint="Any other reference — a second channel, a phone number, an email.">
            <Input {...register('others')} />
          </Field>

          <Field label="Notes" htmlFor="cmp-notes" className="sm:col-span-2">
            <Textarea {...register('notes')} />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Add competitor'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
