// @vitest-environment jsdom
/** Team Reports as people use it: staff submit today's report; the owner sees
 *  who has reported and who is missing. */

import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { loadFixtures } from '@/mocks/db';
import { resetTeamReports } from '@/mocks/team-reports';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider, useSession } from '@/hooks/useSession';
import type { RoleName } from '@/lib/types';
import TeamReportsPage from './TeamReports';

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
beforeEach(() => { loadFixtures(); resetTeamReports(); });
afterEach(() => cleanup());

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
          <As role={role}><MemoryRouter><TeamReportsPage /></MemoryRouter></As>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Team Reports', () => {
  it('staff submit today’s report and see it with its recommendation', async () => {
    mount('Marketing Staff');
    fireEvent.change(await screen.findByLabelText(/What I did/), { target: { value: 'Posted 3 reels on the brand page' } });
    fireEvent.change(screen.getByLabelText(/Recommendation/), { target: { value: 'Boost the Sunday post' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));

    const card = await screen.findByRole('article', { name: /Rohit Menon/ });
    expect(within(card).getByText('Posted 3 reels on the brand page')).toBeTruthy();
    expect(within(card).getByText('Boost the Sunday post')).toBeTruthy();
    expect(within(card).getByText('Submitted')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /Delete permanently/ })).toBeNull();
    expect(screen.queryByText('Who has reported')).toBeNull();
  });

  it('attaches files while writing, and they arrive with the report', async () => {
    mount('Marketing Staff');
    fireEvent.change(await screen.findByLabelText(/What I did/), { target: { value: 'Weekly numbers attached' } });
    const pdf = new File(['%PDF-1.7 numbers'], 'September numbers.pdf', { type: 'application/pdf' });
    const tooBig = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47]), new Uint8Array(1024 * 1024)], 'huge.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Choose files for this report'), { target: { files: [pdf, tooBig] } });
    expect(await screen.findByText('September numbers.pdf')).toBeTruthy();
    expect(screen.getByText(/huge\.png is 1\.0 MB\. Images must be under 1 MB/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }));
    const card = await screen.findByRole('article', { name: /Rohit Menon/ });
    expect(await within(card).findByText('September numbers.pdf')).toBeTruthy();
    expect(within(card).queryByText('huge.png')).toBeNull();
  });

  it('the owner sees who has reported and who is missing', async () => {
    mount('System Administrator');
    expect(await screen.findByText('Who has reported')).toBeTruthy();
    expect((await screen.findAllByText('Missing')).length).toBeGreaterThan(0);
  });
});
