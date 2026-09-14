import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError, useCrmData } from '@/hooks/useData';
import { CAMPAIGN_STATUSES, COUNTRY_TIMEZONES, TIMEZONES, checkCampaignInput, type Campaign } from '@/lib/ads/campaign';
import { OBJECTIVES } from '@/lib/ads/metrics';
import { CURRENCIES } from '@/lib/ads/money';
import { useSaveCampaign } from './api';

type Form = Record<'reference' | 'name' | 'platformId' | 'brandId' | 'projectId' | 'targetCountryCode' | 'socialAccountId' | 'assignedStaffId' | 'objective' | 'currency' | 'budget' | 'startDate' | 'endDate' | 'status' | 'adsUrl' | 'reportingTimezone' | 'notes', string>;

const fromCampaign = (c?: Campaign): Form => ({
  reference: c?.reference ?? '', name: c?.name ?? '', platformId: c?.platformId ?? '', brandId: c?.brandId ?? '', projectId: c?.projectId ?? '',
  targetCountryCode: c?.targetCountryCode ?? '', socialAccountId: c?.socialAccountId ?? '', assignedStaffId: c?.assignedStaffId ?? '',
  objective: c?.objective ?? 'Engagement', currency: c?.currency ?? 'PHP', budget: c?.budget ? String(Number(c.budget)) : '',
  startDate: c?.startDate ?? '', endDate: c?.endDate ?? '', status: c?.status ?? 'Draft', adsUrl: c?.adsUrl ?? '',
  reportingTimezone: c?.reportingTimezone ?? '', notes: c?.notes ?? '',
});

export function CampaignFormDialog({ open, onOpenChange, campaign, hasRecords = false, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; campaign?: Campaign; hasRecords?: boolean; onSaved?: (c: Campaign) => void;
}) {
  const { data } = useCrmData();
  const save = useSaveCampaign();
  const [form, setForm] = React.useState<Form>(fromCampaign(campaign));
  const [errors, setErrors] = React.useState<Partial<Record<keyof Form, string>>>({});
  const editing = Boolean(campaign);

  React.useEffect(() => { if (open) { setForm(fromCampaign(campaign)); setErrors({}); } }, [open, campaign]);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = { ...form, reportingTimezone: form.reportingTimezone || COUNTRY_TIMEZONES[form.targetCountryCode] || 'UTC' };
    const checked = checkCampaignInput(body);
    if ('errors' in checked) { setErrors(checked.errors); return; }
    if (checked.value.status === 'Archived') { setErrors({ status: 'Archive a campaign from its page, with a reason.' }); return; }
    setErrors({});
    try {
      const { reference: _r, ...rest } = body;
      const saved = await save.mutateAsync(editing ? { id: campaign!.id, ...rest } : body);
      onOpenChange(false);
      onSaved?.(saved);
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
    }
  };

  const accounts = (data?.socialAccounts ?? []).filter((a) => !a.archived && (!form.platformId || a.platformId === form.platformId));
  const projects = (data?.projects ?? []).filter((p) => !form.brandId || p.brandId === form.brandId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${campaign!.reference}` : 'New ads campaign'}</DialogTitle>
          <DialogDescription>You become the campaign's owner. Assigning staff does not give them editing rights.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Campaign reference" htmlFor="ads-ref" required error={errors.reference} hint={editing ? 'Stable — it cannot change.' : 'Unique and permanent, e.g. PH-FB-2026-09.'}>
            <Input id="ads-ref" value={form.reference} onChange={set('reference')} disabled={editing} autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Campaign name" htmlFor="ads-name" required error={errors.name}>
            <Input id="ads-name" value={form.name} onChange={set('name')} />
          </Field>
          <Field label="Platform" htmlFor="ads-platform" required error={errors.platformId}>
            <NativeSelect id="ads-platform" value={form.platformId} onChange={set('platformId')}>
              <option value="">Choose…</option>
              {(data?.platforms ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Objective" htmlFor="ads-objective" required error={errors.objective}>
            <NativeSelect id="ads-objective" value={form.objective} onChange={set('objective')}>
              {OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Brand" htmlFor="ads-brand" error={errors.brandId}>
            <NativeSelect id="ads-brand" value={form.brandId} onChange={set('brandId')}>
              <option value="">— None —</option>
              {(data?.brands ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Project" htmlFor="ads-project" error={errors.projectId}>
            <NativeSelect id="ads-project" value={form.projectId} onChange={set('projectId')}>
              <option value="">— None —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Target country" htmlFor="ads-country" required error={errors.targetCountryCode}>
            <NativeSelect id="ads-country" value={form.targetCountryCode} onChange={set('targetCountryCode')}>
              <option value="">Choose…</option>
              {(data?.countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Social account" htmlFor="ads-account" error={errors.socialAccountId}>
            <NativeSelect id="ads-account" value={form.socialAccountId} onChange={set('socialAccountId')}>
              <option value="">— None —</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.id} — @{a.username}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Assigned staff" htmlFor="ads-staff" error={errors.assignedStaffId} hint="For follow-up only — grants no editing rights.">
            <NativeSelect id="ads-staff" value={form.assignedStaffId} onChange={set('assignedStaffId')}>
              <option value="">— Unassigned —</option>
              {(data?.teamMembers ?? []).filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Status" htmlFor="ads-status" error={errors.status}>
            <NativeSelect id="ads-status" value={form.status} onChange={set('status')}>
              {CAMPAIGN_STATUSES.filter((s) => s !== 'Archived').map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Currency" htmlFor="ads-currency" required error={errors.currency} hint={editing && hasRecords ? 'Locked: daily records already use this currency.' : 'One currency per campaign.'}>
            <NativeSelect id="ads-currency" value={form.currency} onChange={set('currency')} disabled={editing && hasRecords}>
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label} {c.symbol}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Campaign budget" htmlFor="ads-budget" error={errors.budget} hint="Number only, e.g. 30000.">
            <Input id="ads-budget" inputMode="decimal" value={form.budget} onChange={set('budget')} />
          </Field>
          <Field label="Start date" htmlFor="ads-start" required error={errors.startDate}>
            <Input id="ads-start" type="date" value={form.startDate} onChange={set('startDate')} />
          </Field>
          <Field label="End date" htmlFor="ads-end" required error={errors.endDate}>
            <Input id="ads-end" type="date" value={form.endDate} onChange={set('endDate')} />
          </Field>
          <Field label="Reporting timezone" htmlFor="ads-tz" error={errors.reportingTimezone} hint="Report dates and 'complete days' use this timezone. Defaults from the target country.">
            <NativeSelect id="ads-tz" value={form.reportingTimezone} onChange={set('reportingTimezone')}>
              <option value="">From target country{form.targetCountryCode ? ` (${COUNTRY_TIMEZONES[form.targetCountryCode] ?? 'UTC'})` : ''}</option>
              {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Ads URL" htmlFor="ads-url" error={errors.adsUrl} hint="https:// link to the Ads Library listing. Not verified with the platform.">
            <Input id="ads-url" value={form.adsUrl} onChange={set('adsUrl')} placeholder="https://www.facebook.com/ads/library/?id=…" spellCheck={false} />
          </Field>
          <Field label="Notes" htmlFor="ads-notes" className="sm:col-span-2" error={errors.notes}>
            <Textarea id="ads-notes" value={form.notes} onChange={set('notes')} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create campaign'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
