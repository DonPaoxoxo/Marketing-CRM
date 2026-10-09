/** The downloadable Data Leads bulk-upload template.
 *
 *  Loaded only when someone asks for it: the spreadsheet writer is a separate
 *  chunk, so everyone who never downloads the template never pays for it.
 *
 *  Ships with one filled example row — a placeholder, not a real scraped
 *  contact — so the shape of each column is obvious without cross-referencing
 *  the help text. Country, Platform (for a blank row) and Niche are chosen in
 *  the upload window itself, not written into the sheet. */

import { LEAD_IMPORT_COLUMNS } from '@/lib/lead-import';
import { SHEET_LIMITS } from '@/lib/sheet';

const EXAMPLE_ROW: Record<string, string> = {
  Platform: 'YouTube',
  Creator: 'Example Creator Name',
  ChannelURL: 'https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx',
  Subscribers: '52000',
  Tier: 'micro-nano (10k-100k)',
  Keyword: 'rummy',
  PromoConfidence: 'High',
  EvidenceVideoTitle: 'Title of the video that shows the promotion',
  EvidenceVideoURL: 'https://www.youtube.com/watch?v=xxxxxxxxxxx',
  PublicEmail: 'example@gmail.com',
  PublicTelegram: 't.me/exampleusername',
  PublicInstagram: 'instagram.com/exampleusername',
  Status: 'Not contacted',
};

export async function downloadLeadTemplate(): Promise<void> {
  const { default: writeExcelFile } = await import('write-excel-file/browser');

  const header = LEAD_IMPORT_COLUMNS.map((c) => ({
    value: c.header,
    fontWeight: 'bold' as const,
    backgroundColor: c.required ? '#D9EFEA' : '#EEF0F2',
  }));
  const example = LEAD_IMPORT_COLUMNS.map((c) => ({ value: EXAMPLE_ROW[c.header] ?? '', textColor: '#8A8F98' }));

  const guide = [
    [{ value: 'Column', fontWeight: 'bold' as const }, { value: 'Required', fontWeight: 'bold' as const }, { value: 'What to write', fontWeight: 'bold' as const }],
    ...LEAD_IMPORT_COLUMNS.map((c) => [{ value: c.header }, { value: c.required ? 'Yes' : 'No' }, { value: c.help }]),
    [],
    [{ value: 'Good to know', fontWeight: 'bold' as const }],
    [{ value: 'Fill in the "Leads" sheet, one creator per row, and replace the grey example row — it is a placeholder, not a real lead.' }],
    [{ value: 'Country and Niche are not columns here — you choose them once in the upload window and they apply to every row in the file, matching the team\'s filename convention: {country}_{niche}_creator_leads_{platform}_v{n}.' }],
    [{ value: 'Platform is also chosen once in the upload window as the default — only fill the Platform column per row if a single file mixes platforms.' }],
    [{ value: `Up to ${SHEET_LIMITS.maxRows.toLocaleString()} rows per file. A creator already in the register for that platform and country (by Channel URL) is skipped, never overwritten.` }],
    [{ value: 'Rows with a problem are shown before anything is saved, with the reason, so they can be fixed first.' }],
    [{ value: 'PublicEmail, PublicTelegram and PublicInstagram are kept exactly as scraped — never verified, never normalised.' }],
  ];

  await writeExcelFile([
    {
      sheet: 'Leads',
      data: [header, example],
      // Platform · Creator · ChannelURL · Subscribers · Tier · Keyword · PromoConfidence ·
      // EvidenceVideoTitle · EvidenceVideoURL · PublicEmail · PublicTelegram · PublicInstagram · Status
      columns: [
        { width: 12 }, { width: 24 }, { width: 44 }, { width: 12 }, { width: 20 }, { width: 16 }, { width: 14 },
        { width: 44 }, { width: 44 }, { width: 26 }, { width: 24 }, { width: 24 }, { width: 14 },
      ],
      stickyRowsCount: 1,
    },
    {
      sheet: 'How to fill',
      data: guide,
      columns: [{ width: 20 }, { width: 10 }, { width: 110 }],
    },
  ]).toFile('Data Leads bulk upload template.xlsx');
}
