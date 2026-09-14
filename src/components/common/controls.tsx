import * as React from 'react';
import { Download, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/overlays';
import type { ExportColumn } from '@/lib/csv';
import { ExportDialog } from './ExportDialog';
import { useRegisterExport, useRegisterFilters } from '@/components/layout/page-actions';
import { useSession } from '@/hooks/useSession';
import { cn } from '@/lib/cn';

/* ── Search box ───────────────────────────────────────────────── */

export function SearchInput({
  value, onChange, placeholder = 'Search…', className, id = 'table-search', label = 'Search records',
}: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; id?: string; label?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Label htmlFor={id} className="sr-only">{label}</Label>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8 pr-8"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ── Labelled filter select ───────────────────────────────────── */

export function FilterSelect({
  id, label, value, onChange, options, className,
}: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; className?: string;
}) {
  return (
    <div className={cn('flex min-w-[9.5rem] flex-col gap-1', className)}>
      <Label htmlFor={id} className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </NativeSelect>
    </div>
  );
}

export function FilterBar({ children, onClear, activeCount }: { children: React.ReactNode; onClear: () => void; activeCount: number }) {
  const ref = React.useRef<HTMLDivElement>(null);
  // The global toolbar's Filter and Clear filters act on this bar.
  useRegisterFilters({ clear: onClear, activeCount, elementRef: ref });
  return (
    <div ref={ref} data-filter-bar="" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-3">
      {children}
      <Button variant="ghost" size="sm" onClick={onClear} disabled={activeCount === 0} className="mb-px">
        <X /> Clear filters{activeCount > 0 ? ` (${activeCount})` : ''}
      </Button>
    </div>
  );
}

/* ── Export with format and column picker ─────────────────────── */

/** The page's export button. It also registers the rows with the global toolbar,
 *  so Export CSV / Excel / PDF there work on the same records. */
export function ExportButton<T>({
  rows, columns, filename, recordType, disabledReason, label,
}: {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  recordType: string;
  disabledReason?: string;
  /** Shown in the toolbar when a page has more than one table. */
  label?: string;
}) {
  const { can } = useSession();
  const [open, setOpen] = React.useState(false);
  const source = {
    label: label ?? filename.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()),
    filename, recordType, disabledReason,
    rows: rows as unknown[], columns: columns as unknown as ExportColumn<never>[],
  };
  useRegisterExport(source);
  const reason = !can('export:data') ? 'Your role cannot export data.' : disabledReason;

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={Boolean(reason)} title={reason}>
        <Download /> Export
      </Button>
      {open && <ExportDialog open={open} onOpenChange={setOpen} sources={[source]} />}
    </>
  );
}

/* ── Destructive confirmation with a written reason ───────────── */

export function ConfirmWithReason({
  open, onOpenChange, title, description, confirmLabel = 'Archive record', onConfirm, danger = true,
  placeholder = 'Explain why this record is being archived. This is written to the audit trail.',
  hint = 'At least 10 characters. Records are archived, never deleted.',
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => unknown | Promise<unknown>;
  danger?: boolean;
  /** Defaults describe archiving a record; override for other destructive actions. */
  placeholder?: string;
  hint?: string;
}) {
  const [reason, setReason] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const valid = reason.trim().length >= 10;

  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm-reason">
            Reason <span className="text-danger" aria-hidden="true">*</span>
          </Label>
          <Textarea
            id="confirm-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={placeholder}
            aria-describedby="confirm-reason-hint"
          />
          <p id="confirm-reason-hint" className="text-[12px] text-muted-foreground">
            {hint}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'default'}
            disabled={!valid || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(reason.trim());
                onOpenChange(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
