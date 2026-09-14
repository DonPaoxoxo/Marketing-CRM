// @vitest-environment jsdom
/** The domain bulk upload, driven the way a person uses it: choose the
 *  registrar export, read the preview, add the ready rows. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_ORIGIN, handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { BOOTSTRAP_KEY } from '@/hooks/useData';
import { DomainBulkUploadDialog } from './DomainBulkUploadDialog';

let sent: { rows: Record<string, unknown>[]; overwrite?: boolean } | null = null;
const server = setupServer(
  http.post(`${API_ORIGIN}/api/import/domains`, async ({ request }) => {
    sent = (await request.clone().json()) as typeof sent;
    return undefined; // let the mock API answer as usual
  }),
  ...handlers,
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => cleanup());
beforeEach(() => { loadFixtures(); sent = null; });

const sheet = (existing: string) => [
  'Domain,Country,UID,Registration Time,Expire Date,Registrar,Status,Category,Nameservers',
  'samplegamehub.com,India,241089,9/8/2026 14:40,9/8/2027 14:40,RealTime,OK,Ungrouped,"chad.ns.cloudflare.com,clarissa.ns.cloudflare.com"',
  'demowiki.com,Available,241089,7/13/2026 22:07,7/13/2027 22:07,RealTime,OK,Ungrouped,"a5.share-dns.com,b5.share-dns.net"',
  ',,,,,,,,',
  `${existing},Indonesia,241089,8/25/2026 12:46,8/25/2027 12:46,Gname,OK,Ungrouped,`,
  'sampleofficial.com,Pakistan,241089,8/17/2026 13:55,8/17/2027 13:55,Gname,OK,Ungrouped,',
].join('\n');

async function mountAndChoose() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <DomainBulkUploadDialog open onOpenChange={() => undefined} />
      </SessionProvider>
    </QueryClientProvider>,
  );
  // Wait for the workspace, so the preview knows which domains are registered.
  await waitFor(() => expect(qc.getQueryData(BOOTSTRAP_KEY)).toBeTruthy());
  const existing = db.domains[0].domainName;
  const file = new File([sheet(existing)], 'domains.csv', { type: 'text/csv' });
  fireEvent.change(screen.getByLabelText('Domain spreadsheet file'), { target: { files: [file] } });
  await screen.findByText('domains.csv');
  return existing;
}

describe('domain bulk upload', () => {
  it('previews the export: ready rows, problems named, blank rows skipped', async () => {
    await mountAndChoose();
    expect(screen.getByText(/2 new/)).toBeTruthy();
    expect(screen.getByText(/1 row is already in the register and will be skipped/)).toBeTruthy();
    expect(screen.getByText(/2 with problems/)).toBeTruthy();

    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('samplegamehub.com');
    expect(rows[0].textContent).not.toContain('from “OK”'); // OK is simply Active
    expect(rows[1].textContent).toContain('Available');
    expect(rows[2].textContent).toMatch(/already in the register/);
    expect(rows[3].textContent).toMatch(/Country:.*India, Indonesia, Available/);
  });

  it('adds only the ready rows, with their registrar details', async () => {
    await mountAndChoose();
    const before = db.domains.length;

    fireEvent.click(screen.getByRole('button', { name: /Add 2 domains/ }));
    expect(await screen.findByText(/2 domains added from domains\.csv/)).toBeTruthy();

    expect(sent!.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(db.domains.length).toBe(before + 2);
    expect(db.domains.find((d) => d.domainName === 'samplegamehub.com')).toMatchObject({
      targetCountry: 'India', registeredDate: '2026-09-08', expirationDate: '2027-09-08', status: 'Active',
      registrar: 'RealTime', registrarUid: '241089', category: 'Ungrouped',
      nameservers: 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com',
    });
  });

  it('updates an existing domain only after updating is ticked, showing each change first', async () => {
    const target = db.domains[0];
    target.targetCountry = 'India';
    target.registrar = 'RealTime';
    target.notes = 'keep me';
    const existing = await mountAndChoose();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Update domains already in the register' }));
    expect(await screen.findByText(/1 will be updated/)).toBeTruthy();
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[2].textContent).toMatch(/Will update/);
    expect(rows[2].textContent).toMatch(/Country: India → Indonesia/);
    expect(rows[2].textContent).toMatch(/Registrar: RealTime → Gname/);
    expect(rows[2].textContent).not.toMatch(/Nameservers:/); // blank cell keeps the current value

    fireEvent.click(screen.getByRole('button', { name: /Add 2, update 1 domains/ }));
    expect(await screen.findByText(/2 domains added, 1 domain updated from domains\.csv/)).toBeTruthy();
    expect(sent).toMatchObject({ overwrite: true });

    const after = db.domains.find((d) => d.domainName === existing)!;
    expect(after).toMatchObject({ id: target.id, targetCountry: 'Indonesia', registrar: 'Gname', notes: 'keep me' });
    expect(db.auditEntries.some((a) => a.recordId === target.id && a.changes.some((c) => c.field === 'targetCountry' && c.from === 'India'))).toBe(true);
  });
});
