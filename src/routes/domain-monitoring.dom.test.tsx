// @vitest-environment jsdom
/** Domain Monitoring & Rotation, driven the way a member actually uses it:
 *  check the dashboard counts, filter the Free Cash and Invite tables, record
 *  a daily check (single and bulk), and archive/restore a domain. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import DomainMonitoringPage from './DomainMonitoring';

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
          <DomainMonitoringPage />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
  return qc;
}

/** Radix Tabs activates on pointer interaction, not a plain click — jsdom
 *  needs the pointer/mouse sequence spelled out, or the trigger's `onClick`
 *  never fires and the panel never switches. No other test in this codebase
 *  has exercised clicking between Radix Tabs before this one. */
function clickTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.pointerDown(tab);
  fireEvent.mouseDown(tab);
  fireEvent.pointerUp(tab);
  fireEvent.mouseUp(tab);
  fireEvent.click(tab);
}

/** KpiCard has no accessible label unless it links somewhere (`to`) — none of
 *  this dashboard's cards do. Reads the value next to a given label instead. */
function kpiValue(label: string): string {
  const labelEl = screen.getByText(label);
  const valueEl = labelEl.parentElement?.nextElementSibling;
  return valueEl?.textContent ?? '';
}

describe('Domain Monitoring & Rotation dashboard', () => {
  it('shows real KPI counts from the seeded domains', async () => {
    mount();
    await screen.findByText('freecash-alpha.com');
    // 4 live Free Cash + 5 live Invite = 9 (one Free Cash domain is seeded archived).
    expect(kpiValue('Total Domains')).toBe('9');
    expect(kpiValue('Active Invite Domains')).toBe('2');
  });

  it('lists Free Cash Domains and filters by accessibility', async () => {
    mount();
    await screen.findByText('freecash-alpha.com');
    expect(screen.getByText('freecash-bravo.com')).toBeTruthy();
    // The archived Free Cash domain is not shown on the Active view by default.
    expect(screen.queryByText('freecash-echo.com')).toBeNull();

    fireEvent.change(screen.getByLabelText('Accessibility'), { target: { value: 'Inaccessible' } });
    await waitFor(() => expect(screen.queryByText('freecash-alpha.com')).toBeNull());
    expect(screen.getByText('freecash-bravo.com')).toBeTruthy();
  });

  it('switches to the Invite Domains tab and shows rotation-specific columns', async () => {
    mount();
    await screen.findByText('freecash-alpha.com');
    clickTab('Invite Domains');
    await screen.findByText('invite-alpha.com');
    expect(screen.getByText('invite-delta.com')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Next Rotation Date' })).toBeTruthy();
    // invite-echo.com is seeded manually disabled, independent of its rotation batch status.
    const echoRow = screen.getByRole('row', { name: /invite-echo\.com/ });
    expect(within(echoRow).getByLabelText('Enabled state of invite-echo.com')).toHaveProperty('value', 'Disabled');
  });

  it('records a single accessibility check inline, which updates the table immediately', async () => {
    mount();
    await screen.findByText('freecash-delta.com'); // seeded Not Checked
    const row = screen.getByRole('row', { name: /freecash-delta\.com/ });
    fireEvent.change(within(row).getByLabelText('Accessibility of freecash-delta.com'), { target: { value: 'Accessible' } });

    await waitFor(() => expect(db.domainMonitors.find((d) => d.domainName === 'freecash-delta.com')?.lastAccessibilityStatus).toBe('Accessible'));
  });

  it('toggles a domain Enabled/Disabled inline, recording the date it was last enabled', async () => {
    mount();
    clickTab('Invite Domains');
    await screen.findByText('invite-echo.com'); // seeded Disabled
    const row = screen.getByRole('row', { name: /invite-echo\.com/ });
    fireEvent.change(within(row).getByLabelText('Enabled state of invite-echo.com'), { target: { value: 'Enabled' } });

    await waitFor(() => {
      const echo = db.domainMonitors.find((d) => d.domainName === 'invite-echo.com');
      expect(echo?.enabled).toBe(true);
      expect(echo?.enabledDate).toBe(new Date().toISOString().slice(0, 10));
    });
  });

  it('bulk-records a check across selected domains', async () => {
    mount();
    await screen.findByText('freecash-alpha.com');
    fireEvent.click(screen.getByRole('button', { name: /^Select$/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select freecash-bravo.com' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select freecash-charlie.com' }));
    fireEvent.click(screen.getByRole('button', { name: /Check selected \(2\)/ }));

    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Accessibility'), { target: { value: 'Accessible' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Record check/ }));

    await waitFor(() => {
      expect(db.domainMonitors.find((d) => d.domainName === 'freecash-bravo.com')?.lastAccessibilityStatus).toBe('Accessible');
      expect(db.domainMonitors.find((d) => d.domainName === 'freecash-charlie.com')?.lastAccessibilityStatus).toBe('Accessible');
    });
  });

  it('archives a domain with a reason, then restores it from the Archived tab', async () => {
    mount();
    await screen.findByText('freecash-alpha.com');
    fireEvent.click(screen.getByRole('button', { name: 'Archive freecash-alpha.com' }));
    const archiveDialog = await screen.findByRole('dialog');
    fireEvent.change(within(archiveDialog).getByLabelText(/Reason/), { target: { value: 'Retired, replaced by a new domain.' } });
    fireEvent.click(within(archiveDialog).getByRole('button', { name: /Archive record/ }));

    await waitFor(() => expect(db.domainMonitors.find((d) => d.domainName === 'freecash-alpha.com')?.archived).toBe(true));
    await waitFor(() => expect(screen.queryByText('freecash-alpha.com')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /Archived \(\d+\)/ }));
    await screen.findByText('freecash-alpha.com');
    // freecash-echo.com is also seeded archived, so there are two Restore buttons — scope to this row.
    fireEvent.click(within(screen.getByRole('row', { name: /freecash-alpha\.com/ })).getByRole('button', { name: /Restore/ }));
    const restoreDialog = await screen.findByRole('dialog');
    fireEvent.change(within(restoreDialog).getByLabelText(/Reason/), { target: { value: 'Back in service.' } });
    fireEvent.click(within(restoreDialog).getByRole('button', { name: /Restore domain/ }));

    await waitFor(() => expect(db.domainMonitors.find((d) => d.domainName === 'freecash-alpha.com')?.archived).toBe(false));
  });

  it('lets the System Administrator select domains and permanently delete them', async () => {
    mount(); // default preview role is System Administrator
    await screen.findByText('freecash-alpha.com');
    const before = db.domainMonitors.length;

    fireEvent.click(screen.getByRole('button', { name: /^Select$/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select freecash-bravo.com' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select freecash-charlie.com' }));
    fireEvent.click(screen.getByRole('button', { name: /Delete selected \(2\)/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Delete 2 domains permanently/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Duplicate test domains, cleaning up the register.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Delete 2 permanently/ }));

    await waitFor(() => expect(db.domainMonitors.length).toBe(before - 2));
    expect(db.domainMonitors.find((d) => d.domainName === 'freecash-bravo.com')).toBeUndefined();
    expect(db.domainMonitors.find((d) => d.domainName === 'freecash-charlie.com')).toBeUndefined();
    await waitFor(() => expect(screen.queryByText('freecash-bravo.com')).toBeNull());
    // Select mode exits after a successful delete.
    expect(screen.getByRole('button', { name: /^Select$/ })).toBeTruthy();
  });

  it('shows the Rotation Management empty state when no groups exist yet', async () => {
    mount();
    await screen.findByText('freecash-alpha.com');
    clickTab('Rotation Management');
    expect(await screen.findByText('No rotation groups yet')).toBeTruthy();
  });
});
