// @vitest-environment jsdom
/** Data Leads, driven the way a member actually uses it: filter the register,
 *  open a lead, and reach out — which must mark it Contacted in the same
 *  dialog, not just in a table row that has since scrolled away. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import DataLeadsPage from './DataLeads';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => loadFixtures());
afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <MemoryRouter>
          <DataLeadsPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return qc;
}

describe('Data Leads register', () => {
  it('lists the seeded leads and narrows them by platform, country and status', async () => {
    mount();
    await screen.findByText('DK Online Tech');
    expect(screen.getByText(/^12 records$/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'ID' } });
    await waitFor(() => expect(screen.getByText(/^3 records$/)).toBeTruthy());
    expect(screen.queryByText('DK Online Tech')).toBeNull();
    expect(screen.getByText('Trik Slot Gacor')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Not interested' } });
    await waitFor(() => expect(screen.getByText(/^1 record$/)).toBeTruthy());
    expect(screen.getByText('@crypto_slot_id')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
    // Telugu Investor SK, Online Help (both IN/YouTube) and win.fast.pk (PK/Instagram).
    fireEvent.change(screen.getByLabelText(/Search records/), { target: { value: 'rummy' } });
    await waitFor(() => expect(screen.getByText(/^3 records$/)).toBeTruthy());
  });

  it('shows the channel link in the table, and narrows by who it is assigned to', async () => {
    mount();
    await screen.findByText('DK Online Tech');
    const row = screen.getByRole('row', { name: /DK Online Tech/ });
    const channelLink = within(row).getByRole('link', { name: /youtube\.com\/channel\/UCaZmbb9RVT1WTnyk6OQzs5A/ });
    expect(channelLink.getAttribute('href')).toBe('https://www.youtube.com/channel/UCaZmbb9RVT1WTnyk6OQzs5A');

    // Seeded: DK Online Tech -> CJ, Lucky Spin PK -> CJ — 2 leads assigned to CJ.
    fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'CJ' } });
    await waitFor(() => expect(screen.getByText(/^2 records$/)).toBeTruthy());
    expect(screen.getByText('DK Online Tech')).toBeTruthy();
    expect(screen.getByText('Lucky Spin PK')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Assigned to'), { target: { value: 'unassigned' } });
    await waitFor(() => expect(screen.queryByText('DK Online Tech')).toBeNull());
    expect(screen.getByText('Tamil Tech Today')).toBeTruthy(); // seeded with no assignee
  });

  it('assigns a lead to an outreach owner straight from the table, without opening the detail dialog', async () => {
    mount();
    await screen.findByText('Tamil Tech Today');
    const row = screen.getByRole('row', { name: /Tamil Tech Today/ });

    fireEvent.change(within(row).getByLabelText('Assign Tamil Tech Today'), { target: { value: 'Ace' } });
    await waitFor(() => expect(db.dataLeads.find((l) => l.creator === 'Tamil Tech Today')?.assignedTo).toBe('Ace'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a lead on row click with its evidence and an outreach link', async () => {
    mount();
    await screen.findByText('DK Online Tech');
    fireEvent.click(screen.getByRole('row', { name: /DK Online Tech/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/YouTube/)).toBeTruthy();
    expect(within(dialog).getByText(/Casino\/Betting/)).toBeTruthy();
    expect(within(dialog).getByText(/Colour prediction app withdrawal trick/)).toBeTruthy();

    const emailLink = within(dialog).getByRole('link', { name: /Email dkumar11255@gmail\.com/ });
    expect(emailLink.getAttribute('href')).toMatch(/^mailto:dkumar11255%40gmail\.com\?subject=/);
    expect(within(dialog).getByText('Not yet')).toBeTruthy(); // not contacted yet
    expect((within(dialog).getByLabelText('Assigned to') as HTMLSelectElement).value).toBe('CJ'); // seeded assignee
  });

  it('reassigns a lead from inside the detail dialog', async () => {
    mount();
    await screen.findByText('Tamil Tech Today'); // seeded with no assignee
    fireEvent.click(screen.getByRole('row', { name: /Tamil Tech Today/ }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Assigned to') as HTMLSelectElement).value).toBe('');

    fireEvent.change(within(dialog).getByLabelText('Assigned to'), { target: { value: 'Godwin' } });
    await waitFor(() => expect(db.dataLeads.find((l) => l.creator === 'Tamil Tech Today')?.assignedTo).toBe('Godwin'));
  });

  it('marks a lead Contacted — in the still-open dialog — the first time its outreach link is used', async () => {
    mount();
    await screen.findByText('DK Online Tech');
    fireEvent.click(screen.getByRole('row', { name: /DK Online Tech/ }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.click(within(dialog).getByRole('link', { name: /Email/ }));

    await waitFor(() => expect(db.dataLeads.find((l) => l.creator === 'DK Online Tech')?.status).toBe('Contacted'));
    // The open dialog reflects the change once the refetch lands — not just the
    // mock store, and not just the table row underneath it. Scoped to a <span>:
    // the status <select> also has an option literally named "Contacted".
    await waitFor(() => expect(within(dialog).getByText('Contacted', { selector: 'span' })).toBeTruthy(), { timeout: 3000 });
    expect(within(dialog).queryByText('Not yet')).toBeNull();
  });

  it('a lead already Contacted keeps its original contact stamp on a later status change', async () => {
    mount();
    await screen.findByText('Online Help'); // seeded as already Contacted
    fireEvent.click(screen.getByRole('row', { name: /Online Help/ }));
    const dialog = await screen.findByRole('dialog');
    const before = db.dataLeads.find((l) => l.creator === 'Online Help')!.contactedAt;

    fireEvent.change(within(dialog).getByLabelText('Status'), { target: { value: 'Converted' } });
    await waitFor(() => expect(db.dataLeads.find((l) => l.creator === 'Online Help')?.status).toBe('Converted'), { timeout: 3000 });
    expect(db.dataLeads.find((l) => l.creator === 'Online Help')?.contactedAt).toBe(before);
  });

  it('opens the bulk upload dialog with the expected column list', async () => {
    mount();
    await screen.findByText('DK Online Tech');
    fireEvent.click(screen.getByRole('button', { name: /Bulk upload/ }));
    expect(await screen.findByText('Bulk upload Data Leads')).toBeTruthy();
    expect(screen.getByText(/ChannelURL/)).toBeTruthy();
    expect(screen.getByText(/PromoConfidence/)).toBeTruthy();
  });
});
