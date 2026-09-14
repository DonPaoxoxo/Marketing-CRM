import * as React from 'react';
import { Copy, History, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Input, Label } from '@/components/ui/primitives';
import { ConfirmWithReason } from '@/components/common/controls';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { AI_ACTIONS, TIER_LABEL, type AiHistoryItem } from '@/lib/spiel-ai';
import { formatDateTime } from '@/lib/utils';
import { copyText, useAiHistory, useAiHistoryMutations } from './api';

/** The signed-in member's own AI suggestions. Nobody else's are ever listed. */
export function AiHistory({ onReuse, compact }: { onReuse: (item: AiHistoryItem) => void; compact?: boolean }) {
  const history = useAiHistory();
  const { remove, clear } = useAiHistoryMutations();
  const [search, setSearch] = React.useState('');
  const [removing, setRemoving] = React.useState<AiHistoryItem | null>(null);
  const [clearing, setClearing] = React.useState(false);
  const items = history.data?.items ?? [];
  const q = search.trim().toLowerCase();
  const shown = q ? items.filter((i) => `${i.inputText} ${i.suggestion.improved_text} ${AI_ACTIONS[i.action]?.label}`.toLowerCase().includes(q)) : items;

  return (
    <details className="rounded-md border border-border px-2 py-1.5 text-[12px]" open={!compact}>
      <summary className="flex cursor-pointer select-none items-center gap-1.5 font-medium">
        <History className="size-3.5" aria-hidden="true" /> My AI history{history.data ? ` (${history.data.total})` : ''}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        <p className="text-[11px] text-muted-foreground">
          Only you can see your history. Your latest 200 suggestions are kept; phone numbers and emails appear as placeholders.
        </p>
        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="ai-history-search" className="sr-only">Search AI history</Label>
            <Input id="ai-history-search" className="h-8 min-w-[10rem] flex-1" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your history…" />
            <Button size="sm" variant="ghost" className="text-danger" onClick={() => setClearing(true)}><Trash2 /> Clear all</Button>
          </div>
        )}
        {history.isLoading ? <p className="text-muted-foreground">Loading…</p>
          : history.error ? <p className="text-danger">{history.error.message}</p>
            : shown.length === 0 ? <p className="text-muted-foreground">{items.length ? 'Nothing matches your search.' : 'No suggestions yet. Your successful AI requests will appear here.'}</p>
              : (
                <ul className={compact ? 'flex max-h-72 flex-col gap-2 overflow-y-auto' : 'flex max-h-[32rem] flex-col gap-2 overflow-y-auto'} aria-label="AI history">
                  {shown.map((item) => (
                    <li key={item.id} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-2">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="accent">{AI_ACTIONS[item.action]?.label ?? item.action}</Badge>
                          <Badge tone={item.tier === 'fallback' ? 'warning' : 'info'} title={item.model}>{item.tier === 'main' ? `${TIER_LABEL.main} ${item.modelPosition}` : TIER_LABEL[item.tier]}</Badge>
                          <span className="text-[11px] text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Button size="sm" variant="ghost" onClick={() => onReuse(item)} aria-label={`Reuse suggestion from ${formatDateTime(item.createdAt)}`}><RotateCcw /> Reuse</Button>
                          <Button size="icon-sm" variant="ghost" aria-label="Copy suggestion"
                            onClick={async () => { if (await copyText(item.suggestion.improved_text || item.suggestion.corrected_text)) toast.success('Suggestion copied to clipboard'); }}><Copy /></Button>
                          <Button size="icon-sm" variant="ghost" className="text-danger" aria-label={`Remove history entry from ${formatDateTime(item.createdAt)}`} onClick={() => setRemoving(item)}><Trash2 /></Button>
                        </span>
                      </div>
                      <p className="line-clamp-2 text-muted-foreground"><span className="font-medium text-foreground">You: </span>{item.inputText}</p>
                      <p className="line-clamp-3"><span className="font-medium">AI: </span>{item.suggestion.improved_text || item.suggestion.corrected_text || item.suggestion.situation_advice}</p>
                      {(item.context.situation || item.documentCount > 0) && (
                        <p className="text-[11px] text-muted-foreground">{[item.context.situation && `Situation: ${item.context.situation}`, item.documentCount > 0 && `${item.documentCount} reference document(s)`].filter(Boolean).join(' · ')}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
      </div>

      <Dialog open={Boolean(removing)} onOpenChange={(v) => !v && setRemoving(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Remove this suggestion from your history?</DialogTitle>
            <DialogDescription>It is deleted from your AI history. Spiels you already saved are not affected.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}><Trash2 /> Remove</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmWithReason
        open={clearing}
        onOpenChange={setClearing}
        title="Clear all of your AI history?"
        description="Every saved suggestion in your history is deleted. Spiels you already saved are not affected."
        confirmLabel="Clear history"
        placeholder="Why are you clearing your history? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={async (reason) => { await clear.mutateAsync(reason); setClearing(false); }}
      />
    </details>
  );
}
