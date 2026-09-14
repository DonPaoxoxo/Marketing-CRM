import * as React from 'react';
import { AlertTriangle, Send, Save } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { ApiError } from '@/hooks/useData';
import {
  LIMITS, SPIEL_PLATFORMS, SUGGESTED_LANGUAGES, TARGET_COUNTRIES, firstIssue, spielInputSchema,
  type SpielDetail, type SpielInput, type SpielPlatform, type TargetCountry,
} from '@/lib/spiels';
import { useCategories, useCheckSimilar, useSaveSpiel } from './api';
import { AiAssistant } from './AiAssistant';
import { CharacterCount, PlatformPreview } from './bits';

const EMPTY: SpielInput = { title: '', categoryId: '', content: '', situation: '', targetCountry: 'India', language: 'English', platform: 'WhatsApp', campaignRef: '', tags: [] };

export function SpielEditor({ open, onOpenChange, spiel, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Editing this spiel's working version; omit to create. */
  spiel?: SpielDetail | null;
  onSaved?: (s: SpielDetail) => void;
}) {
  const categories = useCategories();
  const save = useSaveSpiel();
  const checkSimilar = useCheckSimilar();
  const [form, setForm] = React.useState<SpielInput>(EMPTY);
  const [tagsText, setTagsText] = React.useState('');
  const [errors, setErrors] = React.useState<Partial<Record<keyof SpielInput, string>>>({});
  const [duplicate, setDuplicate] = React.useState<{ message: string; id?: string } | null>(null);
  const [similar, setSimilar] = React.useState<{ id: string; title: string; score: number }[]>([]);
  const [showAi, setShowAi] = React.useState(true);

  React.useEffect(() => {
    if (!open) return;
    const v = spiel?.current;
    const next = v ? { title: v.title, categoryId: v.categoryId, content: v.content, situation: v.situation, targetCountry: v.targetCountry, language: v.language, platform: v.platform, campaignRef: v.campaignRef, tags: v.tags } : EMPTY;
    setForm(next);
    setTagsText(next.tags.join(', '));
    setErrors({});
    setDuplicate(null);
    setSimilar([]);
  }, [open, spiel]);

  const set = <K extends keyof SpielInput>(key: K, value: SpielInput[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    if (key === 'content') setDuplicate(null);
  };

  const runSimilar = () => {
    if (form.content.trim().length < 20) return;
    checkSimilar.mutate({ content: form.content, exceptId: spiel?.id }, { onSuccess: setSimilar });
  };

  const newVersion = Boolean(spiel?.approved && spiel.approved.id === spiel.current.id);
  const activeCategories = (categories.data ?? []).filter((c) => c.active || c.id === form.categoryId);
  const categoryName = activeCategories.find((c) => c.id === form.categoryId)?.name ?? '';

  const submit = async (asSubmit: boolean, allowDuplicate = false) => {
    const parsed = spielInputSchema.safeParse({ ...form, tags: tagsText });
    if (!parsed.success) {
      const issue = firstIssue(parsed.error);
      setErrors({ [issue.field]: issue.error });
      document.getElementById(`spiel-${issue.field}`)?.focus();
      return;
    }
    try {
      const saved = await save.mutateAsync({ ...parsed.data, id: spiel?.id, submit: asSubmit || newVersion, allowDuplicate });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.field === 'content') setDuplicate({ message: e.message, id: e.conflictId });
      else if (e instanceof ApiError && e.field) setErrors({ [e.field]: e.message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{spiel ? `Edit spiel — version ${newVersion ? spiel.current.versionNo + 1 : spiel.current.versionNo}` : 'New spiel'}</DialogTitle>
          <DialogDescription>
            {newVersion
              ? 'This spiel is approved. Saving creates a new version that goes to the System Administrator for approval; the approved version stays in the library until then.'
              : 'Save as a draft to keep working, or submit it for approval. Only approved spiels appear in the shared library.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submit(false); }} noValidate>
            <Field label="Title" htmlFor="spiel-title" required error={errors.title}>
              <Input value={form.title} maxLength={LIMITS.title} onChange={(e) => set('title', e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category" htmlFor="spiel-categoryId" required error={errors.categoryId}>
                <NativeSelect value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                  <option value="">Choose…</option>
                  {activeCategories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.active ? '' : ' (inactive)'}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Communication platform" htmlFor="spiel-platform" required error={errors.platform}>
                <NativeSelect value={form.platform} onChange={(e) => set('platform', e.target.value as SpielPlatform)}>
                  {SPIEL_PLATFORMS.map((p) => <option key={p}>{p}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Target country" htmlFor="spiel-targetCountry" required error={errors.targetCountry}>
                <NativeSelect value={form.targetCountry} onChange={(e) => set('targetCountry', e.target.value as TargetCountry)}>
                  {TARGET_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Language" htmlFor="spiel-language" required error={errors.language}>
                <Input list="spiel-languages" value={form.language} maxLength={LIMITS.language} onChange={(e) => set('language', e.target.value)} />
              </Field>
              <datalist id="spiel-languages">{SUGGESTED_LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
            </div>
            <Field label="Script" htmlFor="spiel-content" required error={errors.content}>
              <Textarea rows={8} value={form.content} maxLength={LIMITS.content} onChange={(e) => set('content', e.target.value)} onBlur={runSimilar}
                placeholder="Write the message exactly as it should be sent. Use **bold** for emphasis on WhatsApp and Telegram." />
            </Field>
            <CharacterCount text={form.content} platform={form.platform} />
            {duplicate && (
              <div role="alert" className="flex flex-col gap-2 rounded-md border border-danger/40 bg-danger-bg/50 p-2 text-[12px]">
                <span className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-danger" aria-hidden="true" />{duplicate.message}</span>
                <span className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => submit(false, true)}>Save draft anyway</Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => submit(true, true)}>Submit anyway</Button>
                </span>
              </div>
            )}
            {!duplicate && similar.length > 0 && (
              <div role="status" className="rounded-md border border-warning/40 bg-warning-bg/50 p-2 text-[12px]">
                <span className="flex gap-1.5 font-medium"><AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />Similar spiels already exist</span>
                <ul className="ml-5 list-disc">{similar.map((s) => <li key={s.id}>{s.title} <span className="text-muted-foreground">({s.id}, {Math.round(s.score * 100)}% similar)</span></li>)}</ul>
              </div>
            )}
            <Field label="Intended situation" htmlFor="spiel-situation" hint="When should the team use this spiel?" error={errors.situation}>
              <Textarea rows={2} value={form.situation} maxLength={LIMITS.situation} onChange={(e) => set('situation', e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Campaign or brand reference" htmlFor="spiel-campaignRef" hint="Optional" error={errors.campaignRef}>
                <Input value={form.campaignRef} maxLength={LIMITS.campaignRef} onChange={(e) => set('campaignRef', e.target.value)} />
              </Field>
              <Field label="Tags" htmlFor="spiel-tags" hint="Comma separated, up to 12" error={errors.tags}>
                <Input value={tagsText} onChange={(e) => { setTagsText(e.target.value); setErrors((x) => ({ ...x, tags: undefined })); }} />
              </Field>
            </div>
            {form.content.trim() && <PlatformPreview text={form.content} platform={form.platform} />}
          </form>

          <div className="flex flex-col gap-2">
            <Button type="button" size="sm" variant="ghost" className="self-end lg:hidden" onClick={() => setShowAi((v) => !v)}>{showAi ? 'Hide' : 'Show'} AI Assistant</Button>
            {showAi && (
              <AiAssistant
                text={form.content}
                onUse={(text) => set('content', text)}
                spielId={spiel?.id}
                compareTexts={spiel?.approved && spiel.approved.content !== form.content ? [spiel.approved.content] : []}
                context={{ country: form.targetCountry, language: form.language, platform: form.platform, category: categoryName, situation: form.situation }}
              />
            )}
          </div>
        </div>

        <DialogFooter className="sticky -bottom-5 z-10 -mx-5 -mb-5 gap-2 border-t border-border bg-surface px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {!newVersion && <Button variant="secondary" disabled={save.isPending} onClick={() => submit(false)}><Save /> Save draft</Button>}
          <Button disabled={save.isPending} onClick={() => submit(true)}><Send /> {newVersion ? 'Submit new version' : 'Submit for approval'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
