/** Paste many domain URLs at once, one per line — see src/lib/domain-monitor-import.ts
 *  for why this is a plain textarea rather than a CSV/sheet upload. Category and
 *  notes are chosen once for the whole paste, same reasoning as every other
 *  bulk-add flow in this app. */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Field, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useCrmData } from '@/hooks/useData';
import { splitDomainLines, validateDomainLines } from '@/lib/domain-monitor-import';
import { DOMAIN_MONITOR_TYPE, type DomainMonitorType } from '@/lib/types';
import { useBulkAddDomainMonitors, type BulkAddResult } from './api';

type Stage = { kind: 'paste' } | { kind: 'done'; result: BulkAddResult };

export function DomainBulkAddDialog({
  open, onOpenChange, domainType: initialType,
}: { open: boolean; onOpenChange: (v: boolean) => void; domainType: DomainMonitorType }) {
  const { data } = useCrmData();
  const bulkAdd = useBulkAddDomainMonitors();

  const [stage, setStage] = React.useState<Stage>({ kind: 'paste' });
  const [domainType, setDomainType] = React.useState<DomainMonitorType>(initialType);
  const [text, setText] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (open) { setStage({ kind: 'paste' }); setDomainType(initialType); setText(''); setNotes(''); }
  }, [open, initialType]);

  // Scoped to the chosen category — the same domain may already exist as the
  // other category without conflicting (uniqueness is per domain type).
  const existing = React.useMemo(
    () => new Set((data?.domainMonitors ?? []).filter((d) => d.domainType === domainType).map((d) => d.domainName)),
    [data, domainType],
  );
  const lines = React.useMemo(() => splitDomainLines(text), [text]);
  const preview = React.useMemo(() => validateDomainLines(lines, existing), [lines, existing]);
  const validCount = preview.filter((p) => p.domainName).length;
  const problemCount = preview.length - validCount;

  const submit = async () => {
    const result = await bulkAdd.mutateAsync({ domainType, lines, notes, reason: `${domainType} Domains bulk add` });
    setStage({ kind: 'done', result });
  };

  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {stage.kind === 'paste' && (
          <>
            <DialogHeader>
              <DialogTitle>Bulk add domains</DialogTitle>
              <DialogDescription>
                Paste one domain URL per line. A domain already in the register, or repeated in the list, is skipped
                and listed — never overwritten.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category" htmlFor="dm-bulk-type" required>
                  <NativeSelect id="dm-bulk-type" value={domainType} onChange={(e) => setDomainType(e.target.value as DomainMonitorType)}>
                    {DOMAIN_MONITOR_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
                  </NativeSelect>
                </Field>
                <Field label="Notes" htmlFor="dm-bulk-notes" hint="Applied to every domain added.">
                  <Textarea id="dm-bulk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={1} />
                </Field>
              </div>

              <Field label="Domain URLs" htmlFor="dm-bulk-text" required hint="One per line.">
                <Textarea
                  id="dm-bulk-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  spellCheck={false}
                  placeholder={'example1.com\nexample2.com\nexample3.com'}
                  className="font-mono text-[12px]"
                />
              </Field>

              {lines.length > 0 && (
                <div className="rounded-md border border-border p-3 text-[13px]">
                  <p>
                    <span className="font-medium text-foreground">{validCount}</span> will be added
                    {problemCount > 0 && <> · <span className="font-medium text-destructive">{problemCount}</span> skipped</>}
                    {' '}of {lines.length} line{lines.length === 1 ? '' : 's'}
                  </p>
                  {problemCount > 0 && (
                    <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5 text-muted-foreground">
                      {preview.filter((p) => p.problem).slice(0, 50).map((p) => (
                        <li key={p.line}>Line {p.line} — {p.raw || '(blank)'}: {p.problem}</li>
                      ))}
                      {problemCount > 50 && <li>…and {problemCount - 50} more</li>}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>Cancel</Button>
              <Button type="button" disabled={validCount === 0 || bulkAdd.isPending} onClick={submit}>
                {bulkAdd.isPending ? 'Adding…' : `Add ${validCount} domain${validCount === 1 ? '' : 's'}`}
              </Button>
            </DialogFooter>
          </>
        )}

        {stage.kind === 'done' && (
          <>
            <DialogHeader>
              <DialogTitle>Bulk add complete</DialogTitle>
              <DialogDescription>
                {stage.result.created} domain{stage.result.created === 1 ? '' : 's'} added
                {stage.result.skipped > 0 && `, ${stage.result.skipped} skipped`}.
              </DialogDescription>
            </DialogHeader>

            {stage.result.problems.length > 0 && (
              <div className="rounded-md border border-border p-3 text-[13px]">
                <p className="font-medium text-foreground">Skipped lines</p>
                <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-muted-foreground">
                  {stage.result.problems.map((p) => <li key={p.line}>Line {p.line}: {p.reason}</li>)}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button type="button" onClick={close}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
