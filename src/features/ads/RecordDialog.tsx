import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError } from '@/hooks/useData';
import { checkDailyInput, type Campaign } from '@/lib/ads/campaign';
import { COUNT_FIELDS, METRIC_LABELS, type CountField } from '@/lib/ads/metrics';
import { currencyInfo } from '@/lib/ads/money';
import { useSaveRecord, type SavedRecord } from './api';

type Form = Record<'reportDate' | 'amountSpent' | 'notes' | CountField, string>;

const VISIBLE: Record<Campaign['objective'], CountField[]> = {
  Engagement: ['reach', 'impressions', 'reactions', 'comments', 'shares', 'saves', 'clicksAll', 'linkClicks', 'landingPageViews', 'newFollowers', 'platformPostEngagements'],
  Traffic: ['reach', 'impressions', 'clicksAll', 'linkClicks', 'landingPageViews', 'reactions', 'comments', 'shares', 'saves', 'newFollowers', 'platformPostEngagements'],
  Awareness: ['reach', 'impressions', 'clicksAll', 'linkClicks', 'reactions', 'comments', 'shares', 'saves', 'newFollowers', 'platformPostEngagements', 'landingPageViews'],
  'Follower Growth': ['reach', 'impressions', 'newFollowers', 'reactions', 'comments', 'shares', 'saves', 'clicksAll', 'linkClicks', 'landingPageViews', 'platformPostEngagements'],
  'App Installs': ['reach', 'impressions', 'clicksAll', 'linkClicks', 'appInstalls', 'landingPageViews', 'reactions', 'comments', 'shares', 'saves', 'newFollowers', 'platformPostEngagements'],
};

const toForm = (r?: SavedRecord): Form => ({
  reportDate: r?.reportDate ?? '', amountSpent: r?.amountSpent ? String(Number(r.amountSpent)) : '', notes: r?.notes ?? '',
  ...Object.fromEntries(COUNT_FIELDS.map((f) => [f, r?.[f] === null || r?.[f] === undefined ? '' : String(r[f])])) as Record<CountField, string>,
});

export function RecordDialog({ open, onOpenChange, campaign, record, today }: {
  open: boolean; onOpenChange: (v: boolean) => void; campaign: Campaign; record?: SavedRecord; today: string;
}) {
  const save = useSaveRecord();
  const [form, setForm] = React.useState<Form>(toForm(record));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [warnings, setWarnings] = React.useState<string[]>([]);
  React.useEffect(() => { if (open) { setForm(toForm(record)); setErrors({}); setWarnings([]); } }, [open, record]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fields = VISIBLE[campaign.objective];

  React.useEffect(() => {
    const checked = checkDailyInput(form);
    setWarnings('warnings' in checked ? checked.warnings : []);
  }, [form]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const checked = checkDailyInput(form);
    if ('errors' in checked) { setErrors(checked.errors); return; }
    setErrors({});
    // On edit, a field emptied in the editor is sent as null: clearing is always explicit here.
    const body: Record<string, unknown> = { amountSpent: form.amountSpent.trim() === '' ? null : form.amountSpent, notes: form.notes };
    for (const f of COUNT_FIELDS) body[f] = form[f].trim() === '' ? null : form[f];
    if (!record) body.reportDate = form.reportDate;
    try {
      await save.mutateAsync({ id: record?.id, campaignId: campaign.id, ...body });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{record ? `Daily record — ${record.reportDate}` : 'Add daily record'}</DialogTitle>
          <DialogDescription>
            That day's values only, not running totals, in {campaign.reportingTimezone}. Leave a metric blank when it is not available — blank is never counted as zero.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
          <Field label="Report date" htmlFor="rec-date" required error={errors.reportDate} hint={record ? 'Cannot change.' : undefined}>
            <Input id="rec-date" type="date" value={form.reportDate} max={today} onChange={set('reportDate')} disabled={Boolean(record)} />
          </Field>
          <Field label={`Amount spent (${currencyInfo(campaign.currency).symbol})`} htmlFor="rec-spend" error={errors.amountSpent}>
            <Input id="rec-spend" inputMode="decimal" value={form.amountSpent} onChange={set('amountSpent')} placeholder="e.g. 892.85" />
          </Field>
          {fields.map((f) => (
            <Field key={f} label={METRIC_LABELS[f]} htmlFor={`rec-${f}`} error={errors[f]}
              hint={f === 'reach' ? "That day's reach. Summed over days, not deduplicated." : f === 'platformPostEngagements' ? 'The platform’s own figure; kept separate from our calculation.' : undefined}>
              <Input id={`rec-${f}`} inputMode="numeric" value={form[f]} onChange={set(f)} />
            </Field>
          ))}
          <Field label="Notes" htmlFor="rec-notes" className="sm:col-span-3">
            <Textarea id="rec-notes" rows={2} value={form.notes} onChange={set('notes')} />
          </Field>
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning-bg/40 px-3 py-2 text-[12px] sm:col-span-3" aria-live="polite">
              {warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />{w}</li>)}
            </ul>
          )}
          <DialogFooter className="sm:col-span-3">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save record'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
