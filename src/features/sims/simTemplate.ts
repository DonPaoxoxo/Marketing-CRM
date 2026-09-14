/** The downloadable SIM bulk-upload template.
 *
 *  Loaded only when someone asks for it: the spreadsheet writer is a separate
 *  chunk, so everyone who never downloads the template never pays for it. */

import type { Country } from '@/lib/types';
import { SIM_IMPORT_COLUMNS, SIM_IMPORT_LIMITS } from '@/lib/sim-import';

export async function downloadSimTemplate(countries: readonly Country[]): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');

  const header = SIM_IMPORT_COLUMNS.map((c) => ({
    value: c.header,
    fontWeight: 'bold' as const,
    backgroundColor: c.required ? '#D9EFEA' : '#EEF0F2',
  }));

  const guide = [
    [{ value: 'Column', fontWeight: 'bold' as const }, { value: 'Required', fontWeight: 'bold' as const }, { value: 'What to write', fontWeight: 'bold' as const }],
    ...SIM_IMPORT_COLUMNS.map((c) => [{ value: c.header }, { value: c.required ? 'Yes' : 'No' }, { value: c.help }]),
    [],
    [{ value: 'Countries in this workspace', fontWeight: 'bold' as const }],
    ...countries.map((c) => [{ value: c.name }, { value: c.code }, { value: c.dialCode }]),
    [],
    [{ value: 'Good to know', fontWeight: 'bold' as const }],
    [{ value: 'Fill in the "SIMs" sheet, one SIM per row. Keep the header row as it is.' }],
    [{ value: `Up to ${SIM_IMPORT_LIMITS.maxRows.toLocaleString()} rows per file. A number already in the register is skipped, never overwritten.` }],
    [{ value: 'Rows with a problem are shown before anything is saved, with the reason, so they can be fixed first.' }],
    [{ value: 'Never write PINs, PUKs or passwords anywhere in this file.' }],
  ];

  await writeExcelFile([
    {
      sheet: 'SIMs',
      // No pre-formatted blank rows: the writer drops empty cells, formatting and
      // all, so a "text" phone column cannot be prepared in advance. The upload
      // reads Excel's numeric phone cells correctly instead (see readSimPhone).
      data: [header],
      // No. · SIM Number · Created For · Email · Telegram Username · Status · Date Checked · Others · Remarks
      columns: [{ width: 6 }, { width: 16 }, { width: 18 }, { width: 30 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 30 }],
      stickyRowsCount: 1,
    },
    {
      sheet: 'How to fill',
      data: guide,
      columns: [{ width: 26 }, { width: 10 }, { width: 110 }],
    },
  ]).toFile('SIM bulk upload template.xlsx');
}
