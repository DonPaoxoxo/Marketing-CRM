import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError, useCreate, useCrmData, useUpdate } from '@/hooks/useData';
import { ALLOCATION_STATUS, SIM_CREATED_FOR, SIM_CREATED_FOR_MAX, SIM_FORM, SIM_OPERATIONAL_STATUS, type Sim } from '@/lib/types';
import { emailKey, phoneKey, telegramKey } from '@/lib/identity';
import { checkSimExtras } from '@/lib/sim-import';
import { normalizePhone } from '@/lib/utils';

const schema = z.object({
  phoneNumber: z
    .string()
    .min(1, 'A phone number is required.')
    .refine((v) => normalizePhone(v).length >= 8, 'Enter a full number including country code, e.g. +91 98765 43210.'),
  countryCode: z.string().min(1, 'Select a country.'),
  // Optional: the team's SIM sheet has no provider column, so uploaded SIMs
  // arrive without one and must still be editable. Data quality lists the gaps.
  provider: z.string(),
  form: z.enum(SIM_FORM),
  createdFor: z.string().max(SIM_CREATED_FOR_MAX, `Keep it to ${SIM_CREATED_FOR_MAX} characters.`),
  // The same rules as a sheet row (checkSimExtras), so the form and an upload
  // refuse the same values.
  email: z.string().refine((v) => !('field' in checkSimExtras({ email: v })), 'Not a valid email address.'),
  telegramUsername: z.string().refine(
    (v) => !('field' in checkSimExtras({ telegramUsername: v })),
    'A Telegram username is 5–32 letters, digits or underscores, starting with a letter.',
  ),
  brandId: z.string(),
  projectId: z.string(),
  operationalStatus: z.enum(SIM_OPERATIONAL_STATUS),
  allocationStatus: z.enum(ALLOCATION_STATUS),
  planExpiryDate: z.string(),
  lastVerifiedDate: z.string(),
  notes: z.string(),
});

type Values = z.infer<typeof schema>;

