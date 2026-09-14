import * as React from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Checkbox, Label, NativeSelect } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/overlays';
import { useCrmData, useImportCommit, type ImportResult } from '@/hooks/useData';
import { parseCSV } from '@/lib/csv';
import {
  SIM_IMPORT_COLUMNS, SIM_IMPORT_LIMITS, takenBySims, validateSimSheet, type SheetResult,
} from '@/lib/sim-import';
import { formatDate } from '@/lib/utils';
import { telegramUrl } from '@/lib/identity';
import { downloadSimTemplate } from './simTemplate';

/** How many preview rows are drawn. Every row is validated and imported; the
 *  table only shows the first stretch, so a large file stays responsive. */
const PREVIEW_LIMIT = 300;

type Stage =
  | { kind: 'choose'; error?: string }
  | { kind: 'reading'; fileName: string }
  | { kind: 'preview'; fileName: string; cells: unknown[][]; sheet: SheetResult }
  | { kind: 'done'; fileName: string; result: ImportResult };

/**
 * Many SIMs at once, from the team's tracking sheet:
 * No. · SIM Number · Created For · Email · Telegram Username · Status · Date Checked · Others · Remarks.
 *
 * Nothing is saved until the preview has been seen: every row is checked first
 * — the number read correctly, not already registered, no email or Telegram
 * username already on another SIM, nothing repeated in the file — and a row with
 * a problem says exactly what is wrong. Only ready rows are sent, and the server
 * checks them again.
 */
