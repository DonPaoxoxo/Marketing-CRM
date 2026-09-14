// @vitest-environment jsdom
/** The Domains register keeps archived domains apart, with when and why, and can archive from the row. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';
import DomainsPage from './Domains';

const server = setupServer(...handlers);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterAll(() => server.close());
afterEach(() => cleanup());
beforeEach(() => {
  loadFixtures();
  db.domains.forEach((d) => { d.archived = false; });
  // Keep the table small: jsdom is slow with large tables.
  db.domains.splice(4);
  const lapsed = db.domains[0];
  lapsed.archived = true;
  db.auditEntries.unshift({
    id: 'AUD-9998', actorId: 'TM-01', actorName: 'Priya Raghunathan', actorRole: 'System Administrator',
    timestamp: '2026-09-12T10:00:00.000Z', recordType: 'Domain', recordId: lapsed.id, recordLabel: lapsed.domainName,
    action: 'archive', reason: 'Registration lapsed', changes: [{ field: 'archived', from: 'false', to: 'true' }],
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/domains']}>
            <Routes><Route path="/domains" element={<DomainsPage />} /></Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Domains: Active | Archived', () => {
  it('shows archived domains apart, with when and why', async () => {
    mount();
    const active = await screen.findByRole('button', { name: 'Active (3)' }, { timeout: 8000 });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    const lapsed = db.domains[0];
    expect(screen.queryByText(lapsed.domainName)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    const table = await screen.findByRole('table', {}, { timeout: 8000 });
    expect(await within(table).findByText(lapsed.domainName, {}, { timeout: 8000 })).toBeTruthy();
    expect(within(table).getByText(/Sep 12, 2026 · Priya Raghunathan/)).toBeTruthy();
    expect(within(table).getByText('Registration lapsed')).toBeTruthy();
    expect(within(table).getByRole('button', { name: /Restore/ })).toBeTruthy();
  });

  it('archives a domain from its row with a written reason', async () => {
    mount();
    const target = db.domains[1];
    fireEvent.click(await screen.findByRole('button', { name: `Archive ${target.domainName}` }, { timeout: 8000 }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Moved to a new registrar account' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Archive|Confirm/ }));
    await waitFor(() => expect(target.archived).toBe(true), { timeout: 8000 });
    expect(await screen.findByRole('button', { name: 'Archived (2)' }, { timeout: 8000 })).toBeTruthy();
  });
});
