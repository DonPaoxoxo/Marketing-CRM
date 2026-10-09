import * as React from 'react';
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { FilterSelect } from '@/components/common/controls';
import { Badge, Input, Label } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/overlays';
import { useCrmData, useLeadImportCommit, type ImportResult } from '@/hooks/useData';
import { parseCSV } from '@/lib/csv';
import { LEAD_IMPORT_COLUMNS, leadChannelKey, validateLeadSheet, type LeadSheetResult } from '@/lib/lead-import';
import { SHEET_LIMITS } from '@/lib/sheet';
import { downloadLeadTemplate } from './leadTemplate';

const PREVIEW_LIMIT = 300;

type Stage =
  | { kind: 'choose'; error?: string }
  | { kind: 'reading'; fileName: string }
  | { kind: 'preview'; fileName: string; sheet: LeadSheetResult }
  | { kind: 'done'; fileName: string; result: ImportResult };

/**
 * Many creator leads at once, from a scraper sheet such as
 * india_casino_creator_leads_youtube_v2.csv: Platform · Creator · ChannelURL ·
 * Subscribers · Tier · Keyword · PromoConfidence · EvidenceVideoTitle ·
 * EvidenceVideoURL · PublicEmail · PublicTelegram · PublicInstagram · Status.
 *
 * Country and Niche are not sheet columns — the team's filename convention
 * ({country}_{niche}_creator_leads_{platform}_v{n}) puts them there, so they
 * are chosen once below and applied to the whole file. A row whose own
 * Platform cell is blank uses the platform chosen here too.
 *
 * Nothing is saved until the preview has been seen, and a lead already in the
 * register for that platform and country (by channel URL) is skipped, never
 * overwritten — the same rule a re-run of the same sheet relies on to be
 * harmless.
 */
