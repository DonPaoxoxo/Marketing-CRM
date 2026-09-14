import * as React from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, CircleHelp, Plus, Trash2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Input, Label, Skeleton, Switch, Textarea } from '@/components/ui/primitives';
import { SectionCard, ErrorState } from '@/components/common/bits';
import { formatDateTime } from '@/lib/utils';
import { MAIN_MODEL_COUNT, MAX_MODELS, MODEL_ID, aiSettingsSchema, firstIssueOf, type AiSettings } from './settings-helpers';
import { useAiLogs, useAiSettings, useCategories, useLibrary, useOwnerSettings } from './api';

export function OwnerSettings() {
  return (
    <div className="flex flex-col gap-4">
      <AiSettingsCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <CategoriesCard />
        <AnnouncementCard />
      </div>
      <AiLogsCard />
    </div>
  );
}

function CategoriesCard() {
  const categories = useCategories();
  const m = useOwnerSettings();
  const [name, setName] = React.useState('');
  const [renaming, setRenaming] = React.useState<Record<string, string>>({});
  const list = categories.data ?? [];
  const move = (index: number, delta: number) => {
    const ids = list.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    m.reorder.mutate(ids);
  };
  return (
    <SectionCard title="Spiel categories" description="Add, rename, deactivate or reorder. Deactivated categories keep their spiels but cannot be chosen for new ones.">
      {categories.isLoading ? <Skeleton className="h-40" /> : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
              <Label htmlFor={`cat-${c.id}`} className="sr-only">Name for {c.name}</Label>
              <Input id={`cat-${c.id}`} className="h-8 min-w-[10rem] flex-1" value={renaming[c.id] ?? c.name} maxLength={80}
                onChange={(e) => setRenaming((r) => ({ ...r, [c.id]: e.target.value }))} />
              {renaming[c.id] !== undefined && renaming[c.id] !== c.name && (
                <Button size="sm" variant="outline" onClick={() => m.updateCategory.mutate({ id: c.id, name: renaming[c.id] }, { onSuccess: () => setRenaming((r) => { const { [c.id]: _drop, ...rest } = r; return rest; }) })}>Rename</Button>
              )}
              <span className="flex items-center gap-1.5 text-[12px]">
                <Switch id={`cat-active-${c.id}`} checked={c.active} onCheckedChange={(active) => m.updateCategory.mutate({ id: c.id, active })} />
                <Label htmlFor={`cat-active-${c.id}`} className="text-[12px] font-normal">{c.active ? 'Active' : 'Inactive'}</Label>
              </span>
              <Button size="icon-sm" variant="ghost" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Move ${c.name} down`} disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
            </li>
          ))}
        </ul>
      )}
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) m.addCategory.mutate(name, { onSuccess: () => setName('') }); }}>
        <Label htmlFor="new-category" className="sr-only">New category name</Label>
        <Input id="new-category" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="New category name" />
        <Button type="submit" size="sm" disabled={name.trim().length < 3}><Plus /> Add</Button>
      </form>
    </SectionCard>
  );
}

function AnnouncementCard() {
  const library = useLibrary();
  const m = useOwnerSettings();
  const [text, setText] = React.useState('');
  React.useEffect(() => { setText(library.data?.announcement ?? ''); }, [library.data?.announcement]);
  return (
    <SectionCard title="Administrator announcement" description="Shown at the top of the library for everyone. Leave empty to hide it.">
      <Label htmlFor="announcement" className="sr-only">Announcement</Label>
      <Textarea id="announcement" rows={5} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Use the new Diwali greeting spiels from 20 October." />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">{text.length}/1000</span>
        <Button size="sm" disabled={text === (library.data?.announcement ?? '') || m.announcement.isPending} onClick={() => m.announcement.mutate(text)}>Save announcement</Button>
      </div>
    </SectionCard>
  );
}

function AiSettingsCard() {
  const query = useAiSettings(true);
  const m = useOwnerSettings();
  const [form, setForm] = React.useState<AiSettings | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [availability, setAvailability] = React.useState<{ map: Record<string, boolean> | null; at: string } | null>(null);
  React.useEffect(() => { if (query.data) setForm(query.data.settings); }, [query.data]);
  if (query.error) return <ErrorState message={query.error.message} onRetry={() => query.refetch()} />;
  if (!form) return <Skeleton className="h-64" />;

  const setModel = (i: number, patch: Partial<AiSettings['models'][number]>) => setForm({ ...form, models: form.models.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const moveModel = (i: number, delta: number) => { const models = [...form.models]; const [x] = models.splice(i, 1); models.splice(i + delta, 0, x); setForm({ ...form, models }); };
  const num = (key: keyof AiSettings, label: string, min: number, max: number, step = 1, hint?: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`ai-${key}`} className="text-[12px]">{label}</Label>
      <Input id={`ai-${key}`} type="number" min={min} max={max} step={step} value={String(form[key])} onChange={(e) => setForm({ ...form, [key]: Number(e.target.value) })} />
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
  const save = () => {
    const parsed = aiSettingsSchema.safeParse(form);
    if (!parsed.success) { setError(firstIssueOf(parsed.error)); return; }
    setError(null);
    m.ai.mutate(parsed.data);
  };
  const primary = form.models.find((x) => x.enabled);

  return (
    <SectionCard title="AI Assistant Learner" description="OpenRouter models, limits and the on/off switch. The API key is a server environment variable and is never shown here.">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-2">
            <Switch id="ai-enabled" checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
            <Label htmlFor="ai-enabled">{form.enabled ? 'Enabled for members' : 'Turned off'}</Label>
          </span>
          <Badge tone={query.data?.configured ? 'success' : 'danger'}>{query.data?.configured ? 'OPENROUTER_API_KEY is set' : 'OPENROUTER_API_KEY is missing on the server'}</Badge>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-[13px] font-medium">Models in fallback order</legend>
          <p className="text-[12px] text-muted-foreground">The first {MAIN_MODEL_COUNT} are the main models and the rest are fallbacks. Models are tried top to bottom: if one times out, is rate-limited, overloaded or returns an unreadable answer, the next enabled model is tried until the whole-request time limit is reached. First enabled model: <span className="font-medium">{primary?.id ?? 'none'}</span>.</p>
          <ol className="flex flex-col gap-2">
            {form.models.map((model, i) => {
              const listed = availability?.map ? availability.map[model.id] : undefined;
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-2">
                  <span className="w-20 text-[12px] text-muted-foreground">{i < MAIN_MODEL_COUNT ? `Main ${i + 1}` : `Fallback ${i - MAIN_MODEL_COUNT + 1}`}</span>
                  <Label htmlFor={`model-${i}`} className="sr-only">Model id {i + 1}</Label>
                  <Input id={`model-${i}`} className="h-8 min-w-[14rem] flex-1 font-mono text-[12px]" value={model.id} onChange={(e) => setModel(i, { id: e.target.value.trim() })}
                    aria-invalid={!MODEL_ID.test(model.id) || undefined} />
                  {listed === true && <Badge tone="success"><CheckCircle2 className="size-3" /> Listed</Badge>}
                  {listed === false && <Badge tone="danger"><XCircle className="size-3" /> Not listed</Badge>}
                  {listed === undefined && availability && <Badge tone="neutral"><CircleHelp className="size-3" /> Unknown</Badge>}
                  <span className="flex items-center gap-1.5">
                    <Switch id={`model-on-${i}`} checked={model.enabled} onCheckedChange={(enabled) => setModel(i, { enabled })} />
                    <Label htmlFor={`model-on-${i}`} className="text-[12px] font-normal">{model.enabled ? 'On' : 'Off'}</Label>
                  </span>
                  <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => moveModel(i, -1)}><ArrowUp /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === form.models.length - 1} onClick={() => moveModel(i, 1)}><ArrowDown /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Remove model" disabled={form.models.length === 1} onClick={() => setForm({ ...form, models: form.models.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={form.models.length >= MAX_MODELS} onClick={() => setForm({ ...form, models: [...form.models, { id: '', enabled: true }] })}><Plus /> Add model</Button>
            <Button size="sm" variant="outline" disabled={m.checkModels.isPending} onClick={() => m.checkModels.mutate(form.models.map((x) => x.id), { onSuccess: (r) => setAvailability({ map: r.availability, at: r.checkedAt }) })}>
              {m.checkModels.isPending ? 'Checking…' : 'Check availability on OpenRouter'}
            </Button>
            {availability && <span className="text-[12px] text-muted-foreground">{availability.map ? `Checked ${formatDateTime(availability.at)}` : 'Could not reach the OpenRouter model list.'}</span>}
          </div>
          {availability?.map && Object.values(availability.map).some((v) => !v) && (
            <p role="status" className="text-[12px] text-warning">A model marked “Not listed” is not currently offered by OpenRouter. Turn it off or replace its id, otherwise every request falls through to the next model.</p>
          )}
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {num('temperature', 'Temperature', 0, 1.5, 0.05, 'Lower is more consistent')}
          {num('maxOutputTokens', 'Maximum output tokens', 200, 4000, 50)}
          {num('timeoutMs', 'Attempt timeout (ms)', 5000, 120000, 1000, 'Per model attempt')}
          {num('totalTimeoutMs', 'Whole request limit (ms)', 10000, 300000, 1000, 'Keep under 60000 unless nginx proxy_read_timeout is raised')}
          {num('dailyLimitPerMember', 'Requests per member per day', 1, 500)}
          {num('maxRegenerations', 'Regenerations per request', 0, 10)}
          {num('maxDocumentChars', 'Document context (characters)', 0, 50000, 500, 'Total from selected documents')}
        </div>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        <Button className="self-start" disabled={m.ai.isPending} onClick={save}>Save AI settings</Button>
      </div>
    </SectionCard>
  );
}

function AiLogsCard() {
  const [failedOnly, setFailedOnly] = React.useState(false);
  const logs = useAiLogs(true, failedOnly);
  const t = logs.data?.today;
  return (
    <SectionCard title="AI usage and error logs" description="Who asked for what, which model answered, fallbacks, timing and tokens. Prompts and member text are never stored."
      actions={<span className="flex items-center gap-1.5"><Switch id="logs-failed" checked={failedOnly} onCheckedChange={setFailedOnly} /><Label htmlFor="logs-failed" className="text-[12px]">Errors only</Label></span>}>
      {t && (
        <p className="mb-2 text-[12px] text-muted-foreground">Today (UTC): {t.requests} requests · {t.failed} failed · {t.fallbacks} used a fallback · {t.tokens.toLocaleString()} tokens</p>
      )}
      {logs.isLoading ? <Skeleton className="h-32" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left text-[12px]">
            <thead className="text-muted-foreground"><tr><th className="py-1 pr-2">When</th><th className="pr-2">Member</th><th className="pr-2">Action</th><th className="pr-2">Status</th><th className="pr-2">Model</th><th className="pr-2">Attempts</th><th className="pr-2">Time</th><th>Tokens</th></tr></thead>
            <tbody className="divide-y divide-border">
              {(logs.data?.logs ?? []).map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="py-1.5 pr-2 tabular">{formatDateTime(l.createdAt)}</td>
                  <td className="pr-2">{l.userName}</td>
                  <td className="pr-2">{l.action}</td>
                  <td className="pr-2"><Badge tone={l.status === 'success' ? 'success' : 'danger'}>{l.status === 'success' ? 'OK' : l.errorType || 'failed'}</Badge></td>
                  <td className="pr-2 font-mono">{l.model || '—'}{l.usedFallback && <Badge tone="warning" className="ml-1">fallback</Badge>}</td>
                  <td className="pr-2" title={l.attempts.map((a) => `${a.model}: ${a.outcome}${a.errorType ? ` ${a.errorType}` : ''}${a.httpStatus ? ` (${a.httpStatus})` : ''}`).join('\n')}>{l.attempts.length}</td>
                  <td className="pr-2 tabular">{(l.durationMs / 1000).toFixed(1)} s</td>
                  <td className="tabular">{l.totalTokens ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.data?.logs.length === 0 && <p className="py-4 text-center text-[12px] text-muted-foreground">No requests yet.</p>}
        </div>
      )}
    </SectionCard>
  );
}
