// @vitest-environment jsdom
/** Verdict and Payment beside Proof on the Agents table: the System Administrator sets them, others read them. */

import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider, useSession } from '@/hooks/useSession';
import type { RoleName } from '@/lib/types';
import AgentsPage from './Agents';

const server = setupServer(...handlers);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'bypass' });
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  // Radix menus open on pointer events that jsdom lacks.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});
afterAll(() => server.close());
afterEach(() => cleanup());
beforeEach(() => {
  loadFixtures();
  db.agents.forEach((a) => { a.archived = false; });
  db.agents.splice(3);
  db.agentProofs.splice(0, db.agentProofs.length, {
    id: 'PRF-0001', agentId: db.agents[0].id, postUrl: 'https://t.me/SAMPLECHANNEL6/61', mimeType: 'image/png', sizeBytes: 12,
    uploadedById: 'TM-04', uploadedByName: 'Rohit Menon',
    verdict: null, verdictReason: '', reviewedByName: '', reviewedAt: null, payment: 'Not paid', paidByName: '', paidAt: null,
    archived: false, createdAt: '2026-09-13T08:00:00.000Z',
  });
});

function As({ role, children }: { role: RoleName; children: React.ReactNode }) {
  const { role: current, setRole } = useSession();
  React.useEffect(() => { setRole(role); }, [role, setRole]);
  return current === role ? <>{children}</> : null;
}

function mount(role: RoleName) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <As role={role}>
            <MemoryRouter initialEntries={['/agents']}>
              <Routes><Route path="/agents" element={<AgentsPage />} /></Routes>
            </MemoryRouter>
          </As>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const openMenu = (trigger: HTMLElement) => {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
};

describe('Agents: proof Verdict and Payment', () => {
  it('lets the System Administrator reject with a reason and mark paid', async () => {
    mount('System Administrator');
    const verdict = await screen.findByRole('button', { name: 'Verdict for proof PRF-0001: Not reviewed' }, { timeout: 8000 });
    expect(screen.getByRole('columnheader', { name: /Verdict/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Payment/ })).toBeTruthy();

    openMenu(verdict);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Rejected…' }, { timeout: 4000 }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Reject proof' });
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'short' } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Post was deleted from the channel' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(db.agentProofs[0]).toMatchObject({ verdict: 'Rejected', verdictReason: 'Post was deleted from the channel' }), { timeout: 8000 });
    expect(await screen.findByText('Post was deleted from the channel', {}, { timeout: 8000 })).toBeTruthy();

    openMenu(screen.getByRole('button', { name: 'Payment for proof PRF-0001: Not paid' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Paid' }));
    await waitFor(() => expect(db.agentProofs[0].payment).toBe('Paid'), { timeout: 8000 });
  });

  it('shows others the verdict and payment without any way to change them', async () => {
    db.agentProofs[0].verdict = 'Accepted';
    mount('Marketing Manager');
    expect(await screen.findByText('Accepted', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('Not paid')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Verdict for proof/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Payment for proof/ })).toBeNull();
  });
});
