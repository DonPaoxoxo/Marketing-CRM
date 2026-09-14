// @vitest-environment jsdom
/** The SIM bulk upload, driven the way a person uses it: choose the team's
 *  sheet, read the preview, add the ready rows. Uses a CSV of the team's own
 *  rows — the .xlsx reader is exercised separately against real files. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_ORIGIN, handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { SimBulkUploadDialog } from './SimBulkUploadDialog';

let sent: { rows: Record<string, unknown>[]; fallbackCountryCode?: string } | null = null;
const server = setupServer(
  http.post(`${API_ORIGIN}/api/import/sims`, async ({ request }) => {
    sent = (await request.clone().json()) as typeof sent;
    return undefined; // let the mock API answer as usual
  }),
  ...handlers,
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => cleanup());

const SHEET = [
  'No.,SIM Number,Created For,Email,Telegram Username,Status,Date Checked,Others,Remarks',
  '1,639175550420,Email + Telegram,samplea001@gmail.com,@demouser,Active,,,DEV TG',
  '2,639175551386,Email + Telegram,sampleperson418@gmail.com,@demo_user_418,Active,,,DEV TG',
  '3,,,,,,,,',
  '4,639175553878,Email,sampleperson0002@gmail.com,,Dead / Patay,,,dead',
  '5,639175550420,Telegram,,@demouser,Active,,,repeat of 1',
  '6,12345,,,,Sleeping,,,',
].join('\n');

beforeEach(() => {
  loadFixtures();
  sent = null;
  // Make the Philippines the register's main country, as it is for the team.
  db.sims.forEach((s) => { s.countryCode = 'PH'; });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <SimBulkUploadDialog open onOpenChange={() => undefined} />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

async function chooseSheet() {
  // Wait for the workspace, so the preview has countries and SIMs to check against.
  await waitFor(() => expect((screen.getByLabelText(/Country for numbers without a country code/) as HTMLSelectElement).value).toBe('PH'));
  const file = new File([SHEET], 'SIM sheet.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('SIM spreadsheet file'), { target: { files: [file] } });
  await screen.findByText('SIM sheet.csv');
}

describe('SIM bulk upload', () => {
  it('previews the team sheet: ready rows, problems named, blank rows skipped', async () => {
    mount();
    await chooseSheet();

    expect(screen.getByText(/3 ready/)).toBeTruthy();
    expect(screen.getByText(/2 with problems/)).toBeTruthy();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(5); // row 3 was blank

    expect(rows[0].textContent).toContain('+639175550420');
    expect(rows[0].textContent).toContain('https://t.me/demouser');
    expect(rows[2].textContent).toContain('Inactive');
    expect(rows[2].textContent).toContain('from “Dead / Patay”');
    expect(rows[3].textContent).toMatch(/appears earlier in this file/);
    expect(rows[4].textContent).toMatch(/Status:.*Active or Dead \/ Patay/);
  });

  it('adds only the ready rows, with their sheet row numbers', async () => {
    mount();
    await chooseSheet();
    const before = db.sims.length;

    fireEvent.click(screen.getByRole('button', { name: /Add 3 SIMs/ }));
    expect(await screen.findByText(/3 SIMs added from SIM sheet\.csv/)).toBeTruthy();

    expect(sent!.fallbackCountryCode).toBe('PH');
    expect(sent!.rows.map((r) => r.rowNumber)).toEqual([2, 3, 5]);
    expect(db.sims.length).toBe(before + 3);
    expect(db.sims.find((s) => s.phoneNumber === '+639175553878')).toMatchObject({
      operationalStatus: 'Inactive', createdFor: 'Email', email: 'sampleperson0002@gmail.com', notes: 'dead',
    });
  });

  it('explains a missing SIM Number column instead of guessing', async () => {
    mount();
    await waitFor(() => expect((screen.getByLabelText(/Country for numbers without a country code/) as HTMLSelectElement).value).toBe('PH'));
    const file = new File(['No.,Number,Remarks\n1,639175550420,x'], 'wrong.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByLabelText('SIM spreadsheet file'), { target: { files: [file] } });
    expect(await screen.findByText(/missing a required column/)).toBeTruthy();
    expect(screen.getByText(/“SIM Number”/)).toBeTruthy();
  });
});
