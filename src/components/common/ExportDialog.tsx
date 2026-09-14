/** Export to CSV, Excel or PDF, with the same rules everywhere.
 *
 *  - Needs the `export:data` permission.
 *  - The person picks the columns; secret-bearing columns never appear.
 *  - Contact details are masked unless deliberately included (and allowed).
 *  - Every export is written to the audit trail: what, how many rows, which
 *    columns and whether contact details were included — never the values. */

import * as React from 'react';
import { Download, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { Label, NativeSelect } from '@/components/ui/primitives';
import { useLogAudit } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { exportMatrix, isForbiddenColumn, toCSV, type ExportColumn } from '@/lib/csv';
import { downloadCSV } from '@/lib/download';
import { printTable } from '@/lib/print';
import { cn } from '@/lib/cn';
import type { ExportSource } from '@/components/layout/page-actions';

export type ExportFormat = 'csv' | 'excel' | 'pdf';
export const EXPORT_FORMATS: { value: ExportFormat; label: string; icon: typeof Download; hint: string }[] = [
  { value: 'csv', label: 'CSV', icon: FileText, hint: 'Plain text, opens in any spreadsheet.' },
  { value: 'excel', label: 'Excel', icon: FileSpreadsheet, hint: 'An .xlsx workbook with a header row.' },
  { value: 'pdf', label: 'PDF', icon: Printer, hint: 'Opens the print dialog — choose "Save as PDF".' },
];

/** PDF pages are printed by the browser; beyond this it becomes unusable. */
export const PDF_ROW_LIMIT = 2000;

const stamp = () => new Date().toISOString().slice(0, 10);

export async function downloadExcel(filename: string, sheetName: string, headers: string[], values: string[][]) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  const data = [
    headers.map((h) => ({ value: h, fontWeight: 'bold' as const, backgroundColor: '#EEF0F2' })),
    // `type: String` keeps every value a text cell: never a formula, and +91… stays intact.
    ...values.map((row) => row.map((v) => ({ value: v, type: String }))),
  ];
  await writeExcelFile([{ sheet: sheetName.slice(0, 31).replace(/[\\/?*[\]:]/g, ' ') || 'Export', data, stickyRowsCount: 1, columns: headers.map((h) => ({ width: Math.min(48, Math.max(12, h.length + 4)) })) }])
    .toFile(filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export function ExportDialog({ open, onOpenChange, sources, initialFormat = 'csv', initialSource = 0 }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sources: ExportSource[];
  initialFormat?: ExportFormat;
  initialSource?: number;
}) {
  const { can, showContactDetails: maySeeContact } = useSession();
  const logAudit = useLogAudit();
  const [format, setFormat] = React.useState<ExportFormat>(initialFormat);
  const [sourceIndex, setSourceIndex] = React.useState(initialSource);
  const source = sources[sourceIndex] ?? sources[0];
  const allowedColumns = (source?.columns ?? []).filter((c) => !isForbiddenColumn(c.key) && !isForbiddenColumn(c.header)) as ExportColumn<unknown>[];
  // Pages re-render often; the ticked columns reset only when the table itself changes.
  const sourceKey = source ? `${source.filename}|${source.label}|${allowedColumns.map((c) => c.key).join(',')}` : '';
  const columns = allowedColumns;
  const [selected, setSelected] = React.useState<string[]>([]);
  const [includeContact, setIncludeContact] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setFormat(initialFormat);
    setSourceIndex(initialSource < sources.length ? initialSource : 0);
    setIncludeContact(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { setSelected(columns.map((c) => c.key)); }, [sourceKey]);

  const rows = (source?.rows ?? []) as unknown[];
  const sensitive = columns.filter((c) => c.sensitive);
  const reason = !can('export:data') ? 'Your role cannot export data.' : !source ? 'There is nothing to export on this page.' : source.disabledReason;
  const tooManyForPdf = format === 'pdf' && rows.length > PDF_ROW_LIMIT;

  const run = async () => {
    if (!source || reason) return;
    const chosen = columns.filter((c) => selected.includes(c.key));
    if (!chosen.length) { toast.error('Select at least one column to export.'); return; }
    const withContact = includeContact && maySeeContact;
    const base = `${source.filename}-${stamp()}`;
    setBusy(true);
    try {
      if (format === 'csv') {
        downloadCSV(base, toCSV(rows, chosen, { includeContactDetails: withContact }));
      } else {
        const { headers, values } = exportMatrix(rows, chosen, { includeContactDetails: withContact });
        if (format === 'excel') {
          await downloadExcel(base, source.label, headers, values);
        } else {
          printTable({
            title: `${source.label} — ${stamp()}`,
            subtitle: `${values.length.toLocaleString()} row${values.length === 1 ? '' : 's'} · exported ${new Date().toLocaleString()}${withContact ? ' · includes contact details' : ' · contact details masked'}`,
            headers, values: values.slice(0, PDF_ROW_LIMIT),
            footnote: 'Internal — Marketing Resource CRM. Credential and recovery fields are never exported.',
          });
        }
      }
      onOpenChange(false);
      const label = EXPORT_FORMATS.find((f) => f.value === format)!.label;
      toast.success(format === 'pdf' ? 'Print dialog opened — choose "Save as PDF"' : `Exported ${rows.length.toLocaleString()} row${rows.length === 1 ? '' : 's'} to ${label}`, {
        description: withContact ? 'Includes contact details. This is recorded in the audit trail.' : 'Contact details are masked. Credential and recovery fields are never exportable.',
      });
      await logAudit({
        recordType: source.recordType, recordId: source.filename, recordLabel: `${source.filename} (${rows.length} rows)`,
        action: 'export', reason: `${label} export of filtered records`,
        changes: [
          { field: 'format', from: null, to: label },
          { field: 'columns', from: null, to: chosen.map((c) => c.header).join(', ') },
          { field: 'contactDetails', from: null, to: withContact ? 'included' : 'masked' },
        ],
      });
    } catch (e) {
      toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Export {source ? `${rows.length.toLocaleString()} record${rows.length === 1 ? '' : 's'}` : ''}</DialogTitle>
          <DialogDescription>
            Exports the records as they are filtered now. Passwords, tokens, recovery codes and vault secrets are never exportable and do not appear here.
          </DialogDescription>
        </DialogHeader>

        {reason && <p role="alert" className="rounded-md border border-warning/40 bg-warning-bg/50 px-3 py-2 text-[13px]">{reason}</p>}

        {sources.length > 1 && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="export-source">Table</Label>
            <NativeSelect id="export-source" value={String(sourceIndex)} onChange={(e) => setSourceIndex(Number(e.target.value))}>
              {sources.map((s, i) => <option key={`${s.filename}-${i}`} value={i}>{s.label} ({s.rows.length.toLocaleString()})</option>)}
            </NativeSelect>
          </div>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">Format</legend>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Export format">
            {EXPORT_FORMATS.map((f) => (
              <label key={f.value} className={cn('flex cursor-pointer flex-col gap-0.5 rounded-md border p-2 text-[12px]', format === f.value ? 'border-primary bg-accent/40' : 'border-border hover:bg-muted')}>
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  <input type="radio" name="export-format" value={f.value} checked={format === f.value} onChange={() => setFormat(f.value)} className="accent-[var(--primary)]" />
                  <f.icon className="size-3.5" aria-hidden="true" /> {f.label}
                </span>
                <span className="text-muted-foreground">{f.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {source && (
          <fieldset className="grid max-h-60 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
            <legend className="sr-only">Columns to export</legend>
            {columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-muted">
                <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--primary)]" checked={selected.includes(c.key)}
                  onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.key] : s.filter((k) => k !== c.key)))} />
                {c.header}
              </label>
            ))}
          </fieldset>
        )}

        {sensitive.length > 0 && (
          <label className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-bg/40 px-3 py-2 text-[12px]">
            <input type="checkbox" className="mt-0.5 h-3.5 w-3.5 accent-[var(--primary)]" checked={includeContact && maySeeContact} disabled={!maySeeContact} onChange={(e) => setIncludeContact(e.target.checked)} />
            <span>
              <span className="font-semibold">Include contact details</span> ({sensitive.map((c) => c.header).join(', ')}).
              {maySeeContact ? ' Off by default. Including them is recorded in the audit trail.' : ' Reveal contact details in the header first — they are masked for you right now.'}
            </span>
          </label>
        )}
        {tooManyForPdf && <p className="text-[12px] text-warning">PDF includes the first {PDF_ROW_LIMIT.toLocaleString()} rows. Use CSV or Excel for everything.</p>}

        <DialogFooter>
          <Button variant="ghost" onClick={() => setSelected(columns.map((c) => c.key))} disabled={!source}>Select all</Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={run} disabled={Boolean(reason) || busy}><Download /> {busy ? 'Exporting…' : `Export ${EXPORT_FORMATS.find((f) => f.value === format)!.label}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