export function SimBulkUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useCrmData();
  const commit = useImportCommit('sims');
  const [stage, setStage] = React.useState<Stage>({ kind: 'choose' });
  const [onlyProblems, setOnlyProblems] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  // Numbers written without a country code ("09175550420") belong to this
  // country. It starts as the country most of the register's SIMs are in.
  const busiestCountry = React.useMemo(() => {
    const counts = new Map<string, number>();
    (data?.sims ?? []).filter((s) => !s.archived).forEach((s) => counts.set(s.countryCode, (counts.get(s.countryCode) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
      ?? data?.countries.find((c) => c.code === 'PH')?.code
      ?? data?.countries[0]?.code
      ?? '';
  }, [data]);
  const [fallbackCountry, setFallbackCountry] = React.useState('');
  const fallback = fallbackCountry || busiestCountry;

  React.useEffect(() => {
    if (open) {
      setStage({ kind: 'choose' });
      setOnlyProblems(false);
      setFallbackCountry('');
    }
  }, [open]);

  const check = React.useCallback((cells: unknown[][], countryCode: string) => validateSimSheet(cells, {
    countries: data?.countries ?? [],
    fallbackCountryCode: countryCode,
    existing: takenBySims(data?.sims ?? []),
  }), [data]);

  const readFile = async (file: File) => {
    if (file.size > SIM_IMPORT_LIMITS.maxFileBytes) {
      setStage({ kind: 'choose', error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${SIM_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB — split it into smaller files.` });
      return;
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.csv')) {
      setStage({
        kind: 'choose',
        error: name.endsWith('.xls')
          ? 'That is an old-format .xls file. In Excel, choose File → Save As → Excel Workbook (.xlsx), then upload that.'
          : 'Choose an Excel file (.xlsx) or a CSV file.',
      });
      return;
    }

    setStage({ kind: 'reading', fileName: file.name });
    try {
      let cells: unknown[][];
      if (name.endsWith('.csv')) {
        cells = parseCSV(await file.text());
      } else {
        // Loaded on demand: the reader is a separate chunk nobody else downloads.
        const { readSheet } = await import('read-excel-file/browser');
        cells = (await readSheet(file)) as unknown[][];
      }
      setStage({ kind: 'preview', fileName: file.name, cells, sheet: check(cells, fallback) });
    } catch {
      setStage({ kind: 'choose', error: 'That file could not be read. Open it in Excel, save it again as .xlsx, and retry.' });
    }
  };

  // Changing the country re-reads the same file: only local numbers change.
  const changeFallback = (code: string) => {
    setFallbackCountry(code);
    if (stage.kind === 'preview') setStage({ ...stage, sheet: check(stage.cells, code) });
  };

  const preview = stage.kind === 'preview' ? stage.sheet : null;
  const ready = preview?.rows.filter((r) => r.result.value) ?? [];
  const withProblems = preview?.rows.filter((r) => !r.result.value) ?? [];
  const listed = onlyProblems ? withProblems : preview?.rows ?? [];
  const shown = listed.slice(0, PREVIEW_LIMIT);

  const runImport = async () => {
    if (stage.kind !== 'preview' || !ready.length) return;
    try {
      const result = await commit.mutateAsync({
        rows: ready.map((r) => ({ rowNumber: r.rowNumber, ...r.result.value! })),
        reason: `Bulk upload from ${stage.fileName}`,
        fallbackCountryCode: fallback,
      });
      setStage({ kind: 'done', fileName: stage.fileName, result });
    } catch {
      // The mutation has already shown the reason; stay on the preview.
    }
  };

  const countryPicker = (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <Label htmlFor="sim-bulk-country">Country for numbers without a country code</Label>
      <NativeSelect id="sim-bulk-country" className="w-48" value={fallback} onChange={(e) => changeFallback(e.target.value)}>
        {(data?.countries ?? []).map((c) => <option key={c.code} value={c.code}>{c.name} ({c.dialCode})</option>)}
      </NativeSelect>
      <span className="text-[12px] text-muted-foreground">Numbers like 639175550420 carry their own country.</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Bulk upload SIMs</DialogTitle>
          <DialogDescription>
            Add many SIMs at once from your SIM sheet. You will see every row checked before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {(stage.kind === 'choose' || stage.kind === 'reading') && (
          <div className="flex flex-col gap-4">
            <ol className="flex flex-col gap-3 text-[13px]">
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <span>
                  <strong>1.</strong> Use your SIM sheet, or download the template — same columns, plus a “How to fill” sheet.
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadSimTemplate(data?.countries ?? []).catch(() => toast.error('Could not create the template.'))}
                >
                  <Download /> Download template
                </Button>
              </li>
              <li className="rounded-md border border-border p-3">
                <strong>2.</strong> The header row needs these columns:{' '}
                {SIM_IMPORT_COLUMNS.map((c, i) => (
                  <React.Fragment key={c.key}>
                    {i > 0 && ' · '}
                    <span className={c.required ? 'font-medium' : 'text-muted-foreground'}>{c.header}{c.required ? '*' : ''}</span>
                  </React.Fragment>
                ))}
                <span className="mt-1 block text-[12px] text-muted-foreground">
                  * required — every other column may be blank. Dead / Patay is saved as Inactive.
                </span>
              </li>
              <li className="flex flex-col gap-3 rounded-md border border-border p-3">
                {countryPicker}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span><strong>3.</strong> Upload the file (.xlsx or .csv, up to {SIM_IMPORT_LIMITS.maxRows.toLocaleString()} rows).</span>
                  <input
                    ref={fileInput}
                    id="sim-bulk-file"
                    type="file"
                    accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    className="sr-only"
                    // Reached through the button beside it, which says what it does;
                    // a second, unlabeled tab stop would only confuse.
                    tabIndex={-1}
                    aria-label="SIM spreadsheet file"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file) void readFile(file);
                    }}
                  />
                  <Button size="sm" onClick={() => fileInput.current?.click()} disabled={stage.kind === 'reading'}>
                    <Upload /> {stage.kind === 'reading' ? `Reading ${stage.fileName}…` : 'Choose file'}
                  </Button>
                </div>
              </li>
            </ol>
            {stage.kind === 'choose' && stage.error && (
              <p role="alert" className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[12px]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" /> {stage.error}
              </p>
            )}
          </div>
        )}

        {stage.kind === 'preview' && preview && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[13px]">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">{stage.fileName}</span>
              </p>
              {countryPicker}
            </div>

            {preview.missingColumns.length > 0 ? (
              <div role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-3 text-[13px]">
                <p className="font-medium text-danger">The header row is missing a required column</p>
                <p className="mt-1">
                  Add a column named {preview.missingColumns.map((c) => `“${c.header}”`).join(', ')} and upload again —
                  or start from the template.
                </p>
              </div>
            ) : preview.tooManyRows ? (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[13px]">
                This file has more than {SIM_IMPORT_LIMITS.maxRows.toLocaleString()} SIMs. Split it into smaller files.
              </p>
            ) : preview.rows.length === 0 ? (
              <p className="rounded-md border border-border px-3 py-3 text-[13px]">
                The header row is right, but there are no SIMs under it yet.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[13px]" aria-live="polite">
                  <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {ready.length} ready</Badge>
                  {withProblems.length > 0 && (
                    <Badge tone="danger"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> {withProblems.length} with problems — will be skipped</Badge>
                  )}
                  {withProblems.length > 0 && (
                    <label className="ml-auto flex items-center gap-2 text-[12px]">
                      <Checkbox checked={onlyProblems} onCheckedChange={(v) => setOnlyProblems(v === true)} aria-label="Show only rows with problems" />
                      Show only rows with problems
                    </label>
                  )}
                </div>

                <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[62rem] border-collapse text-[12px]">
                    <caption className="sr-only">Rows read from {stage.fileName}</caption>
                    <thead className="sticky top-0 bg-surface-2">
                      <tr>
                        {['No.', 'SIM Number', 'Created For', 'Email', 'Telegram', 'Status', 'Date Checked', 'Check'].map((h) => (
                          <th key={h} scope="col" className="border-b border-border px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(({ rowNumber, raw, result }) => {
                        const v = result.value;
                        return (
                          <tr key={rowNumber} className={`border-b border-border align-top last:border-0 ${v ? '' : 'bg-danger-bg/20'}`}>
                            <td className="px-2 py-1.5 tabular text-muted-foreground" title={`Spreadsheet row ${rowNumber}`}>{raw.no || rowNumber}</td>
                            <td className="px-2 py-1.5 tabular">{v?.phoneNumber ?? raw.phoneNumber}</td>
                            <td className="px-2 py-1.5">{v ? v.createdFor || '—' : raw.createdFor}</td>
                            <td className="px-2 py-1.5">{v ? v.email || '—' : raw.email}</td>
                            <td className="px-2 py-1.5">{v ? (v.telegramUsername ? telegramUrl(v.telegramUsername) : '—') : raw.telegramUsername}</td>
                            <td className="px-2 py-1.5">
                              {v ? (
                                <span>
                                  {v.operationalStatus}
                                  {raw.status && raw.status.toLowerCase() !== v.operationalStatus.toLowerCase() && (
                                    <span className="block text-[11px] text-muted-foreground">from “{raw.status}”</span>
                                  )}
                                </span>
                              ) : raw.status}
                            </td>
                            <td className="px-2 py-1.5">{v ? formatDate(v.lastVerifiedDate) : raw.dateChecked}</td>
                            <td className="px-2 py-1.5">
                              {v ? (
                                <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready</span>
                              ) : (
                                <ul className="flex flex-col gap-0.5">
                                  {result.problems.map((p) => (
                                    <li key={p.column} className="text-danger"><strong>{p.column}:</strong> {p.message}</li>
                                  ))}
                                </ul>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {listed.length > PREVIEW_LIMIT && (
                  <p className="text-[12px] text-muted-foreground">
                    Showing the first {PREVIEW_LIMIT} rows. All {listed.length.toLocaleString()} were checked.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {stage.kind === 'done' && (
          <div className="flex flex-col gap-3 text-[13px]" role="status">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              {stage.result.created.toLocaleString()} SIM{stage.result.created === 1 ? '' : 's'} added from {stage.fileName}.
            </p>
            {(stage.result.problems?.length ?? 0) > 0 && (
              <div className="rounded-md border border-warning/40 bg-warning-bg/40 px-3 py-2">
                <p className="font-medium">{stage.result.skipped} skipped — the register changed while you were reviewing:</p>
                <ul className="mt-1 flex flex-col gap-0.5 text-[12px]">
                  {stage.result.problems!.map((p) => <li key={p.row}>Row {p.row}: {p.reason}</li>)}
                </ul>
              </div>
            )}
            {withProblems.length > 0 && (
              <p className="text-muted-foreground">
                The {withProblems.length} row{withProblems.length === 1 ? '' : 's'} with problems were not sent. Fix them in the
                sheet and upload it again — SIMs already added will be recognised and skipped.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {stage.kind === 'preview' && (
            <Button variant="outline" onClick={() => setStage({ kind: 'choose' })}>Choose a different file</Button>
          )}
          {stage.kind === 'done' ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <Button variant={stage.kind === 'preview' ? 'outline' : 'default'} onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {stage.kind === 'preview' && ready.length > 0 && (
            <Button onClick={runImport} disabled={commit.isPending}>
              <Upload /> {commit.isPending ? 'Adding…' : `Add ${ready.length.toLocaleString()} SIM${ready.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