export function LeadImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useCrmData();
  const commit = useLeadImportCommit();
  const [countryCode, setCountryCode] = React.useState('');
  const [platformId, setPlatformId] = React.useState('');
  const [niche, setNiche] = React.useState('');
  const [stage, setStage] = React.useState<Stage>({ kind: 'choose' });
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) {
      setStage({ kind: 'choose' });
      setCountryCode(data?.countries[0]?.code ?? '');
      setPlatformId(data?.platforms[0]?.id ?? '');
      setNiche('');
    }
  }, [open, data]);

  const ready = Boolean(countryCode && platformId);

  const readFile = async (file: File) => {
    if (!ready) return;
    if (file.size > SHEET_LIMITS.maxFileBytes) {
      setStage({ kind: 'choose', error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${SHEET_LIMITS.maxFileBytes / 1024 / 1024} MB — split it into smaller files.` });
      return;
    }
    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.xlsx')) {
      setStage({ kind: 'choose', error: 'Choose a CSV file (.csv) or an Excel file (.xlsx).' });
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
      const existing = new Set((data?.dataLeads ?? []).map((l) => leadChannelKey(l.countryCode, l.platformId, l.channelUrl)));
      const sheet = validateLeadSheet(cells, { platforms: data?.platforms ?? [], defaultPlatformId: platformId, countryCode, existing });
      setStage({ kind: 'preview', fileName: file.name, sheet });
    } catch {
      setStage({ kind: 'choose', error: 'That file could not be read. Open it in Excel, save it again as .xlsx (or .csv), and retry.' });
    }
  };

  const preview = stage.kind === 'preview' ? stage.sheet : null;
  const good = preview?.rows.filter((r) => r.result.value) ?? [];
  const withProblems = preview?.rows.filter((r) => !r.result.value) ?? [];
  const shown = (preview?.rows ?? []).slice(0, PREVIEW_LIMIT);
  const platformName = (id: string) => data?.platforms.find((p) => p.id === id)?.name ?? id;

  const runImport = async () => {
    if (stage.kind !== 'preview' || !good.length) return;
    try {
      const result = await commit.mutateAsync({
        countryCode, platformId, niche,
        rows: good.map((r) => ({ rowNumber: r.rowNumber, ...r.raw })),
        reason: `Bulk upload from ${stage.fileName}`,
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
          <DialogTitle>Bulk upload Data Leads</DialogTitle>
          <DialogDescription>
            Add many creator leads at once from a scraper sheet. Country and niche are set once below and applied to
            every row; you will see every row checked before anything is saved.
          </DialogDescription>
        </DialogHeader>

        {(stage.kind === 'choose' || stage.kind === 'reading') && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <FilterSelect id="lead-import-country" label="Country" value={countryCode} onChange={setCountryCode}
                options={(data?.countries ?? []).map((c) => ({ value: c.code, label: c.name }))} />
              <FilterSelect id="lead-import-platform" label="Platform (default for blank rows)" value={platformId} onChange={setPlatformId}
                options={(data?.platforms ?? []).map((p) => ({ value: p.id, label: p.name }))} />
              <div className="flex min-w-[9.5rem] flex-col gap-1">
                <Label htmlFor="lead-import-niche" className="text-[11px] uppercase tracking-wide text-muted-foreground">Niche</Label>
                <Input id="lead-import-niche" value={niche} onChange={(e) => setNiche(e.target.value)} placeholder="e.g. Casino/Betting" />
              </div>
            </div>

            <ol className="flex flex-col gap-3 text-[13px]">
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <span>
                  <strong>1.</strong> Use your scraper export, or download the template — same columns, a filled example row, and a "How to fill" sheet.
                </span>
                <Button variant="outline" size="sm" onClick={() => downloadLeadTemplate().catch(() => toast.error('Could not create the template.'))}>
                  <Download /> Download template
                </Button>
              </li>
              <li className="rounded-md border border-border p-3">
                <strong>2.</strong> The header row needs at least{' '}
                {LEAD_IMPORT_COLUMNS.filter((c) => c.required).map((c, i) => (
                  <React.Fragment key={c.key}>{i > 0 && ' · '}<span className="font-medium">{c.header}</span></React.Fragment>
                ))}. The rest — {LEAD_IMPORT_COLUMNS.filter((c) => !c.required).map((c) => c.header).join(', ')} — are optional.
                <span className="mt-1 block text-[12px] text-muted-foreground">
                  This is the shape of india_casino_creator_leads_youtube_v2.csv and sibling sheets for other platforms and countries.
                </span>
              </li>
              <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <span><strong>3.</strong> Upload the file (.csv or .xlsx, up to {SHEET_LIMITS.maxRows.toLocaleString()} rows).</span>
                <input
                  ref={fileInput}
                  id="lead-import-file"
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  tabIndex={-1}
                  aria-label="Lead sheet file"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void readFile(file);
                  }}
                />
                <Button size="sm" onClick={() => fileInput.current?.click()} disabled={!ready || stage.kind === 'reading'}
                  title={ready ? undefined : 'Choose a country and platform first.'}>
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
            {preview.missingColumns.length > 0 ? (
              <div role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-3 text-[13px]">
                <p className="font-medium text-danger">The header row is missing a required column</p>
                <p className="mt-1">
                  Add a column named {preview.missingColumns.map((c) => `"${c.header}"`).join(', ')} and upload again.
                </p>
              </div>
            ) : preview.tooManyRows ? (
              <p role="alert" className="rounded-md border border-danger/40 bg-danger-bg/40 px-3 py-2 text-[13px]">
                This file has more than {SHEET_LIMITS.maxRows.toLocaleString()} rows. Split it into smaller files.
              </p>
            ) : preview.rows.length === 0 ? (
              <p className="rounded-md border border-border px-3 py-3 text-[13px]">The header row is right, but there are no leads under it yet.</p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 text-[13px]" aria-live="polite">
                  <Badge tone="success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {good.length} ready</Badge>
                  {withProblems.length > 0 && (
                    <Badge tone="danger"><AlertTriangle className="h-3 w-3" aria-hidden="true" /> {withProblems.length} with problems — will be skipped</Badge>
                  )}
                </div>
                <div className="max-h-[50vh] overflow-auto rounded-lg border border-border">
                  <table className="w-full min-w-[62rem] border-collapse text-[12px]">
                    <caption className="sr-only">Rows read from {stage.fileName}</caption>
                    <thead className="sticky top-0 bg-surface-2">
                      <tr>
                        {['Row', 'Platform', 'Creator', 'Channel', 'Subscribers', 'Check'].map((h) => (
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
                            <td className="px-2 py-1.5">{v ? platformName(v.platformId) : raw.platform || '—'}</td>
                            <td className="px-2 py-1.5 font-medium">{v?.creator ?? raw.creator}</td>
                            <td className="px-2 py-1.5 break-all">{v?.channelUrl ?? raw.channelUrl}</td>
                            <td className="px-2 py-1.5 tabular">{v?.followerCount?.toLocaleString() ?? raw.subscribers ?? '—'}</td>
                            <td className="px-2 py-1.5">
                              {v ? <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Ready</span> : (
                                <ul className="flex flex-col gap-0.5">
                                  {result.problems.map((p) => <li key={p.column} className="text-danger"><strong>{p.column}:</strong> {p.message}</li>)}
                                </ul>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > PREVIEW_LIMIT && (
                  <p className="text-[12px] text-muted-foreground">Showing the first {PREVIEW_LIMIT} rows. All {preview.rows.length.toLocaleString()} were checked.</p>
                )}
              </>
            )}
          </div>
        )}

        {stage.kind === 'done' && (
          <div className="flex flex-col gap-3 text-[13px]" role="status">
            <p className="flex items-center gap-2 font-medium">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              {stage.result.created.toLocaleString()} lead{stage.result.created === 1 ? '' : 's'} added from {stage.fileName}.
            </p>
            {stage.result.skipped > 0 && (
              <p className="text-muted-foreground">{stage.result.skipped.toLocaleString()} row(s) were not sent — already in the register, or had a problem.</p>
            )}
          </div>
        )}

        <DialogFooter>
          {stage.kind === 'preview' && <Button variant="outline" onClick={() => setStage({ kind: 'choose' })}>Choose a different file</Button>}
          {stage.kind === 'done' ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <Button variant={stage.kind === 'preview' ? 'outline' : 'default'} onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {stage.kind === 'preview' && good.length > 0 && (
            <Button onClick={runImport} disabled={commit.isPending}>
              <Upload /> {commit.isPending ? 'Saving…' : `Add ${good.length.toLocaleString()} lead${good.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
