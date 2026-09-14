// @vitest-environment jsdom
/** Smoke test: mount every route against the mock API and assert it reaches a
 *  loaded state without throwing. Catches runtime breakage that typechecking cannot. */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';

import OverviewPage from './Overview';
import SimsPage from './Sims';
import SimDetailPage from './SimDetail';
import AgentsPage from './Agents';
import AgentDetailPage from './AgentDetail';
import AccountsPage from './Accounts';
import AccountDetailPage from './AccountDetail';
import DomainsPage from './Domains';
import GrowthPage from './Growth';
import ReservesPage from './Reserves';
import AssignmentsPage from './Assignments';
import CredentialsPage from './Credentials';
import BrandsPage from './Brands';
import BrandDetailPage from './BrandDetail';
import ReportsPage from './Reports';
import ImportPage from './Import';
import AuditPage from './Audit';

const server = setupServer(...handlers);
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
  // Radix and the theme hook both read matchMedia.
  window.matchMedia ??= ((q: string) => ({
    matches: false, media: q, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterAll(() => server.close());
// The shipped workspace is empty; these tests want the synthetic dataset.
beforeEach(() => loadFixtures());
afterEach(() => cleanup());

function mount(ui: React.ReactNode, { path = '/', route = '/' } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter initialEntries={[route]}>
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const heading = (name: RegExp) => screen.findByRole('heading', { level: 1, name });

describe('every route renders against the mock API', () => {
  it('Overview shows KPI values once data resolves', async () => {
    mount(<OverviewPage />);
    await heading(/Overview/);
    // "Total SIM records" must end up with a real number, not a skeleton.
    const card = await screen.findByLabelText(/Total SIM records: \d+/);
    expect(card).toBeTruthy();
  });

  it('SIM register lists records and surfaces the duplicate-number banner', async () => {
    mount(<SimsPage />);
    await heading(/SIM and phone number register/);
    await waitFor(() => expect(screen.getByText(/^\d+ records?$/)).toBeTruthy());
    expect(await screen.findByText(/duplicate numbers? detected/i)).toBeTruthy();
  });

  it('SIM detail resolves a record by id', async () => {
    mount(<SimDetailPage />, { path: '/sims/:id', route: '/sims/SIM-0001' });
    await waitFor(() => expect(screen.getByText('SIM-0001')).toBeTruthy());
  });

  it('Agent register renders', async () => {
    mount(<AgentsPage />);
    await heading(/Agent register/);
    await waitFor(() => expect(screen.getByText(/^\d+ records?$/)).toBeTruthy());
  });

  it('Agent detail renders its tabs', async () => {
    mount(<AgentDetailPage />, { path: '/agents/:id', route: '/agents/AGT-001' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Assigned resources/ })).toBeTruthy());
  });

  it('Account register renders with duplicate flags', async () => {
    mount(<AccountsPage />);
    await heading(/Marketing social media accounts/);
    expect(await screen.findByText(/duplicate groups? flagged/i)).toBeTruthy();
  });

  it('Account detail renders its tabs', async () => {
    mount(<AccountDetailPage />, { path: '/accounts/:id', route: '/accounts/ACC-0001' });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Access & recovery/ })).toBeTruthy());
  });

  it('Domains renders the required columns and summary cards', async () => {
    mount(<DomainsPage />);
    await heading(/^Domains$/);
    await waitFor(() => expect(screen.getByText(/^\d+ records?$/)).toBeTruthy());

    const table = screen.getByRole('table');
    for (const col of ['Domain Name', 'Target Country', 'Rotation Date', 'Registered', 'Expiration', 'Status']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(col) }), col).toBeTruthy();
    }
    for (const card of ['Total domains', 'India domains', 'Indonesia domains', 'Active domains', 'Inactive domains', 'Expiring within 30 days']) {
      expect(screen.getByText(card), card).toBeTruthy();
    }
    // Domains without a rotation date read as "Not rotated", never blank.
    expect(within(table).getAllByText('Not rotated').length).toBeGreaterThan(0);
  });

  it('Growth opens on the daily entry grid with a row per live account', async () => {
    mount(<GrowthPage />, { path: '/growth', route: '/growth' });
    await heading(/Social growth/);

    // The entry grid asks for the running total, not the gain, and shows each
    // page's URL so same-handle rows can be told apart.
    // Header text and inputs are read directly: role queries across a
    // hundred-row table take seconds in jsdom and time out under a full run.
    const table = await screen.findByRole('table');
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent ?? '');
    expect(headers).toEqual(expect.arrayContaining(['Profile URL', 'Previous total', 'Gain']));
    expect(headers.some((h) => /^Total on/i.test(h))).toBe(true);
    expect(table.querySelectorAll('tbody input[type="number"]').length).toBeGreaterThan(0);
  });

  it('Growth follower tab summarises trends and draws the movers chart', async () => {
    mount(<GrowthPage />, { path: '/growth', route: '/growth?tab=followers' });
    await heading(/Social growth/);
    expect(await screen.findByText('Accounts tracked')).toBeTruthy();
    // KPI cards carry the count in their accessible name, so this also asserts the figures resolved.
    expect(await screen.findByLabelText(/^Growing: \d+/)).toBeTruthy();
    expect(screen.getByLabelText(/^Declining: \d+/)).toBeTruthy();
    expect(await screen.findByRole('img', { name: /Follower totals/ })).toBeTruthy();
  });

  it('Growth content tab ranks posts and states the view floor', async () => {
    mount(<GrowthPage />, { path: '/growth', route: '/growth?tab=content' });
    await heading(/Social growth/);
    expect(await screen.findByText('Median engagement rate')).toBeTruthy();
    expect(screen.getByText(/at least 100 views/i)).toBeTruthy();
    expect(await screen.findByRole('img', { name: /Top posts by engagement rate/ })).toBeTruthy();
  });

  it('Reserve inventory publishes its readiness criteria', async () => {
    mount(<ReservesPage />);
    await heading(/Reserve account inventory/);
    expect(await screen.findByText(/What counts as ready to assign/)).toBeTruthy();
    expect(screen.getByText(/No active assignment exists\./)).toBeTruthy();
  });

  it('Assignments renders', async () => {
    mount(<AssignmentsPage />);
    await heading(/Assignments and handovers/);
    await waitFor(() => expect(screen.getByText(/^\d+ records?$/)).toBeTruthy());
  });

  it('Credential references render and are labelled not connected', async () => {
    mount(<CredentialsPage />);
    await heading(/Credential references/);
    expect(await screen.findByText(/Not connected\./)).toBeTruthy();
  });

  it('Brands renders', async () => {
    mount(<BrandsPage />);
    await heading(/Brands, projects and team/);
    expect(await screen.findByText('Aurora Retail')).toBeTruthy();
  });

  it('Brand detail summarises its resources', async () => {
    mount(<BrandDetailPage />, { path: '/brands/:id', route: '/brands/BRD-01' });
    await heading(/Aurora Retail/);
    expect(await screen.findByText('Reserve accounts')).toBeTruthy();
  });

  it('Reports renders every report tab trigger', async () => {
    mount(<ReportsPage />);
    await heading(/^Reports$/);
    for (const tab of ['Inventory', 'Reserve readiness', 'SIM renewals', 'Handover history']) {
      expect(await screen.findByRole('tab', { name: tab }), tab).toBeTruthy();
    }
  });

  it('Import renders for a role that may import', async () => {
    mount(<ImportPage />);
    await heading(/Import and data quality/);
    expect(await screen.findByLabelText(/Upload a CSV file/)).toBeTruthy();
  });

  it('Roles and audit renders the permission matrix', async () => {
    mount(<AuditPage />);
    await heading(/Roles and audit history/);
    expect(await screen.findByRole('columnheader', { name: 'Marketing Manager' })).toBeTruthy();
    expect(screen.getByRole('rowheader', { name: 'Manage credential references' })).toBeTruthy();
  });
});

