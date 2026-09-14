import * as React from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Label, NativeSelect } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { useCrmData } from '@/hooks/useData';
import { IMPORT_LIMITS } from '@/lib/ads/import';
import { previewImport, useCommitImport, type ImportPreview, type ImportResult } from './api';

const ACTION_LABEL: Record<string, { label: string; tone: React.ComponentProps<typeof Badge>['tone'] }> = {
  'create-campaign': { label: 'New campaign + record', tone: 'success' },
  'create-entry': { label: 'New record', tone: 'success' },
  'update-entry': { label: 'Update record', tone: 'warning' },
  skip: { label: 'Skip', tone: 'neutral' },
  reject: { label: 'Rejected', tone: 'danger' },
};

/** CSV of every row with an error or warning, built in the browser. */
export function downloadErrorReport(rows: { rowNumber?: number; row?: number; reference: string; reportDate: string; action: string; errors: string[]; warnings: string[] }[], name: string) {
  const escape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  // Cells that start with = + - @ are neutralised so the report cannot run as a formula.
  const safe = (v: string) => escape(/^[=+\-@]/.test(v) ? `'${v}` : v);
  const lines = [['Row', 'Campaign Reference', 'Report Date', 'Result', 'Errors', 'Warnings'].join(',')]
    .concat(rows.filter((r) => r.errors.length || r.warnings.length)
      .map((r) => [String(r.rowNumber ?? r.row ?? ''), r.reference, r.reportDate, r.action, r.errors.join(' | '), r.warnings.join(' | ')].map(safe).join(',')));
  const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadTemplate(platforms: { name: string }[], countries: { code: string; name: string }[]) {
  const [{ default: writeExcelFile }, { adsTemplateSheets }] = await Promise.all([import('write-excel-file/browser'), import('@/lib/ads/template')]);
  await writeExcelFile(adsTemplateSheets(platforms, countries) as never).toFile('Ads Monitoring import template.xlsx');
}

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useCrmData();
  const commit = useCommitImport();
  const [file, setFile] = React.useState<File | null>(null);
  const [mode, setMode] = React.useState<'skip' | 'update'>('skip');
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [result, setResult] = React.useState<ImportResult | null>(null);
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  const [onlyIssues, setOnlyIssues] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (open) { setFile(null); setPreview(null); setResult(null); setError(undefined); setMode('skip'); setOnlyIssues(false); } }, [open]);

  const runPreview = async (f: File, m: 'skip' | 'update') => {
    if (f.size > IMPORT_LIMITS.maxFileBytes) { setError('The workbook is larger than 5 MB. Split it into smaller files.'); return; }
    if (!f.name.toLowerCase().endsWith('.xlsx')) { setError('Choose an .xlsx workbook.'); return; }
    setBusy(true); setError(undefined); setResult(null);
    try { setPreview(await previewImport(f, m)); } catch (e) { setPreview(null); setError((e as Error).message); } finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!file || !preview) return;
    try { setResult(await commit.mutateAsync({ file, mode, summary: preview.summary })); } catch { /* toast shown; keep preview */ }
  };

  const rows = (preview?.rows ?? []).filter((r) => !onlyIssues || r.errors.length || r.warnings.length);
  const writable = preview ? preview.summary.entriesToCreate + preview.summary.entriesToUpdate : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Upload Excel</DialogTitle>
          <DialogDescription>Daily performance from the template's “Daily Tracker” sheet. Every row is checked and shown before anything is saved; ownership is always you.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="flex flex-col gap-3 text-[13px]" role="status">
            <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" /> Import complete.</p>
            <ul className="grid gap-1 sm:grid-cols-5">
              <li>Campaigns created: <strong>{result.campaignsCreated}</strong></li>
              <li>Records created: <strong>{result.created}</strong></li>
              <li>Records updated: <strong>{result.updated}</strong></li>
              <li>Skipped: <strong>{result.skipped}</strong></li>
              <li>Rejected: <strong>{result.rejected}</strong></li>
            </ul>
            {result.rows.some((r) => r.errors.length || r.warnings.length) && (
              <Button variant="outline" size="sm" className="w-fit" onClick={() => downloadErrorReport(result.rows, `import-${result.importId}-report.csv`)}><Download /> Download error report</Button>
            )}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <input ref={input} type="file" accept=".xlsx" className="sr-only" tabIndex={-1} aria-label="Ads workbook file"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { setFile(f); void runPreview(f, mode); } }} />
              <Button size="sm" onClick={() => input.current?.click()} disabled={busy}><Upload /> {file ? 'Choose a different file' : 'Choose .xlsx file'}</Button>
              <div className="flex flex-col gap-1">
                <Label htmlFor="import-mode">Rows for dates that already exist</Label>
                <NativeSelect id="import-mode" className="w-64" value={mode} onChange={(e) => { const m = e.target.value as 'skip' | 'update'; setMode(m); if (file) void runPreview(file, m); }}>
                  <option value="skip">Skip them (default)</option>
                  <option value="update">Update them — blank cells keep saved values</option>
                </NativeSelect>
              </div>
              <Button size="sm" variant="ghost" onClick={() => downloadTemplate(data?.platforms ?? [], data?.countries ?? []).catch(() => toast.error('Could not create the template.'))}><Download /> Download Sample Template</Button>
            </div>
            {file && <p className="flex items-center gap-2 text-[13px]"><FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> {file.name}{busy && ' — checking…'}</p>}
            {error && <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[12px]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />{error}</p>}

            {preview && (preview.missingColumns.length ? (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[13px]">The header row is missing: {preview.missingColumns.join(', ')}. Start from the Sample Template.</p>
            ) : preview.tooManyRows ? (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[13px]">More than {IMPORT_LIMITS.maxRows.toLocaleString()} rows. Split the workbook.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[12px]" aria-live="polite">
                  <Badge tone="success">{preview.summary.campaignsToCreate} new campaigns</Badge>
                  <Badge tone="success">{preview.summary.entriesToCreate} new records</Badge>
                  <Badge tone="warning">{preview.summary.entriesToUpdate} updates</Badge>
                  <Badge tone="neutral">{preview.summary.skipped} skipped</Badge>
                  <Badge tone="danger">{preview.summary.rejected} rejected</Badge>
                  <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Only rows with errors or warnings</label>
                  <Button size="sm" variant="outline" onClick={() => downloadErrorReport(preview.rows, 'import-preview-report.csv')}><Download /> Error report</Button>
                </div>
                <div className="max-h-[45vh] overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[48rem] border-collapse text-[12px]">
                    <caption className="sr-only">Import preview</caption>
                    <thead className="sticky top-0 bg-surface-2"><tr>{['Row', 'Campaign', 'Report date', 'Result', 'Details'].map((h) => <th key={h} scope="col" className="border-b border-border px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr></thead>
                    <tbody>
                      {rows.slice(0, 500).map((r) => (
                        <tr key={r.rowNumber} className={`border-b border-border align-top last:border-0 ${r.action === 'reject' ? 'bg-danger-bg/20' : ''}`}>
                          <td className="px-2 py-1.5 tabular text-muted-foreground">{r.rowNumber}</td>
                          <td className="px-2 py-1.5 font-medium">{r.reference || '—'}</td>
                          <td className="px-2 py-1.5 tabular">{r.reportDate || '—'}</td>
                          <td className="px-2 py-1.5"><Badge tone={ACTION_LABEL[r.action].tone}>{ACTION_LABEL[r.action].label}</Badge></td>
                          <td className="px-2 py-1.5">
                            <ul className="flex flex-col gap-0.5">
                              {r.errors.map((e) => <li key={e} className="text-danger">{e}</li>)}
                              {r.warnings.map((w) => <li key={w} className="text-warning">{w}</li>)}
                            </ul>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[12px] text-muted-foreground">Confirming writes the {writable} valid record(s) together — if anything fails, none are saved. The data is checked again when you confirm.</p>
              </>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{result ? 'Done' : 'Cancel'}</Button>
          {!result && preview && !preview.missingColumns.length && writable + preview.summary.campaignsToCreate > 0 && (
            <Button onClick={confirm} disabled={commit.isPending}>{commit.isPending ? 'Importing…' : `Confirm import (${writable} record${writable === 1 ? '' : 's'})`}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
