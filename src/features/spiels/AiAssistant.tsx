import * as React from 'react';
import { AlertTriangle, Check, RefreshCw, Sparkles, X } from 'lucide-react';
import { AiHistory } from './AiHistory';
import { Button } from '@/components/ui/button';
import { Badge, Checkbox, Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { AI_ACTIONS, AI_ACTION_IDS, AI_NOTICE, AI_TEXT_MAX, AI_TONES, PRIMARY_AI_ACTIONS, TIER_LABEL, type AiAction, type AiAssistResult, type AiHistoryItem } from '@/lib/spiel-ai';
import { SPIEL_PLATFORMS, SUGGESTED_LANGUAGES, TARGET_COUNTRIES } from '@/lib/spiels';
import { cn } from '@/lib/cn';
import { AiError, copyText, useAiStatus, useAssist, useCategories, useDocuments } from './api';
import { toast } from 'sonner';

export interface AiContext { country: string; language: string; platform: string; category: string; situation: string }

export const AI_DESCRIPTION = 'Improve your spiel, understand the situation, and create better communication drafts before submitting them for approval.';

/** The assistant. With `text` + `onUse` it works on the editor's script; without, it has its own text box. */
export function AiAssistant({ text: externalText, onUse, context, spielId, compareTexts = [], className }: {
  text?: string;
  onUse?: (text: string) => void;
  context?: Partial<AiContext>;
  spielId?: string | null;
  compareTexts?: string[];
  className?: string;
}) {
  const status = useAiStatus();
  const categories = useCategories();
  const documents = useDocuments();
  const assist = useAssist();
  const [ownText, setOwnText] = React.useState('');
  const text = externalText ?? ownText;
  const [opts, setOpts] = React.useState({ country: '', language: '', targetLanguage: 'Indonesian', platform: '', category: '', situation: '', tone: '' });
  React.useEffect(() => {
    // Follow the editor's fields until the member changes them here.
    if (context) setOpts((o) => ({ ...o, ...Object.fromEntries(Object.entries(context).filter(([, v]) => v)) }));
  }, [context?.country, context?.language, context?.platform, context?.category, context?.situation]); // eslint-disable-line react-hooks/exhaustive-deps
  const [docIds, setDocIds] = React.useState<string[]>([]);
  const [more, setMore] = React.useState<AiAction>('persuasive');
  const [result, setResult] = React.useState<AiAssistResult | null>(null);
  const [draft, setDraft] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [lastAction, setLastAction] = React.useState<AiAction | null>(null);

  const approvedDocs = (documents.data ?? []).filter((d) => d.approved && d.status !== 'Archived');
  const s = status.data;
  const unavailable = s && (!s.enabled ? 'The AI Assistant Learner is turned off by the System Administrator.' : !s.configured ? 'The AI Assistant is not configured on this server yet (OPENROUTER_API_KEY).' : !s.mayUse ? 'Your role cannot use the AI Assistant.' : null);

  const run = async (action: AiAction, regenerate = false) => {
    setError(null);
    if (!text.trim()) { setError('Write or paste some text first.'); return; }
    if (action === 'explain' && !result && !regenerate) {
      setError('Get a suggestion first, then use Explain Changes to see why it differs from your text.');
      return;
    }
    const sourceText = action === 'explain' && result ? `ORIGINAL:\n${text}\n\nSUGGESTED:\n${draft || result.suggestion.improved_text}` : text;
    setLastAction(action);
    try {
      const r = await assist.mutateAsync({
        action, text: sourceText.slice(0, AI_TEXT_MAX), ...opts, documentIds: docIds, spielId: spielId ?? null,
        compareTexts: action === 'compare' ? compareTexts : [],
        regenerateOf: regenerate && result ? result.requestId : null,
      });
      setResult(r);
      setDraft(r.suggestion.improved_text || r.suggestion.corrected_text);
    } catch (e) {
      // The member's text lives in their own field and is never touched on failure.
      setError(e instanceof AiError ? `${e.message}` : (e as Error).message);
    }
  };

  /** Bring a past suggestion back: its settings, its text (own text box only) and the suggestion to use or edit. */
  const reuse = (item: AiHistoryItem) => {
    setError(null);
    setOpts((o) => ({ ...o, ...Object.fromEntries(Object.entries(item.context).filter(([, v]) => v)) }));
    if (externalText === undefined) setOwnText(item.inputText);
    setLastAction(item.action);
    setResult({
      requestId: item.id, original: item.inputText, suggestion: item.suggestion, model: item.model, usedFallback: item.modelPosition > 1,
      modelPosition: item.modelPosition, tier: item.tier, attempts: [], redactions: 0, documentsUsed: [], regenerationsLeft: 0, requestsLeftToday: -1,
    });
    setDraft(item.suggestion.improved_text || item.suggestion.corrected_text);
    toast.success('Past suggestion loaded. Review it before using it.');
  };

  const busy = assist.isPending;
  return (
    <section aria-labelledby="ai-assistant-title" className={cn('flex flex-col gap-3 rounded-lg border border-border bg-surface p-3', className)}>
      <header className="flex flex-col gap-1">
        <h3 id="ai-assistant-title" className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-primary" aria-hidden="true" /> AI Assistant Learner</h3>
        <p className="text-[12px] text-muted-foreground">{AI_DESCRIPTION}</p>
        <p role="note" className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning-bg/50 px-2 py-1.5 text-[12px]">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" /> {AI_NOTICE}
        </p>
        {s && !unavailable && (
          <p className="text-[11px] text-muted-foreground">
            {s.requestsLeftToday === null ? 'No daily limit for the System Owner.' : `${s.requestsLeftToday} requests left today.`} Phone numbers, emails and secrets are removed before text is sent.
          </p>
        )}
        {unavailable && <p className="text-[12px] font-medium text-danger">{unavailable}</p>}
      </header>

      {externalText === undefined && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="ai-own-text">Text to work on</Label>
          <Textarea id="ai-own-text" rows={5} value={ownText} maxLength={AI_TEXT_MAX} onChange={(e) => setOwnText(e.target.value)} placeholder="Paste a spiel, a message you received, or a draft reply…" />
        </div>
      )}

      <details className="rounded-md border border-border px-2 py-1.5 text-[12px]" open={externalText === undefined}>
        <summary className="cursor-pointer select-none font-medium">Situation, tone and references</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Select id="ai-country" label="Country" value={opts.country} onChange={(country) => setOpts({ ...opts, country })} options={TARGET_COUNTRIES} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-language" className="text-[11px]">Language</Label>
            <Input id="ai-language" list="ai-languages" value={opts.language} onChange={(e) => setOpts({ ...opts, language: e.target.value })} />
          </div>
          <Select id="ai-platform" label="Platform" value={opts.platform} onChange={(platform) => setOpts({ ...opts, platform })} options={SPIEL_PLATFORMS} />
          <Select id="ai-category" label="Category" value={opts.category} onChange={(category) => setOpts({ ...opts, category })} options={(categories.data ?? []).map((c) => c.name)} />
          <Select id="ai-tone" label="Tone" value={opts.tone} onChange={(tone) => setOpts({ ...opts, tone })} options={AI_TONES} />
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-target" className="text-[11px]">Translate into</Label>
            <Input id="ai-target" list="ai-languages" value={opts.targetLanguage} onChange={(e) => setOpts({ ...opts, targetLanguage: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="ai-situation" className="text-[11px]">Situation</Label>
            <Input id="ai-situation" value={opts.situation} maxLength={1000} onChange={(e) => setOpts({ ...opts, situation: e.target.value })} placeholder="e.g. The agent says our commission is too low" />
          </div>
          <datalist id="ai-languages">{SUGGESTED_LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
          <fieldset className="sm:col-span-2">
            <legend className="text-[11px] font-medium">Approved reference documents <span className="font-normal text-muted-foreground">(up to 5)</span></legend>
            {approvedDocs.length === 0 ? <p className="text-[11px] text-muted-foreground">No approved documents yet.</p> : (
              <ul className="mt-1 flex max-h-28 flex-col gap-1 overflow-y-auto">
                {approvedDocs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <Checkbox id={`ai-doc-${d.id}`} checked={docIds.includes(d.id)} disabled={!docIds.includes(d.id) && docIds.length >= 5}
                      onCheckedChange={(v) => setDocIds((ids) => (v ? [...ids, d.id] : ids.filter((x) => x !== d.id)))} />
                    <Label htmlFor={`ai-doc-${d.id}`} className="text-[12px] font-normal">{d.title}{d.outdated ? ' (may be outdated)' : ''}</Label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </div>
      </details>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="AI actions">
        {PRIMARY_AI_ACTIONS.map((a) => (
          <Button key={a} size="sm" variant={a === 'improve' ? 'default' : 'outline'} disabled={busy || Boolean(unavailable)} onClick={() => run(a)}>
            {AI_ACTIONS[a].label}
          </Button>
        ))}
        <span className="inline-flex items-center gap-1">
          <Label htmlFor="ai-more" className="sr-only">More AI actions</Label>
          <NativeSelect id="ai-more" className="h-8 w-auto text-[13px]" value={more} onChange={(e) => setMore(e.target.value as AiAction)}>
            {AI_ACTION_IDS.filter((a) => !PRIMARY_AI_ACTIONS.includes(a) && (a !== 'compare' || compareTexts.length)).map((a) => <option key={a} value={a}>{AI_ACTIONS[a].label}</option>)}
          </NativeSelect>
          <Button size="sm" variant="outline" disabled={busy || Boolean(unavailable)} onClick={() => run(more)}>Run</Button>
        </span>
        <Button size="sm" variant="ghost" disabled={busy || !result || !lastAction || result.regenerationsLeft <= 0} onClick={() => lastAction && run(lastAction, true)}
          title={result ? `${result.regenerationsLeft} regenerations left` : undefined}>
          <RefreshCw /> Regenerate
        </Button>
      </div>

      {busy && <p className="text-[12px] text-muted-foreground" aria-live="polite">Asking the AI… this can take up to a minute if a fallback model is needed.</p>}
      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg/50 px-2 py-1.5 text-[12px] text-danger">{error} Your original text is unchanged.</p>}

      {result && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/30 bg-surface-2 p-2.5" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] font-semibold">Suggestion — {AI_ACTIONS[lastAction ?? 'improve'].label}</span>
            <span className="flex flex-wrap items-center gap-1">
              <Badge tone={result.tier === 'fallback' ? 'warning' : 'info'} title={result.attempts.map((a) => `${a.model}: ${a.outcome}${a.errorType ? ` (${a.errorType})` : ''}`).join('\n')}>
                {result.tier === 'main' ? `${TIER_LABEL.main} ${result.modelPosition}` : TIER_LABEL[result.tier]}: {result.model}
              </Badge>
              {result.redactions > 0 && <Badge tone="neutral">{result.redactions} private detail(s) removed</Badge>}
            </span>
          </div>
          {externalText !== undefined && (
            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted-foreground">Your original text (unchanged)</summary>
              <p className="mt-1 whitespace-pre-wrap rounded border border-border bg-surface p-2">{result.original}</p>
            </details>
          )}
          <Label htmlFor="ai-suggestion" className="text-[11px]">Suggested text — edit before using</Label>
          <Textarea id="ai-suggestion" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
          {result.suggestion.corrected_text && result.suggestion.corrected_text !== draft && (
            <p className="text-[12px]"><span className="font-medium">Corrected: </span><span className="whitespace-pre-wrap">{result.suggestion.corrected_text}</span></p>
          )}
          {result.suggestion.alternative_versions.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium">Alternatives</span>
              {result.suggestion.alternative_versions.map((alt, i) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded border border-border bg-surface p-2 text-[12px]">
                  <span className="whitespace-pre-wrap">{alt}</span>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(alt)}>Choose</Button>
                </div>
              ))}
            </div>
          )}
          {result.suggestion.changes_made.length > 0 && (
            <div className="text-[12px]"><span className="font-medium">What changed</span>
              <ul className="ml-4 list-disc">{result.suggestion.changes_made.map((c, i) => <li key={i}>{c}</li>)}</ul>
            </div>
          )}
          {result.suggestion.situation_advice && <p className="text-[12px]"><span className="font-medium">Advice: </span>{result.suggestion.situation_advice}</p>}
          <p className="text-[11px] text-muted-foreground">
            {[result.suggestion.tone && `Tone: ${result.suggestion.tone}`, result.suggestion.language && `Language: ${result.suggestion.language}`, result.suggestion.recommended_category && `Suggested category: ${result.suggestion.recommended_category}`].filter(Boolean).join(' · ')}
            {result.documentsUsed.length > 0 && ` · References: ${result.documentsUsed.map((d) => d.title).join(', ')}`}
          </p>
          {result.suggestion.warnings.length > 0 && (
            <ul className="flex flex-col gap-1 text-[12px] text-warning">{result.suggestion.warnings.map((w, i) => <li key={i} className="flex gap-1"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />{w}</li>)}</ul>
          )}
          <div className="flex flex-wrap gap-2">
            {onUse && <Button size="sm" disabled={!draft.trim()} onClick={() => { onUse(draft); toast.success('Suggestion placed in your script. Review it before submitting.'); }}><Check /> Use this suggestion</Button>}
            <Button size="sm" variant="outline" disabled={!draft.trim()} onClick={async () => { if (await copyText(draft)) toast.success('Suggestion copied to clipboard'); }}>Copy</Button>
            <Button size="sm" variant="ghost" onClick={() => { setResult(null); setDraft(''); }}><X /> Reject suggestion</Button>
          </div>
        </div>
      )}

      <AiHistory onReuse={reuse} compact={externalText !== undefined} />
    </section>
  );
}

function Select({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-[11px]">{label}</Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </NativeSelect>
    </div>
  );
}
