import * as React from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, RefreshCw, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge, Checkbox } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/overlays';
import { useCrmData, useImportCommit, type ImportResult } from '@/hooks/useData';
import { parseCSV } from '@/lib/csv';
import {
  DOMAIN_FIELD_LABELS, DOMAIN_IMPORT_COLUMNS, domainSheetChanges, domainUpdateFields, validateDomainSheet,
  type DomainSheetResult,
} from '@/lib/domain-import';
import { SHEET_LIMITS } from '@/lib/sheet';
import { DOMAIN_COUNTRY } from '@/lib/types';
import { formatDate, normalizeDomain } from '@/lib/utils';
import { downloadDomainTemplate } from './domainTemplate';

/** How many preview rows are drawn. Every row is validated and imported; the
 *  table only shows the first stretch, so a large file stays responsive. */
const PREVIEW_LIMIT = 300;

type Stage =
  | { kind: 'choose'; error?: string }
  | { kind: 'reading'; fileName: string }
  | { kind: 'preview'; fileName: string; cells: unknown[][]; sheet: DomainSheetResult }
  | { kind: 'done'; fileName: string; result: ImportResult };

/**
 * Many domains at once, from the registrar export:
 * Domain · Country · UID · Registration Time · Expire Date · Registrar · Status · Category · Nameservers.
 *
 * Nothing is saved until the preview has been seen: every row is checked first
 * — a real domain name, not already in the register (archived included), not
 * repeated in the file, a country of India, Indonesia or Available, dates in
 * order — and a row with a problem says exactly what is wrong. Only ready rows
 * are sent, and the server checks them again.
 *
 * Domains already in the register are skipped unless the person ticks "Update
 * domains already in the register". Then each one shows exactly which fields
 * change, old → new, before anything is sent; blank optional cells keep the
 * current value, and every update lands in that domain's audit history.
 */
type Plan = { kind: 'new' | 'update' | 'unchanged'; changes: ReturnType<typeof domainSheetChanges> };

const showValue = (field: string, value: string) =>
  !value ? '(blank)' : field === 'registeredDate' || field === 'expirationDate' ? formatDate(value) : value;

