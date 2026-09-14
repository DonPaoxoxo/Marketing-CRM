// @vitest-environment jsdom
/** Access as a staff member sees it: the admin-only pages are locked and the
 *  agent Edit button works only on agents they manage. */

import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider, useSession } from '@/hooks/useSession';
import { RequirePermission } from '@/components/common/AdminOnly';
import type { RoleName } from '@/lib/types';
import DomainsPage from './Domains';
import AgentDetailPage from './AgentDetail';

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
beforeEach(() => loadFixtures());
afterEach(() => cleanup());

/** The preview session switches role; the actor follows (Staff is TM-04). */
function As({ role, children }: { role: RoleName; children: React.ReactNode }) {
  const { role: current, setRole } = useSession();
  React.useEffect(() => { setRole(role); }, [role, setRole]);
  return current === role ? <>{children}</> : null;
}

function mount(role: RoleName, ui: React.ReactNode, path: string, route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <As role={role}>
            <MemoryRouter initialEntries={[route]}>
              <Routes><Route path={path} element={ui} /></Routes>
            </MemoryRouter>
          </As>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('as Marketing Staff', () => {
  it('cannot open Domains', async () => {
    mount('Marketing Staff', <RequirePermission permission="access:domains"><DomainsPage /></RequirePermission>, '/domains', '/domains');
    expect(await screen.findByText('You do not have access to this area')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: /Domains/ })).toBeNull();
  });

  it('can edit an agent they manage, and not one managed by someone else', async () => {
    const [mine, theirs] = db.agents.filter((a) => !a.archived);
    mine.managerId = 'TM-04';
    theirs.managerId = 'TM-05';

    mount('Marketing Staff', <AgentDetailPage />, '/agents/:id', `/agents/${mine.id}`);
    const edit = await screen.findByRole('button', { name: /Edit/ });
    expect((edit as HTMLButtonElement).disabled).toBe(false);
    cleanup();

    mount('Marketing Staff', <AgentDetailPage />, '/agents/:id', `/agents/${theirs.id}`);
    const locked = await screen.findByRole('button', { name: /Edit/ });
    expect((locked as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Only Siti Nurhaliza \(the assigned manager\) or the System Administrator can edit this agent\./)).toBeTruthy();
  });
});
