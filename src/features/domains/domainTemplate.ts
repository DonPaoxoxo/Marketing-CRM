/** The downloadable domain bulk-upload template.
 *
 *  Loaded only when someone asks for it: the spreadsheet writer is a separate
 *  chunk, so everyone who never downloads the template never pays for it. */

import { DOMAIN_IMPORT_COLUMNS } from '@/lib/domain-import';
import { SHEET_LIMITS } from '@/lib/sheet';

export async function downloadDomainTemplate(): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');

  const header = DOMAIN_IMPORT_COLUMNS.map((c) => ({
    value: c.header,
    fontWeight: 'bold' as const,
    backgroundColor: c.required ? '#D9EFEA' : '#EEF0F2',
  }));

  const guide = [
    [{ value: 'Column', fontWeight: 'bold' as const }, { value: 'Required', fontWeight: 'bold' as const }, { value: 'What to write', fontWeight: 'bold' as const }],
    ...DOMAIN_IMPORT_COLUMNS.map((c) => [{ value: c.header }, { value: c.required ? 'Yes' : 'No' }, { value: c.help }]),
    [],
    [{ value: 'Good to know', fontWeight: 'bold' as const }],
    [{ value: 'Fill in the "Domains" sheet, one domain per row. Keep the header row as it is — the registrar export already matches it.' }],
    [{ value: `Up to ${SHEET_LIMITS.maxRows.toLocaleString()} rows per file. A domain already in the register is skipped, never overwritten.` }],
    [{ value: 'Rows with a problem are shown before anything is saved, with the reason, so they can be fixed first.' }],
    [{ value: 'Never write registrar logins, passwords or API keys anywhere in this file.' }],
  ];

  await writeExcelFile([
    {
      sheet: 'Domains',
      data: [header],
      // Domain · Country · UID · Registration Time · Expire Date · Registrar · Status · Category · Nameservers
      columns: [{ width: 28 }, { width: 12 }, { width: 10 }, { width: 18 }, { width: 18 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 50 }],
      stickyRowsCount: 1,
    },
    {
      sheet: 'How to fill',
      data: guide,
      columns: [{ width: 20 }, { width: 10 }, { width: 110 }],
    },
  ]).toFile('Domain bulk upload template.xlsx');
}