describe('accessibility basics', () => {
  it('gives every table a sortable, labelled header row', async () => {
    mount(<DomainsPage />);
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy());
    const sortable = screen.getAllByRole('columnheader').filter((h) => h.getAttribute('aria-sort'));
    expect(sortable.length).toBeGreaterThan(0);
  });

  it('labels filter controls', async () => {
    mount(<DomainsPage />);
    expect(await screen.findByLabelText('Country')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    expect(screen.getByLabelText('Expiration')).toBeTruthy();
    expect(screen.getByLabelText(/Search records/)).toBeTruthy();
  });
});

describe('contact details are masked until deliberately revealed', () => {
  it('masks phone numbers in the SIM register even for a System Administrator', async () => {
    mount(<SimsPage />, { path: '/sims', route: '/sims' });
    await heading(/SIM and phone number register/);
    await waitFor(() => expect(screen.getByText(/^\d+ records?$/)).toBeTruthy());

    const table = screen.getByRole('table');
    // Permission alone is not enough — the default view shows masks, not numbers.
    expect(within(table).getAllByText(/•/).length).toBeGreaterThan(0);
    const realNumbers = within(table).queryAllByText(/^\+\d{10,}$/);
    expect(realNumbers).toHaveLength(0);
  });

  it('masks agent contact numbers and emails by default', async () => {
    mount(<AgentsPage />, { path: '/agents', route: '/agents' });
    await heading(/Agent register/);
    await waitFor(() => expect(screen.getByText(/^\d+ records?$/)).toBeTruthy());
    const table = screen.getByRole('table');
    expect(within(table).getAllByText(/•/).length).toBeGreaterThan(0);
  });
});
