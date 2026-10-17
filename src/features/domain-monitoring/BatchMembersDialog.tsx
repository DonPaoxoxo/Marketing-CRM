/** Replaces a batch's membership in one step. Only Invite Domains that are not
 *  archived are eligible, and a domain already in another batch is shown as
 *  taken rather than hidden — picking it here moves it, which is exactly what
 *  the server does (see server/routes/domain-monitoring/batches.ts). */

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Input } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useCrmData } from '@/hooks/useData';
import { displayUrl } from '@/lib/utils';
import type { RotationBatchRecord } from '@/lib/types';
import { useReplaceBatchMembers } from './api';

export function BatchMembersDialog({
  open, onOpenChange, batch,
}: { open: boolean; onOpenChange: (v: boolean) => void; batch?: RotationBatchRecord }) {
  const { data } = useCrmData();
  const replace = useReplaceBatchMembers();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState('');

  const currentMemberIds = React.useMemo(
    () => new Set((data?.rotationBatchMembers ?? []).filter((m) => m.rotationBatchId === batch?.id).map((m) => m.domainMonitorId)),
    [data, batch],
  );
  const otherBatchOf = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const m of data?.rotationBatchMembers ?? []) {
      if (m.rotationBatchId === batch?.id) continue;
      const b = data?.rotationBatches.find((x) => x.id === m.rotationBatchId);
      if (b) map.set(m.domainMonitorId, b.name);
    }
    return map;
  }, [data, batch]);

  React.useEffect(() => { if (open) setSelected(new Set(currentMemberIds)); }, [open, currentMemberIds]);

  const candidates = (data?.domainMonitors ?? [])
    .filter((d) => d.domainType === 'Invite' && !d.archived)
    .filter((d) => !search.trim() || d.domainName.toLowerCase().includes(search.trim().toLowerCase()));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    if (!batch) return;
    await replace.mutateAsync({ id: batch.id, domainMonitorIds: [...selected] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Members — {batch?.name}</DialogTitle>
          <DialogDescription>
            Choose which Invite Domains belong to this batch. A domain picked here leaves whichever batch it is
            currently in.
          </DialogDescription>
        </DialogHeader>

        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search domains…" aria-label="Search domains" />

        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {candidates.length === 0 && <p className="p-3 text-[13px] text-muted-foreground">No Invite Domains match.</p>}
          {candidates.map((d) => {
            const movingFrom = otherBatchOf.get(d.id);
            return (
              <label key={d.id} className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-[13px] last:border-0 hover:bg-muted">
                <span className="flex items-center gap-2">
                  <Checkbox checked={selected.has(d.id)} onCheckedChange={() => toggle(d.id)} aria-label={`Include ${d.domainName}`} />
                  {displayUrl(d.domainName)}
                </span>
                {movingFrom && selected.has(d.id) && <span className="text-[12px] text-warning">Moves from {movingFrom}</span>}
              </label>
            );
          })}
        </div>

        <p className="text-[12px] text-muted-foreground">{selected.size} domain{selected.size === 1 ? '' : 's'} selected.</p>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={replace.isPending} onClick={submit}>{replace.isPending ? 'Saving…' : 'Save members'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
