import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { ApiError, useSetSalaryStatus } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { SALARY_NOTE_MAX, maySetSalaryStatus, salaryLabel } from '@/lib/salary';
import { formatDate } from '@/lib/utils';
import type { Agent } from '@/lib/types';

const TONE = { Hold: 'warning', Advance: 'success', Customize: 'info' } as const;

/** Salary status badge. The System Administrator gets a menu; Customize asks for the text. */
export function SalaryStatusControl({ agent }: { agent: Agent }) {
  const { role } = useSession();
  const mayEdit = maySetSalaryStatus(role);
  const save = useSetSalaryStatus();
  const [customOpen, setCustomOpen] = React.useState(false);
  const label = salaryLabel(agent);
  const detail = agent.salaryStatus
    ? `${label} — set by ${agent.salaryUpdatedByName || '—'}${agent.salaryUpdatedAt ? ` on ${formatDate(agent.salaryUpdatedAt.slice(0, 10))}` : ''}`
    : 'No salary status yet';
  const badge = (
    <Badge tone={agent.salaryStatus ? TONE[agent.salaryStatus] : 'neutral'} className="max-w-[11rem] truncate">{label}</Badge>
  );

  if (!mayEdit) return <span title={detail}>{badge}</span>;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" title={detail} aria-label={`Salary status for ${agent.name}: ${label}`}
            className="inline-flex max-w-full items-center gap-0.5 rounded-full focus-visible:outline-2 focus-visible:outline-ring">
            {badge}<ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem disabled={agent.salaryStatus === 'Hold'} onSelect={() => save.mutate({ id: agent.id, status: 'Hold' })}>Hold</DropdownMenuItem>
          <DropdownMenuItem disabled={agent.salaryStatus === 'Advance'} onSelect={() => save.mutate({ id: agent.id, status: 'Advance' })}>Advance</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCustomOpen(true)}>Customize…</DropdownMenuItem>
          {agent.salaryStatus && <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => save.mutate({ id: agent.id, status: null })}>Clear</DropdownMenuItem>
          </>}
        </DropdownMenuContent>
      </DropdownMenu>
      {customOpen && <CustomSalaryDialog agent={agent} onClose={() => setCustomOpen(false)} />}
    </>
  );
}

function CustomSalaryDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const save = useSetSalaryStatus();
  const [note, setNote] = React.useState(agent.salaryStatus === 'Customize' ? agent.salaryNote : '');
  const [error, setError] = React.useState<string>();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await save.mutateAsync({ id: agent.id, status: 'Customize', note });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message);
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="sm">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Custom salary status</DialogTitle>
            <DialogDescription>For {agent.name}. Type the status the team should see.</DialogDescription>
          </DialogHeader>
          <Field label="Salary status" htmlFor="salary-note" required error={error} hint={`${note.trim().length}/${SALARY_NOTE_MAX} — for example "50% paid, rest on Friday"`}>
            <Input value={note} maxLength={SALARY_NOTE_MAX} autoFocus onChange={(e) => { setNote(e.target.value); setError(undefined); }} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={save.isPending || note.trim().length < 2}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
