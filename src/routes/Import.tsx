import * as React from 'react';
import { pageUrlKey, phoneKey } from '@/lib/identity';
import {
  SIM_IMPORT_COLUMNS, addTaken, noneTaken, takenBySims, validateSimRow, type SimImportKey, type TakenSims,
} from '@/lib/sim-import';
import type { Country } from '@/lib/types';
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react';
import { PageHeader, SectionCard, EmptyState, SecurityNotice, NotConnectedNotice } from '@/components/common/bits';
import { Button } from '@/components/ui/button';
import { Badge, Input, Label, NativeSelect, Textarea } from '@/components/ui/primitives';
import { FilterSelect } from '@/components/common/controls';
import { useCrmData, useImportCommit } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { isForbiddenColumn, parseCSV, toCSV } from '@/lib/csv';
import { downloadCSV } from '@/lib/download';
import { normalizePhone } from '@/lib/utils';

type Entity = 'sims' | 'agents' | 'social-accounts';

interface FieldSpec {
  key: string;
  label: string;
  required?: boolean;
  normalize?: (v: string) => string;
  /** Receives the whole mapped row, so a check can depend on a sibling field
   *  (an account's identity is its platform ID *on its platform*, or its URL). */
  validate?: (v: string, ctx: Ctx, row: Record<string, string>) => string | null;
}
interface Ctx {
  /** Numbers, emails and Telegram usernames held by live SIMs, and by earlier
   *  SIM rows of this file — kept apart from `seenInFile`, which holds one kind
   *  of key per register. */
  simsTaken: TakenSims;
  simsSeen: TakenSims;
  countries: Country[];
  /** For SIM numbers written without a country code. */
  fallbackCountryCode: string | null;
  /** Every existing account under both of its identities — platform ID and
   *  profile URL — so a row is caught by whichever one it carries. */
  existingIdentities: Set<string>;
  /** Live agents' contact numbers, compared by `phoneKey`. */
  existingAgentPhones: Set<string>;
  platformNames: Set<string>;
  seenInFile: Set<string>;
}

/** What makes two account rows the same asset.
 *
 *  Not the handle: team members manage many pages and reuse a handle or name
 *  across them, so handles repeat by design. The platform's own ID identifies an
 *  asset on its platform, and the profile URL identifies it outright — and each
 *  is checked on its own, because a row can clash on either. Comparison goes
 *  through the same keys as a form save, so the preview refuses exactly what
 *  saving would. */
const idKey = (platform: string, id: string) => `${platform.trim().toLowerCase()}::id:${id.trim()}`;
const urlIdentity = (url: string | undefined) => {
  const key = pageUrlKey(url);
  return key ? `url:${key}` : '';
};
const accountKeys = (row: Record<string, string>) =>
  [row.platformAccountId?.trim() ? idKey(row.platform ?? '', row.platformAccountId) : '', urlIdentity(row.profileUrl)]
    .filter(Boolean);
const clash = (key: string, ctx: Ctx, existing: Set<string>, what: string) => {
  if (!key) return null;
  if (existing.has(key)) return `${what} Existing records are never overwritten.`;
  if (ctx.seenInFile.has(key)) return 'Duplicated earlier in this file.';
  return null;
};
const agentPhoneIdentity = (v: string | undefined) => {
  const key = phoneKey(v);
  return key ? `phone:${key}` : '';
};

/** SIM rows are checked by the same rule as the SIM bulk upload and the server
 *  (`validateSimRow`), then each column shows only its own problems. The fields
 *  are the team's sheet: No. · SIM Number · Created For · Email · Telegram
 *  Username · Status · Date Checked · Others · Remarks. */
const simRow = (row: Record<string, string>, ctx: Ctx) => validateSimRow(row, {
  countries: ctx.countries, fallbackCountryCode: ctx.fallbackCountryCode, existing: ctx.simsTaken, seen: ctx.simsSeen,
});
const simHeader = (key: SimImportKey) => SIM_IMPORT_COLUMNS.find((c) => c.key === key)!.header;
const simCheck = (key: SimImportKey) => (_v: string, ctx: Ctx, row: Record<string, string>) => {
  const mine = simRow(row, ctx).problems.filter((p) => p.column === simHeader(key));
  return mine.length ? mine.map((p) => p.message).join(' ') : null;
};

/** Each row's identities. Every one is remembered once the row is read, so a
 *  later row repeating any of them is caught as a duplicate within the file. */