export function SimFormDialog({
  open, onOpenChange, sim,
}: { open: boolean; onOpenChange: (v: boolean) => void; sim?: Sim }) {
  const { data } = useCrmData();
  const create = useCreate<Sim>('sims', 'SIM record');
  const update = useUpdate<Sim>('sims', 'SIM record');
  const editing = Boolean(sim);

  // A new SIM starts in the country most of the register's SIMs are in.
  const busiestCountry = React.useMemo(() => {
    const counts = new Map<string, number>();
    (data?.sims ?? []).filter((s) => !s.archived).forEach((s) => counts.set(s.countryCode, (counts.get(s.countryCode) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? data?.countries[0]?.code ?? 'PH';
  }, [data]);

  const defaults: Values = React.useMemo(
    () => ({
      phoneNumber: sim?.phoneNumber ?? '',
      countryCode: sim?.countryCode ?? busiestCountry,
      provider: sim?.provider ?? '',
      form: sim?.form ?? 'Physical SIM',
      createdFor: sim?.createdFor ?? '',
      email: sim?.email ?? '',
      telegramUsername: sim?.telegramUsername ? `@${sim.telegramUsername}` : '',
      brandId: sim?.brandId ?? '',
      projectId: sim?.projectId ?? '',
      operationalStatus: sim?.operationalStatus ?? 'Active',
      allocationStatus: sim?.allocationStatus ?? 'Available',
      planExpiryDate: sim?.planExpiryDate ?? '',
      lastVerifiedDate: sim?.lastVerifiedDate ?? '',
      notes: sim?.notes ?? '',
    }),
    [sim, busiestCountry],
  );

  const { register, handleSubmit, reset, setError, setValue, watch, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  // Created For: a preset from the list, or "Custom…" with the purpose typed in.
  const isPreset = (v: string) => v === '' || (SIM_CREATED_FOR as readonly string[]).includes(v);
  const [customPurpose, setCustomPurpose] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    reset(defaults);
    setCustomPurpose(!isPreset(defaults.createdFor));
  }, [open, defaults, reset]);
  // Purposes already written on other SIMs, suggested so the same one is spelled the same way.
  const knownPurposes = React.useMemo(
    () => [...new Set((data?.sims ?? []).map((s) => s.createdFor).filter((c) => c && !isPreset(c)))].sort(),
    [data],
  );

  const brandId = watch('brandId');
  const projectOptions = (data?.projects ?? []).filter((p) => !brandId || p.brandId === brandId);

  // Live duplicate check before the request is even made. Only a number that
  // differs from the record's own — an older clash must not lock the record.
  const typedNumber = normalizePhone(watch('phoneNumber'));
  const typedKey = phoneKey(typedNumber);
  const duplicate = typedKey && typedKey !== phoneKey(sim?.phoneNumber)
    ? (data?.sims ?? []).find((s) => s.id !== sim?.id && !s.archived && phoneKey(s.phoneNumber) === typedKey)
    : undefined;

  // An email or Telegram username belongs to one live SIM, as in the sheet.
  // Only a value that differs from the record's own is checked.
  const others = (data?.sims ?? []).filter((s) => s.id !== sim?.id && !s.archived);
  const typedEmail = emailKey(watch('email'));
  const emailHolder = typedEmail && typedEmail !== emailKey(sim?.email)
    ? others.find((s) => emailKey(s.email) === typedEmail) : undefined;
  const typedTelegram = telegramKey(watch('telegramUsername'));
  const telegramHolder = typedTelegram && typedTelegram !== telegramKey(sim?.telegramUsername)
    ? others.find((s) => telegramKey(s.telegramUsername) === typedTelegram) : undefined;

  const onSubmit = handleSubmit(async (values) => {
    if (customPurpose && !values.createdFor.trim()) {
      setError('createdFor', { message: 'Write what the SIM is used for, e.g. Serper, Twilio, Discord.' });
      return;
    }
    if (duplicate || emailHolder || telegramHolder) {
      if (duplicate) setError('phoneNumber', { message: `${typedNumber} is already registered on ${duplicate.id}.` });
      if (emailHolder) setError('email', { message: `This email is already on ${emailHolder.id}.` });
      if (telegramHolder) setError('telegramUsername', { message: `This Telegram username is already on ${telegramHolder.id}.` });
      return;
    }
    const payload = {
      ...values,
      brandId: values.brandId || null,
      projectId: values.projectId || null,
      planExpiryDate: values.planExpiryDate || null,
      lastVerifiedDate: values.lastVerifiedDate || null,
      reason: editing ? 'SIM record edited' : 'SIM record created',
    };
    try {
      if (editing) await update.mutateAsync({ id: sim!.id, ...payload });
      else await create.mutateAsync(payload);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && (e.field === 'phoneNumber' || e.field === 'email' || e.field === 'telegramUsername' || e.field === 'createdFor')) {
        setError(e.field, { message: e.message });
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${sim!.id}` : 'Register a SIM or phone number'}</DialogTitle>
          <DialogDescription>
            Identity-document uploads are out of scope for this phase. Record the operational facts only.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Full phone number" htmlFor="sim-phone" required
            error={errors.phoneNumber?.message ?? (duplicate ? `${typedNumber} is already registered on ${duplicate.id}.` : undefined)}
            hint="Include the country code. Stored normalised to E.164.">
            <Input {...register('phoneNumber')} placeholder="+91 98765 43210" autoComplete="off" />
          </Field>

          <Field label="Country" htmlFor="sim-country" required error={errors.countryCode?.message}>
            <NativeSelect {...register('countryCode')}>
              {(data?.countries ?? []).map((c) => (
                <option key={c.code} value={c.code}>{c.name} ({c.dialCode})</option>
              ))}
            </NativeSelect>
          </Field>

          <Field label="Network provider" htmlFor="sim-provider" error={errors.provider?.message} hint="Leave blank if unknown.">
            <Input {...register('provider')} placeholder="Globe" />
          </Field>

          <Field label="Created For" htmlFor="sim-created-for" hint="What this SIM is used for." error={customPurpose ? undefined : errors.createdFor?.message}>
            <NativeSelect
              id="sim-created-for"
              value={customPurpose ? '__custom__' : watch('createdFor')}
              onChange={(e) => {
                const choice = e.target.value;
                setCustomPurpose(choice === '__custom__');
                setValue('createdFor', choice === '__custom__' ? '' : choice, { shouldDirty: true });
              }}
            >
              <option value="">— Nothing yet —</option>
              {SIM_CREATED_FOR.map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__custom__">Custom…</option>
            </NativeSelect>
          </Field>

          {customPurpose && (
            <Field label="Custom purpose" htmlFor="sim-created-for-custom" required error={errors.createdFor?.message}
              hint="Whatever the SIM is used for, e.g. Serper, Twilio, Discord.">
              <Input {...register('createdFor')} id="sim-created-for-custom" list="sim-purposes" placeholder="Serper"
                maxLength={SIM_CREATED_FOR_MAX} autoComplete="off" autoFocus />
              <datalist id="sim-purposes">
                {knownPurposes.map((p) => <option key={p} value={p} />)}
              </datalist>
            </Field>
          )}

          <Field label="Email" htmlFor="sim-email"
            error={errors.email?.message ?? (emailHolder ? `This email is already on ${emailHolder.id}.` : undefined)}>
            <Input type="email" {...register('email')} placeholder="name@gmail.com" autoComplete="off" />
          </Field>

          <Field label="Telegram username" htmlFor="sim-telegram"
            error={errors.telegramUsername?.message ?? (telegramHolder ? `This Telegram username is already on ${telegramHolder.id}.` : undefined)}>
            <Input {...register('telegramUsername')} placeholder="@username or https://t.me/username" autoComplete="off" />
          </Field>

          <Field label="SIM form" htmlFor="sim-form">
            <NativeSelect {...register('form')}>
              {SIM_FORM.map((f) => <option key={f} value={f}>{f}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Associated brand" htmlFor="sim-brand">
            <NativeSelect {...register('brandId')}>
              <option value="">— None —</option>
              {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Project" htmlFor="sim-project">
            <NativeSelect {...register('projectId')}>
              <option value="">— None —</option>
              {projectOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Operational status" htmlFor="sim-op" hint="Whether the SIM works.">
            <NativeSelect {...register('operationalStatus')}>
              {SIM_OPERATIONAL_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Allocation status" htmlFor="sim-alloc" hint="Whether it is spoken for.">
            <NativeSelect {...register('allocationStatus')}>
              {ALLOCATION_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Plan expiry / renewal date" htmlFor="sim-expiry">
            <Input type="date" {...register('planExpiryDate')} />
          </Field>

          <Field label="Last verified date" htmlFor="sim-verified">
            <Input type="date" {...register('lastVerifiedDate')} />
          </Field>

          <Field label="Notes" htmlFor="sim-notes" className="sm:col-span-2">
            <Textarea {...register('notes')} placeholder="Operational context. Never record PINs, PUKs or passwords here." />
          </Field>

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Register SIM'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
