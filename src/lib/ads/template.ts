/** The Ads Monitoring import template, as sheet data for write-excel-file.
 *
 *  Built from IMPORT_COLUMNS, so the template and the importer can never drift
 *  apart. The same data is written in the browser (download) and in tests
 *  (round trip through the real importer). */

import { IMPORT_COLUMNS, EXAMPLE_REFERENCE, IMPORT_LIMITS } from './import';
import { CAMPAIGN_STATUSES } from './campaign';
import { OBJECTIVES } from './metrics';
import { CURRENCIES } from './money';

type Cell = { value: string | number; fontWeight?: 'bold'; backgroundColor?: string; color?: string; wrap?: boolean } | null;

const bold = (value: string, backgroundColor?: string): Cell => ({ value, fontWeight: 'bold', ...(backgroundColor ? { backgroundColor } : {}) });

export function adsTemplateSheets(platforms: readonly { name: string }[], countries: readonly { code: string; name: string }[]) {
  const header = IMPORT_COLUMNS.map((c) => bold(c.header, c.requirement === 'always' ? '#D9EFEA' : c.requirement === 'new-campaign' ? '#FFF3D6' : '#EEF0F2'));
  const example = IMPORT_COLUMNS.map((c): Cell => (c.example === '' ? null : { value: c.example, color: '#8A5A00' }));

  const requirementLabel = { always: 'Always required', 'new-campaign': 'Required for a new campaign', optional: 'Optional' } as const;
  const instructions: Cell[][] = [
    [bold('Ads Monitoring — import instructions')],
    [],
    [bold('How the import works')],
    [{ value: '1. Fill in the "Daily Tracker" sheet: one row per campaign per report date. Keep the header row exactly as it is.' }],
    [{ value: `2. The example row (Campaign Reference "${EXAMPLE_REFERENCE}") is skipped automatically. Delete it or leave it.` }],
    [{ value: '3. Upload the workbook in Ads Monitoring → Upload Excel. Every row is checked and shown before anything is saved.' }],
    [{ value: '4. Rows for dates that already exist are skipped by default. Choose "update existing" to replace them — blank cells keep the saved values.' }],
    [{ value: '5. Nothing is saved until you confirm. Confirmed valid rows are saved together; if anything fails, none are.' }],
    [],
    [bold('Formats')],
    [{ value: 'Dates: YYYY-MM-DD, e.g. 2026-09-05.' }],
    [{ value: 'Money: numbers only — no currency symbol, no thousands separators, e.g. 1147.64.' }],
    [{ value: 'Counts: whole numbers. Leave a metric blank when it is unknown — blank is "not available", never zero.' }],
    [{ value: 'Daily values only: each row is that single day, never a running total.' }],
    [{ value: `Limits: up to ${IMPORT_LIMITS.maxRows.toLocaleString()} rows and 5 MB per workbook. Formulas are read as their saved values; macros are never run.` }],
    [],
    [bold('Ownership and rules')],
    [{ value: 'You become the owner of every campaign and record you import. There is no owner column — ownership is never taken from the file.' }],
    [{ value: 'You can add rows only to campaigns you created (the System Owner can add to any).' }],
    [{ value: 'Campaign details on rows for an existing campaign must match it; the import never changes a campaign. Conflicts are rejected for correction.' }],
    [{ value: 'Brands and social accounts must already exist in the CRM; unknown references are rejected, never created.' }],
    [{ value: 'Creatives (1080 × 1350 images) and reference documents are uploaded separately on the campaign page, not in this file.' }],
    [{ value: 'Reach is summed day by day; the CRM labels it "Sum of daily reach" — it is not deduplicated unique reach.' }],
    [],
    [bold('Columns'), bold('Requirement'), bold('What to write')],
    ...IMPORT_COLUMNS.map((c): Cell[] => [{ value: c.header }, { value: requirementLabel[c.requirement] }, { value: c.help }]),
  ];

  const longest = Math.max(CURRENCIES.length, OBJECTIVES.length, CAMPAIGN_STATUSES.length, platforms.length, countries.length);
  const allowed: Cell[][] = [
    [bold('Currency'), bold('Objective'), bold('Status'), bold('Platform'), bold('Target Country (code)'), bold('Country name')],
    ...Array.from({ length: longest }, (_, i): Cell[] => [
      CURRENCIES[i] ? { value: `${CURRENCIES[i].code} — ${CURRENCIES[i].label}` } : null,
      OBJECTIVES[i] ? { value: OBJECTIVES[i] } : null,
      CAMPAIGN_STATUSES[i] ? { value: CAMPAIGN_STATUSES[i] } : null,
      platforms[i] ? { value: platforms[i].name } : null,
      countries[i] ? { value: countries[i].code } : null,
      countries[i] ? { value: countries[i].name } : null,
    ]),
    [],
    [{ value: 'RMB is accepted and saved as CNY (the same currency).' }],
    [{ value: 'Imported campaigns start as Active; change the status on the campaign page.' }],
    [{ value: 'Brand Reference: a brand ID (BRD-…) or its exact name. Social Account Reference: an account ID (ACC-…) or its profile URL.' }],
  ];

  return [
    { sheet: 'Daily Tracker', data: [header, example], columns: IMPORT_COLUMNS.map((c) => ({ width: Math.max(12, c.header.length + 4) })), stickyRowsCount: 1 },
    { sheet: 'Instructions', data: instructions, columns: [{ width: 34 }, { width: 28 }, { width: 110 }] },
    { sheet: 'Allowed Values', data: allowed, columns: [{ width: 44 }, { width: 18 }, { width: 14 }, { width: 22 }, { width: 22 }, { width: 18 }] },
  ];
}
