// @vitest-environment jsdom
/** The Agents register keeps archived agents apart, with when and why. */

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';
import AgentsPage from './Agents';

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
  db.agents.forEach((a) => { a.archived = false; });
  // Keep the table small: jsdom is slow with large tables.
  db.agents.splice(4);
  const retired = db.agents[0];
  retired.archived = true;
  db.auditEntries.unshift({
    id: 'AUD-9999', actorId: 'TM-01', actorName: 'Priya Raghunathan', actorRole: 'System Administrator',
    timestamp: '2026-09-12T10:00:00.000Z', recordType: 'Agent', recordId: retired.id, recordLabel: retired.name,
    action: 'archive', reason: 'Stopped working with us', changes: [{ field: 'archived', from: 'false', to: 'true' }],
  });
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/agents']}>
            <Routes><Route path="/agents" element={<AgentsPage />} /></Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Agents: Active | Archived', () => {
  it('shows live agents by default and archived ones, with when and why, on request', async () => {
    mount();
    const active = await screen.findByRole('button', { name: 'Active (3)' }, { timeout: 8000 });
    expect(active.getAttribute('aria-pressed')).toBe('true');
    const retired = db.agents[0];
    expect(screen.queryByText(retired.name)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Archived (1)' }));
    const table = await screen.findByRole('table', {}, { timeout: 8000 });
    expect(await within(table).findByText(retired.name, {}, { timeout: 8000 })).toBeTruthy();
    expect(within(table).getByText(/Sep 12, 2026 · Priya Raghunathan/)).toBeTruthy();
    expect(within(table).getByText('Stopped working with us')).toBeTruthy();
    expect(screen.getByText('1 record')).toBeTruthy();
  });
});
