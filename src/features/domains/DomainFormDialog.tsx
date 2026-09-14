import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError, useCreate, useCrmData, useUpdate } from '@/hooks/useData';
import { DOMAIN_COUNTRY, DOMAIN_STATUS, type DomainRecord } from '@/lib/types';
import { DOMAIN_PATTERN, normalizeDomain } from '@/lib/utils';
import { readNameservers } from '@/lib/domain-import';

const schema = z
  .object({
    domainName: z
      .string()
      .min(1, 'A domain name is required.')
      .refine((v) => DOMAIN_PATTERN.test(normalizeDomain(v)), 'Enter a valid domain such as example.co.in.'),
    targetCountry: z.enum(DOMAIN_COUNTRY),
    rotationDate: z.string(),
    registeredDate: z.string().min(1, 'A registration date is required.'),
    expirationDate: z.string().min(1, 'An expiration date is required.'),
    status: z.enum(DOMAIN_STATUS),
    brandId: z.string(),
    registrar: z.string().max(80),
    registrarUid: z.string().max(64),
    category: z.string().max(80),
    nameservers: z.string().refine((v) => !('error' in readNameservers(v)), 'Enter nameserver hostnames separated by commas.'),
    notes: z.string(),
  })
  .refine((v) => v.expirationDate >= v.registeredDate, {
    message: 'Expiration cannot precede the registration date.',
    path: ['expirationDate'],
  })
  .refine((v) => !v.rotationDate || v.rotationDate >= v.registeredDate, {
    message: 'A rotation cannot predate registration.',
    path: ['rotationDate'],
  });

type Values = z.infer<typeof schema>;

export function DomainFormDialog({
  open, onOpenChange, domain,
}: { open: boolean; onOpenChange: (v: boolean) => void; domain?: DomainRecord }) {
  const { data } = useCrmData();
  const create = useCreate<DomainRecord>('domains', 'Domain');
  const update = useUpdate<DomainRecord>('domains', 'Domain');
  const editing = Boolean(domain);

  const defaults: Values = React.useMemo(() => ({
    domainName: domain?.domainName ?? '',
    targetCountry: domain?.targetCountry ?? 'India',
    rotationDate: domain?.rotationDate ?? '',
    registeredDate: domain?.registeredDate ?? '',
    expirationDate: domain?.expirationDate ?? '',
    status: domain?.status ?? 'Active',
    brandId: domain?.brandId ?? '',
    registrar: domain?.registrar ?? '',
    registrarUid: domain?.registrarUid ?? '',
    category: domain?.category ?? '',
    nameservers: domain?.nameservers ?? '',
    notes: domain?.notes ?? '',
  }), [domain]);

  const { register, handleSubmit, reset, setError, watch, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const typed = normalizeDomain(watch('domainName'));
  const duplicate = (data?.domains ?? []).find((d) => d.id !== domain?.id && !d.archived && d.domainName === typed && typed.length > 2);

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      ...values,
      domainName: normalizeDomain(values.domainName),
      rotationDate: values.rotationDate || null,
      brandId: values.brandId || null,
      reason: editing ? 'Domain record edited' : 'Domain added to register',
    };
    try {
      if (editing) await update.mutateAsync({ id: domain!.id, ...payload });
      else await create.mutateAsync(payload);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field) setError(e.field as keyof Values, { message: e.message });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${domain!.domainName}` : 'Add a domain'}</DialogTitle>
          <DialogDescription>
            Domain names are stored lowercase and must be unique. Changing a rotation date keeps the previous value in
            the audit history.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Domain name"
            htmlFor="dom-name"
            required
            className="sm:col-span-2"
            error={errors.domainName?.message ?? (duplicate ? `${typed} already exists in the register (${duplicate.id}).` : undefined)}
            hint={!duplicate && typed && typed !== watch('domainName').trim() ? `Will be saved as ${typed}` : 'Stored lowercase. Scheme and www. are stripped.'}
          >
            <Input {...register('domainName')} placeholder="auroraretail.co.in" autoComplete="off" spellCheck={false} />
          </Field>

          <Field label="Target country" htmlFor="dom-country" required error={errors.targetCountry?.message}>
            <NativeSelect {...register('targetCountry')}>
              {DOMAIN_COUNTRY.map((c) => <option key={c} value={c}>{c}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Status" htmlFor="dom-status" hint="Expiry highlighting never changes this by itself.">
            <NativeSelect {...register('status')}>
              {DOMAIN_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Registered" htmlFor="dom-registered" required error={errors.registeredDate?.message}>
            <Input type="date" {...register('registeredDate')} />
          </Field>

          <Field label="Expiration" htmlFor="dom-expiration" required error={errors.expirationDate?.message}>
            <Input type="date" {...register('expirationDate')} />
          </Field>

          <Field label="Rotation date" htmlFor="dom-rotation" error={errors.rotationDate?.message}
            hint="Optional until the domain is rotated. Left blank it shows as “Not rotated”.">
            <Input type="date" {...register('rotationDate')} />
          </Field>

          <Field label="Brand" htmlFor="dom-brand">
            <NativeSelect {...register('brandId')}>
              <option value="">— None —</option>
              {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Registrar" htmlFor="dom-registrar" hint="e.g. RealTime, Gname.">
            <Input {...register('registrar')} autoComplete="off" />
          </Field>

          <Field label="Registrar UID" htmlFor="dom-uid" hint="The registrar account number, not a login.">
            <Input {...register('registrarUid')} autoComplete="off" spellCheck={false} />
          </Field>

          <Field label="Category" htmlFor="dom-category">
            <Input {...register('category')} placeholder="Ungrouped" autoComplete="off" />
          </Field>

          <Field label="Nameservers" htmlFor="dom-ns" className="sm:col-span-2" error={errors.nameservers?.message}
            hint="Comma-separated, e.g. chad.ns.cloudflare.com,clarissa.ns.cloudflare.com">
            <Input {...register('nameservers')} autoComplete="off" spellCheck={false} />
          </Field>

          <Field label="Notes" htmlFor="dom-notes" className="sm:col-span-2">
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