/** What a ready row will do, with each change spelled out old → new. */
function RowPlan({ plan }: { plan?: Plan }) {
  if (!plan || plan.kind === 'new') {
    return <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> New</span>;
  }
  if (plan.kind === 'unchanged') {
    return <span className="text-muted-foreground">Already up to date</span>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 font-medium text-warning"><RefreshCw className="h-3 w-3" aria-hidden="true" /> Will update</span>
      <ul className="flex flex-col gap-0.5">
        {plan.changes.map((c) => (
          <li key={c.field} className="break-all">
            <strong>{DOMAIN_FIELD_LABELS[c.field]}:</strong>{' '}
            <span className="text-muted-foreground line-through">{showValue(c.field, c.from)}</span> → {showValue(c.field, c.to)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DomainBulkUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useCrmData();
  const commit = useImportCommit('domains');
  const [stage, setStage] = React.useState<Stage>({ kind: 'choose' });
  const [onlyProblems, setOnlyProblems] = React.useState(false);
  const [overwrite, setOverwrite] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setStage({ kind: 'choose' });
      setOnlyProblems(false);
      setOverwrite(false);
    }
  }, [open]);

  const liveByName = React.useMemo(
    () => new Map((data?.domains ?? []).filter((d) => !d.archived).map((d) => [d.domainName, d])),
    [data],
  );

  const check = React.useCallback((cells: unknown[][], update: boolean) => {
    const domains = data?.domains ?? [];
    return validateDomainSheet(cells, {
      // Every name counts, archived included: a retired domain keeps its name reserved.
      existing: new Set(domains.map((d) => d.domainName)),
      archived: new Set(domains.filter((d) => d.archived).map((d) => d.domainName)),
      overwrite: update,
    });
  }, [data]);

  const changeOverwrite = (update: boolean) => {
    setOverwrite(update);
    if (stage.kind === 'preview') setStage({ ...stage, sheet: check(stage.cells, update) });
  };

  const readFile = async (file: File) => {
    if (file.size > SHEET_LIMITS.maxFileBytes) {
      setStage({ kind: 'choose', error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${SHEET_LIMITS.maxFileBytes / 1024 / 1024} MB — split it into smaller files.` });
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
        const { readSheet } = await import('read-excel-file/browser');
        cells = (await readSheet(file)) as unknown[][];
      }
      setStage({ kind: 'preview', fileName: file.name, cells, sheet: check(cells, overwrite) });
    } catch {
      setStage({ kind: 'choose', error: 'That file could not be read. Open it in Excel, save it again as .xlsx, and retry.' });
    }
  };

  const preview = stage.kind === 'preview' ? stage.sheet : null;
  // What each ready row will do: add a new domain, update a live one, or nothing.
  const plans = React.useMemo(() => new Map<number, Plan>((preview?.rows ?? []).map((r): [number, Plan] => {
    const v = r.result.value;
    const current = v ? liveByName.get(v.domainName) : undefined;
    if (!v || !current) return [r.rowNumber, { kind: 'new', changes: [] }];
    const changes = domainSheetChanges(current, domainUpdateFields(r.raw, v));
    return [r.rowNumber, { kind: changes.length ? 'update' : 'unchanged', changes }];
  })), [preview, liveByName]);

  const ready = preview?.rows.filter((r) => r.result.value) ?? [];
  const toCreate = ready.filter((r) => plans.get(r.rowNumber)?.kind === 'new');
  const toUpdate = ready.filter((r) => plans.get(r.rowNumber)?.kind === 'update');
  const upToDate = ready.filter((r) => plans.get(r.rowNumber)?.kind === 'unchanged');
  const toSend = [...toCreate, ...toUpdate];
  const withProblems = preview?.rows.filter((r) => !r.result.value) ?? [];
  // With updating off, how many rows were refused only because they already exist.
  const alreadyRegistered = overwrite ? 0 : withProblems.filter((r) => liveByName.has(normalizeDomain(r.raw.domain ?? ''))).length;
  const listed = onlyProblems ? withProblems : preview?.rows ?? [];
  const shown = listed.slice(0, PREVIEW_LIMIT);

  const plural = (n: number) => `${n.toLocaleString()} domain${n === 1 ? '' : 's'}`;
  const actionLabel = [
    toCreate.length ? `Add ${toCreate.length.toLocaleString()}` : '',
    toUpdate.length ? `${toCreate.length ? 'update' : 'Update'} ${toUpdate.length.toLocaleString()}` : '',
  ].filter(Boolean).join(', ') + ` domain${toSend.length === 1 ? '' : 's'}`;

  const runImport = async () => {
    if (stage.kind !== 'preview' || !toSend.length) return;
    try {
      const result = await commit.mutateAsync({
        // The sheet's own cells, so the server can tell a blank cell (keep the
        // current value) from a filled one. It validates them again.
        rows: toSend.map((r) => ({ rowNumber: r.rowNumber, ...r.raw })),
        reason: `Bulk upload from ${stage.fileName}`,
        overwrite,
      });
      setStage({ kind: 'done', fileName: stage.fileName, result });
    } catch {
      // The mutation has already shown the reason; stay on the preview.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>Bulk upload domains</DialogTitle>
          <DialogDescription>
            Add many domains at once from your registrar export. You will see every row checked before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {(stage.kind === 'choose' || stage.kind === 'reading') && (
          <div className="flex flex-col gap-4">
            <ol className="flex flex-col gap-3 text-[13px]">
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <span>
                  <strong>1.</strong> Use your registrar export, or download the template — same columns, plus a “How to fill” sheet.
                </span>
                <Button size="sm" variant="outline" onClick={() => downloadDomainTemplate().catch(() => toast.error('Could not create the template.'))}>
                  <Download /> Download template
                </Button>
              </li>
              <li className="rounded-md border border-border p-3">
                <strong>2.</strong> The header row needs these columns:{' '}
                {DOMAIN_IMPORT_COLUMNS.map((c, i) => (
                  <React.Fragment key={c.key}>
                    {i > 0 && ' · '}
                    <span className={c.required ? 'font-medium' : 'text-muted-foreground'}>{c.header}{c.required ? '*' : ''}</span>
                  </React.Fragment>
                ))}
                <span className="mt-1 block text-[12px] text-muted-foreground">
                  * required. Country is {DOMAIN_COUNTRY.join(', ')}. Status OK is saved as Active; Expired or ClientHold as Inactive.
                </span>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <span><strong>3.</strong> Upload the file (.xlsx or .csv, up to {SHEET_LIMITS.maxRows.toLocaleString()} rows).</span>
                <input
                  ref={fileInput}
                  id="domain-bulk-file"
                  type="file"
                  accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Domain spreadsheet file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void readFile(file);
                  }}
                />
                <Button size="sm" onClick={() => fileInput.current?.click()} disabled={stage.kind === 'reading'}>
                  <Upload /> {stage.kind === 'reading' ? `Reading ${stage.fileName}…` : 'Choose file'}
                </Button>
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
            <p className="flex items-center gap-2 text-[13px]">
              <FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="font-medium">{stage.fileName}</span>
            </p>

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
                This file has more than {SHEET_LIMITS.maxRows.toLocaleString()} domains. Split it into smaller files.
              </p>
            ) : preview.rows.length === 0 ? (
              <p className="rounded-md border border-border px-3 py-3 text-[13px]">
                The header row is right, but there are no domains under it yet.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-1 rounded-md border border-border px-3 py-2 text-[13px]">
                  <label className="flex items-center gap-2 font-medium">
                    <Checkbox checked={overwrite} onCheckedChange={(v) => changeOverwrite(v === true)} aria-label="Update domains already in the register" />
                    Update domains already in the register
                  </label>
                  <span className="text-[12px] text-muted-foreground">
                    {overwrite
                      ? 'Country, dates, status, registrar, UID, category and nameservers are replaced from the sheet. A blank cell keeps the current value. Rotation date, brand and notes are never touched. Every change is kept in the domain’s audit history.'
                      : alreadyRegistered > 0
                        ? `${alreadyRegistered.toLocaleString()} row${alreadyRegistered === 1 ? ' is' : 's are'} already in the register and will be skipped. Tick this to update ${alreadyRegistered === 1 ? 'it' : 'them'} from the sheet instead — you will see every change first.`
                        : 'Off: domains already in the register are skipped, never changed.'}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[13px]" aria-live="polite">
                  {toCreate.length > 0 && (
                    <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {toCreate.length} new</Badge>
                  )}
                  {toUpdate.length > 0 && (
                    <Badge tone="warning"><RefreshCw className="h-3 w-3" aria-hidden="true" /> {toUpdate.length} will be updated</Badge>
                  )}
                  {upToDate.length > 0 && (
                    <Badge tone="neutral"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {upToDate.length} already up to date</Badge>
                  )}
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
                        {['Row', 'Domain', 'Country', 'Registered', 'Expires', 'Registrar', 'Status', 'Check'].map((h) => (
                          <th key={h} scope="col" className="border-b border-border px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map(({ rowNumber, raw, result }) => {
                        const v = result.value;
                        return (
                          <tr key={rowNumber} className={`border-b border-border align-top last:border-0 ${v ? '' : 'bg-danger-bg/20'}`}>
                            <td className="px-2 py-1.5 tabular text-muted-foreground">{rowNumber}</td>
                            <td className="px-2 py-1.5 font-medium">{v?.domainName ?? raw.domain}</td>
                            <td className="px-2 py-1.5">{v?.targetCountry ?? raw.country}</td>
                            <td className="px-2 py-1.5">{v ? formatDate(v.registeredDate) : raw.registrationTime}</td>
                            <td className="px-2 py-1.5">{v ? formatDate(v.expirationDate) : raw.expireDate}</td>
                            <td className="px-2 py-1.5">{v ? v.registrar || '—' : raw.registrar}</td>
                            <td className="px-2 py-1.5">
                              {v ? (
                                <span>
                                  {v.status}
                                  {raw.status && !['ok', v.status.toLowerCase()].includes(raw.status.trim().toLowerCase()) && (
                                    <span className="block text-[11px] text-muted-foreground">from “{raw.status}”</span>
                                  )}
                                </span>
                              ) : raw.status}
                            </td>
                            <td className="px-2 py-1.5">
                              {v ? (
                                <RowPlan plan={plans.get(rowNumber)} />
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
              {plural(stage.result.created)} added{stage.result.updated ? `, ${plural(stage.result.updated)} updated` : ''} from {stage.fileName}.
            </p>
            {(stage.result.unchanged ?? 0) > 0 && (
              <p className="text-muted-foreground">{plural(stage.result.unchanged!)} already matched the sheet — nothing to change.</p>
            )}
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
                sheet and upload it again — domains already added will be recognised.
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
          {stage.kind === 'preview' && toSend.length > 0 && (
            <Button onClick={runImport} disabled={commit.isPending}>
              <Upload /> {commit.isPending ? 'Saving…' : actionLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
