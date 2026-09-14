// @vitest-environment jsdom
/** The shipped workspace has no records, so "empty" is the default experience
 *  rather than an edge case. Every route must render it without crashing and
 *  say something useful. */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, resetDb } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';

import OverviewPage from './Overview';
import SimsPage from './Sims';
import AgentsPage from './Agents';
import AccountsPage from './Accounts';
import DomainsPage from './Domains';
import GrowthPage from './Growth';
import ReservesPage from './Reserves';
import AssignmentsPage from './Assignments';
import CredentialsPage from './Credentials';
import BrandsPage from './Brands';
import ReportsPage from './Reports';
import ImportPage from './Import';
import AuditPage from './Audit';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetDb());          // the shipped state: configuration, no records
afterEach(() => cleanup());

function mount(ui: React.ReactNode, route = '/') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes><Route path="*" element={ui} /></Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('the shipped workspace ships empty', () => {
  it('has configuration but no records', () => {
    expect(db.platforms.length).toBeGreaterThan(0);
    expect(db.countries.length).toBeGreaterThan(0);
    for (const key of ['sims', 'agents', 'socialAccounts', 'domains', 'assignments', 'credentials',
      'brands', 'projects', 'teamMembers', 'followerSnapshots', 'contentPosts', 'auditEntries'] as const) {
      expect(db[key], key).toHaveLength(0);
    }
  });
});

describe('every route renders with no records', () => {
  const cases: [string, React.ReactNode, RegExp][] = [
    ['Overview', <OverviewPage />, /Overview/],
    ['SIMs', <SimsPage />, /SIM and phone number register/],
    ['Agents', <AgentsPage />, /Agent register/],
    ['Accounts', <AccountsPage />, /Marketing social media accounts/],
    ['Domains', <DomainsPage />, /^Domains$/],
    ['Growth', <GrowthPage />, /Social growth/],
    ['Reserves', <ReservesPage />, /Reserve account inventory/],
    ['Assignments', <AssignmentsPage />, /Assignments and handovers/],
    ['Credentials', <CredentialsPage />, /Credential references/],
    ['Brands', <BrandsPage />, /Brands, projects and team/],
    ['Reports', <ReportsPage />, /^Reports$/],
    ['Import', <ImportPage />, /Import and data quality/],
    ['Audit', <AuditPage />, /Roles and audit history/],
  ];

  for (const [name, ui, heading] of cases) {
    it(`${name} renders`, async () => {
      mount(ui);
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
    });
  }
});

describe('empty registers say so rather than showing a blank table', () => {
  it('SIM register reports zero records and an empty state', async () => {
    mount(<SimsPage />);
    await waitFor(() => expect(screen.getByText('0 records')).toBeTruthy());
    expect(screen.getByText('No SIM records match')).toBeTruthy();
  });

  it('Overview KPIs all read zero rather than breaking', async () => {
    mount(<OverviewPage />);
    expect(await screen.findByLabelText(/Total SIM records: 0/)).toBeTruthy();
    expect(screen.getByLabelText(/Total social media accounts: 0/)).toBeTruthy();
    expect(screen.getByLabelText(/Accounts missing an owner: 0/)).toBeTruthy();
  });

  it('Overview charts show an empty state instead of an empty plot', async () => {
    mount(<OverviewPage />);
    await waitFor(() => expect(screen.getAllByText('Nothing to plot').length).toBeGreaterThan(0));
  });

  it('Growth daily entry explains there is nothing to track yet', async () => {
    mount(<GrowthPage />, '/growth');
    expect(await screen.findByText('No accounts to track')).toBeTruthy();
  });

  it('Brands offers an empty state rather than a blank grid', async () => {
    mount(<BrandsPage />);
    expect(await screen.findByText('No brands configured')).toBeTruthy();
  });

  it('Audit history is empty but the permission matrix still renders', async () => {
    mount(<AuditPage />);
    expect(await screen.findByRole('columnheader', { name: 'Marketing Manager' })).toBeTruthy();
  });
});

describe('configuration survives so the registers are usable on day one', () => {
  it('Brands still lists the platforms and countries an account can use', async () => {
    mount(<BrandsPage />);
    expect(await screen.findByRole('tab', { name: /^Platforms \(8\)/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Countries \(4\)/ })).toBeTruthy();
  });
});