const SPECS: Record<Entity, {
  label: string;
  fields: FieldSpec[];
  dedupeKeys: (row: Record<string, string>, ctx: Ctx) => string[];
  /** Record a row's identities that do not fit `seenInFile`'s single key. */
  remember?: (row: Record<string, string>, ctx: Ctx) => void;
}> = {
  sims: {
    label: 'SIMs and phone numbers',
    dedupeKeys: () => [],
    // Only a valid row is remembered: an invalid one will not be imported, so a
    // later row repeating it is not a duplicate of anything saved.
    remember: (row, ctx) => {
      const value = simRow(row, ctx).value;
      if (value) addTaken(ctx.simsSeen, value);
    },
    fields: SIM_IMPORT_COLUMNS.filter((c) => c.key !== 'no').map((c) => ({
      key: c.key,
      label: c.header,
      required: c.required,
      validate: ['phoneNumber', 'createdFor', 'email', 'telegramUsername', 'status', 'dateChecked'].includes(c.key)
        ? simCheck(c.key)
        : undefined,
    })),
  },
  agents: {
    label: 'Agents',
    dedupeKeys: (r) => [(r.name ?? '').trim().toLowerCase(), agentPhoneIdentity(r.contactNumber)].filter(Boolean),
    fields: [
      { key: 'name', label: 'Name or business name', required: true, validate: (v, ctx) => (ctx.seenInFile.has(v.trim().toLowerCase()) ? 'Duplicated earlier in this file.' : null) },
      { key: 'agentType', label: 'Agent type (Individual / Agency)' },
      {
        key: 'contactNumber', label: 'Contact number', normalize: normalizePhone,
        validate: (v, ctx) => clash(agentPhoneIdentity(v), ctx, ctx.existingAgentPhones, 'Another agent already has this number.'),
      },
      { key: 'email', label: 'Email', validate: (v) => (v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? 'Not a valid email address.' : null) },
      { key: 'preferredChannel', label: 'Preferred channel' },
      { key: 'cooperationStatus', label: 'Cooperation status' },
      { key: 'startDate', label: 'Start date (YYYY-MM-DD)' },
      { key: 'agreementRef', label: 'Agreement reference' },
      { key: 'notes', label: 'Notes' },
    ],
  },
  'social-accounts': {
    label: 'Social media accounts',
    dedupeKeys: accountKeys,
    fields: [
      {
        key: 'platform', label: 'Platform', required: true,
        validate: (v, ctx) => (ctx.platformNames.has(v.trim().toLowerCase()) ? null : 'Unknown platform. Configure it under Brands & Team first.'),
      },
      {
        // May repeat: see accountKeys.
        key: 'username', label: 'Username or handle', required: true,
      },
      { key: 'displayName', label: 'Display name' },
      {
        key: 'platformAccountId', label: 'Platform account ID',
        validate: (v, ctx, row) => clash(idKey(row.platform ?? '', v), ctx, ctx.existingIdentities, 'An account with this platform ID already exists on that platform.'),
      },
      { key: 'assetType', label: 'Asset type' },
      {
        key: 'profileUrl', label: 'Profile URL',
        validate: (v, ctx) => clash(urlIdentity(v), ctx, ctx.existingIdentities, 'An account with this profile URL already exists.'),
      },
      { key: 'targetCountryCode', label: 'Target country (ISO-2)' },
      { key: 'contentLanguage', label: 'Content language' },
      { key: 'operationalStatus', label: 'Operational status' },
      { key: 'allocationStatus', label: 'Allocation status' },
      { key: 'loginEmailRef', label: 'Login email reference' },
      { key: 'notes', label: 'Notes' },
    ],
  },
};

interface PreviewRow {
  index: number;
  values: Record<string, string>;
  errors: { field: string; message: string }[];
}

