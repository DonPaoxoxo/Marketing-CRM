// @vitest-environment jsdom
/** Rotation Management, driven the way a person uses it: create a group,
 *  add two batches to it, then assign Invite Domains to one of them — a
 *  domain already in another batch moves rather than duplicating. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { BOOTSTRAP_KEY } from '@/hooks/useData';
import { RotationBatchPanel } from './RotationBatchPanel';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => loadFixtures());
afterEach(() => cleanup());

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <RotationBatchPanel />
      </SessionProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(qc.getQueryData(BOOTSTRAP_KEY)).toBeTruthy());
  return qc;
}

describe('Rotation Management', () => {
  it('starts empty and creates a rotation group', async () => {
    await mount();
    expect(await screen.findByText('No rotation groups yet')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New rotation group/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Group name/), { target: { value: 'Main Invite Rotation' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create group/ }));

    expect(await screen.findByText('Main Invite Rotation')).toBeTruthy();
    expect(db.rotationGroups.some((g) => g.name === 'Main Invite Rotation')).toBe(true);
  });

  it('adds two batches to a group and assigns members, moving a domain between batches', async () => {
    await mount();
    fireEvent.click(screen.getByRole('button', { name: /New rotation group/ }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Group name/), { target: { value: 'Main Invite Rotation' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create group/ }));
    await screen.findByText('Main Invite Rotation');

    fireEvent.click(screen.getByRole('button', { name: /New batch/ }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Batch name/), { target: { value: 'Batch A' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create batch/ }));
    await screen.findByText('Batch A');

    fireEvent.click(screen.getByRole('button', { name: /New batch/ }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Batch name/), { target: { value: 'Batch B' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create batch/ }));
    await screen.findByText('Batch B');

    const batchA = db.rotationBatches.find((b) => b.name === 'Batch A')!;
    const batchB = db.rotationBatches.find((b) => b.name === 'Batch B')!;

    fireEvent.click(screen.getByRole('button', { name: 'Manage members of Batch A' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include invite-alpha.com' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include invite-bravo.com' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /Save members/ }));

    await waitFor(() => expect(db.rotationBatchMembers.filter((m) => m.rotationBatchId === batchA.id)).toHaveLength(2));
    // Wait for the UI's own bootstrap cache to reflect the save (the mutation
    // invalidates it asynchronously) before opening the next membership dialog.
    await screen.findByText('2 domains');

    // Move invite-alpha.com from Batch A into Batch B.
    fireEvent.click(screen.getByRole('button', { name: 'Manage members of Batch B' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include invite-alpha.com' }));
    expect(within(dialog).getByText(/Moves from Batch A/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Save members/ }));

    await waitFor(() => {
      const alpha = db.domainMonitors.find((d) => d.domainName === 'invite-alpha.com')!;
      expect(db.rotationBatchMembers.find((m) => m.domainMonitorId === alpha.id)?.rotationBatchId).toBe(batchB.id);
    });
    // Still just the one row for invite-alpha.com — moved, not duplicated.
    const alpha = db.domainMonitors.find((d) => d.domainName === 'invite-alpha.com')!;
    expect(db.rotationBatchMembers.filter((m) => m.domainMonitorId === alpha.id)).toHaveLength(1);
  });
});