export default function ImportPage() {
  const { data } = useCrmData();
  const { can } = useSession();
  const [entity, setEntity] = React.useState<Entity>('sims');
  const [raw, setRaw] = React.useState('');
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [committed, setCommitted] = React.useState<{ created: number; skipped: number } | null>(null);
  const commit = useImportCommit(entity);
  const spec = SPECS[entity];
  const simFallbackCountry = React.useMemo(() => {
    const counts = new Map<string, number>();
    (data?.sims ?? []).filter((x) => !x.archived).forEach((x) => counts.set(x.countryCode, (counts.get(x.countryCode) ?? 0) + 1));
    const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return busiest ?? data?.countries.find((c) => c.code === 'PH')?.code ?? data?.countries[0]?.code ?? null;
  }, [data]);

  const parsed = React.useMemo(() => (raw.trim() ? parseCSV(raw) : []), [raw]);
  const headers = parsed[0] ?? [];
  const bodyRows = parsed.slice(1);

  const rejectedColumns = React.useMemo(() => headers.filter(isForbiddenColumn), [headers]);

  // Auto-map headers whose names match a field key or label.
  React.useEffect(() => {
    if (!headers.length) return;
    const next: Record<string, string> = {};
    spec.fields.forEach((f) => {
      const found = headers.find(
        (h) => h.trim().toLowerCase() === f.key.toLowerCase() || h.trim().toLowerCase() === f.label.toLowerCase(),
      );
      if (found) next[f.key] = found;
    });
    setMapping(next);
  }, [headers, spec, entity]);

  const preview = React.useMemo<PreviewRow[]>(() => {
    if (!bodyRows.length || !data) return [];
    const ctx: Ctx = {
      simsTaken: takenBySims(data.sims),
      simsSeen: noneTaken(),
      countries: data.countries,
      fallbackCountryCode: simFallbackCountry,
      existingIdentities: new Set(
        data.socialAccounts.filter((a) => !a.archived).flatMap((a) => {
          const platform = data.platforms.find((p) => p.id === a.platformId)?.name ?? '';
          return [
            a.platformAccountId.trim() ? idKey(platform, a.platformAccountId) : '',
            urlIdentity(a.profileUrl),
          ].filter(Boolean);
        }),
      ),
      existingAgentPhones: new Set(
        data.agents.filter((a) => !a.archived).map((a) => agentPhoneIdentity(a.contactNumber)).filter(Boolean),
      ),
      platformNames: new Set(data.platforms.map((p) => p.name.toLowerCase())),
      seenInFile: new Set(),
    };

    return bodyRows.map((cells, i) => {
      const values: Record<string, string> = {};
      spec.fields.forEach((f) => {
        const col = mapping[f.key];
        const idx = col ? headers.indexOf(col) : -1;
        const rawValue = idx >= 0 ? (cells[idx] ?? '').trim() : '';
        values[f.key] = f.normalize ? f.normalize(rawValue) : rawValue;
      });

      const errors: { field: string; message: string }[] = [];
      spec.fields.forEach((f) => {
        const v = values[f.key];
        if (f.required && !v) {
          errors.push({ field: f.label, message: 'Required field is empty.' });
          return;
        }
        if (v && f.validate) {
          const msg = f.validate(v, ctx, values);
          if (msg) errors.push({ field: f.label, message: msg });
        }
      });

      spec.dedupeKeys(values, ctx).forEach((key) => ctx.seenInFile.add(key));
      spec.remember?.(values, ctx);

      return { index: i + 2, values, errors }; // +2 => 1-based with a header row
    });
  }, [bodyRows, headers, mapping, spec, data, simFallbackCountry]);

  const validRows = preview.filter((p) => p.errors.length === 0);
  const invalidRows = preview.filter((p) => p.errors.length > 0);

  const downloadTemplate = () => {
    downloadCSV(
      `${entity}-template`,
      toCSV([Object.fromEntries(spec.fields.map((f) => [f.key, '']))], spec.fields.map((f) => ({ key: f.key, header: f.key, value: (r: Record<string, string>) => r[f.key] }))),
    );
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    setRaw(text);
    setCommitted(null);
  };

  const runCommit = async () => {
    const result = await commit.mutateAsync({
      rows: validRows.map((r) => ({ rowNumber: r.index, ...r.values })),
      reason: `CSV import of ${spec.label}`,
      fallbackCountryCode: simFallbackCountry ?? undefined,
    });
    setCommitted(result);
  };

  if (!can('import:records')) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title="Import and data quality" />
        <EmptyState
          title="Your role cannot import data"
          description="Importing requires the import/export permission. Switch to System Administrator or Marketing Manager in the role preview to try this screen."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Import and data quality"
        description="Paste or upload a CSV, map its columns, review every row, then commit. Nothing is written until you commit, and existing records are never silently overwritten."
        actions={<Button variant="outline" size="sm" onClick={downloadTemplate}><Download /> Download template</Button>}
      />

      <SecurityNotice>
        Columns that look like secrets — password, token, API key, cookie, session, recovery or backup code, OTP — are
        rejected outright and never read, mapped or stored.
      </SecurityNotice>

      <SectionCard title="1 — Choose what you are importing">
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            id="import-entity"
            label="Record type"
            value={entity}
            onChange={(v) => { setEntity(v as Entity); setRaw(''); setCommitted(null); }}
            options={(Object.keys(SPECS) as Entity[]).map((e) => ({ value: e, label: SPECS[e].label }))}
            className="min-w-[16rem]"
          />
          <div className="flex flex-col gap-1">
            <Label htmlFor="import-file">Upload a CSV file</Label>
            <Input id="import-file" type="file" accept=".csv,text/csv" className="h-9 py-1.5"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }} />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-1.5">
          <Label htmlFor="import-raw">…or paste CSV content</Label>
          <Textarea id="import-raw" value={raw} onChange={(e) => { setRaw(e.target.value); setCommitted(null); }}
            className="min-h-[120px] font-mono text-[12px]"
            placeholder={`${spec.fields.slice(0, 4).map((f) => f.key).join(',')}\n…`} />
        </div>
      </SectionCard>

      {rejectedColumns.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/50 bg-danger-bg/50 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
          <div>
            <p className="text-[13px] font-semibold text-danger">Credential columns rejected</p>
            <p className="text-[12px]">
              These columns will not be imported under any mapping: {rejectedColumns.join(', ')}. Remove them from the
              file and re-upload.
            </p>
          </div>
        </div>
      )}

      {headers.length > 0 && (
        <SectionCard title="2 — Map columns" description="Unmapped optional fields are left empty. Required fields must be mapped.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {spec.fields.map((f) => (
              <div key={f.key} className="flex flex-col gap-1">
                <Label htmlFor={`map-${f.key}`}>
                  {f.label}
                  {f.required && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
                </Label>
                <NativeSelect
                  id={`map-${f.key}`}
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => setMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                >
                  <option value="">— Not mapped —</option>
                  {headers.filter((h) => !isForbiddenColumn(h)).map((h) => <option key={h} value={h}>{h}</option>)}
                </NativeSelect>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {preview.length > 0 && (
        <SectionCard
          title="3 — Preview before committing"
          description={`${validRows.length} row${validRows.length === 1 ? '' : 's'} ready, ${invalidRows.length} with errors. Only valid rows are imported.`}
          actions={
            <Button size="sm" onClick={runCommit} disabled={!validRows.length || commit.isPending}>
              <Upload /> {commit.isPending ? 'Importing…' : `Import ${validRows.length} row${validRows.length === 1 ? '' : 's'}`}
            </Button>
          }
        >
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Row</th>
                  <th scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Status</th>
                  {spec.fields.filter((f) => mapping[f.key]).map((f) => (
                    <th key={f.key} scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</th>
                  ))}
                  <th scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Issues</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 200).map((row) => (
                  <tr key={row.index} className={`border-b border-border last:border-0 ${row.errors.length ? 'bg-danger-bg/25' : ''}`}>
                    <td className="px-3 py-2 tabular text-muted-foreground">{row.index}</td>
                    <td className="px-3 py-2">
                      {row.errors.length
                        ? <Badge tone="danger">{row.errors.length} issue{row.errors.length === 1 ? '' : 's'}</Badge>
                        : <Badge tone="success">ready</Badge>}
                    </td>
                    {spec.fields.filter((f) => mapping[f.key]).map((f) => (
                      <td key={f.key} className="px-3 py-2">{row.values[f.key] || <span className="text-muted-foreground">—</span>}</td>
                    ))}
                    <td className="px-3 py-2">
                      {row.errors.length === 0 ? <span className="text-muted-foreground">—</span> : (
                        <ul className="flex flex-col gap-0.5">
                          {row.errors.map((e, i) => (
                            <li key={i} className="text-[12px] text-danger">
                              <span className="font-medium">{e.field}:</span> {e.message}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 200 && (
            <p className="mt-2 text-[12px] text-muted-foreground">Showing the first 200 of {preview.length} rows. All valid rows are imported on commit.</p>
          )}
        </SectionCard>
      )}

      {committed && (
        <SectionCard title="Import summary">
          <div className="flex flex-wrap items-center gap-4">
            <span className="flex items-center gap-2 text-[13px]">
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
              <strong className="tabular">{committed.created}</strong> record{committed.created === 1 ? '' : 's'} created
            </span>
            <span className="flex items-center gap-2 text-[13px]">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
              <strong className="tabular">{committed.skipped}</strong> row{committed.skipped === 1 ? '' : 's'} skipped as duplicates or invalid
            </span>
            <span className="text-[12px] text-muted-foreground">
              The import event is recorded in the audit history with the acting user and a row count.
            </span>
          </div>
        </SectionCard>
      )}

      {!raw.trim() && (
        <NotConnectedNotice what="There is no backend ingestion pipeline yet. Committing writes to the in-memory mock dataset for this browser tab only." />
      )}

      {data && (
        <p className="text-[12px] text-muted-foreground">
          Register sizes right now: {data.sims.length} SIMs · {data.agents.length} agents · {data.socialAccounts.length} accounts.
        </p>
      )}
    </div>
  );
}
