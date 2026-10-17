// @vitest-environment jsdom
/** Running a rotation, driven the way a person uses it: set up two batches,
 *  run a full rotation to bring the first one in, run a second full rotation
 *  to swap it back out, move one domain with a partial rotation without
 *  touching the schedule, then postpone the next rotation with an override. */

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

async function setUpGroupWithTwoBatches() {
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

  fireEvent.click(screen.getByRole('button', { name: 'Manage members of Batch A' }));
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include invite-alpha.com' }));
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include invite-bravo.com' }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Save members/ }));
  await screen.findByText('2 domains');

  fireEvent.click(screen.getByRole('button', { name: 'Manage members of Batch B' }));
  dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Include invite-charlie.com' }));
  fireEvent.click(within(dialog).getByRole('button', { name: /Save members/ }));
  await screen.findByText('1 domain');

  return {
    group: db.rotationGroups.find((g) => g.name === 'Main Invite Rotation')!,
    batchA: db.rotationBatches.find((b) => b.name === 'Batch A')!,
    batchB: db.rotationBatches.find((b) => b.name === 'Batch B')!,
  };
}

describe('Running a rotation', () => {
  it('runs a first full rotation with no outgoing batch yet', async () => {
    await mount();
    const { group, batchA } = await setUpGroupWithTwoBatches();

    fireEvent.click(screen.getByRole('button', { name: 'Run rotation' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Batch A/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'First rotation to bring Batch A live.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Run full rotation/ }));

    await waitFor(() => expect(db.rotationBatches.find((b) => b.id === batchA.id)?.status).toBe('Active'));
    expect(db.domainMonitors.find((d) => d.domainName === 'invite-alpha.com')?.activationStatus).toBe('Active');
    expect(db.domainMonitors.find((d) => d.domainName === 'invite-bravo.com')?.activationStatus).toBe('Active');
    const updatedGroup = db.rotationGroups.find((g) => g.id === group.id)!;
    expect(updatedGroup.nextRotationDueAt).toBeTruthy();
    expect(db.rotationEvents.some((e) => e.rotationGroupId === group.id && e.eventType === 'full_rotation')).toBe(true);
  });

  it('runs a second full rotation that flips the outgoing batch to Standby', async () => {
    await mount();
    const { batchA, batchB } = await setUpGroupWithTwoBatches();

    // First rotation: bring in Batch A.
    fireEvent.click(screen.getByRole('button', { name: 'Run rotation' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Batch A/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'First rotation to bring Batch A live.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Run full rotation/ }));
    await waitFor(() => expect(db.rotationBatches.find((b) => b.id === batchA.id)?.status).toBe('Active'));
    await screen.findByText('Active', { selector: 'span' }).catch(() => undefined);

    // Second rotation: bring in Batch B — Batch A is now the outgoing one.
    fireEvent.click(screen.getByRole('button', { name: 'Run rotation' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Batch B/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Swapping to Batch B for this cycle.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Run full rotation/ }));

    await waitFor(() => expect(db.rotationBatches.find((b) => b.id === batchB.id)?.status).toBe('Active'));
    expect(db.rotationBatches.find((b) => b.id === batchA.id)?.status).toBe('Standby');
    expect(db.domainMonitors.find((d) => d.domainName === 'invite-alpha.com')?.activationStatus).toBe('Standby');
    expect(db.domainMonitors.find((d) => d.domainName === 'invite-charlie.com')?.activationStatus).toBe('Active');
  });

  it('moves a domain with a partial rotation, leaving the schedule untouched', async () => {
    await mount();
    const { group, batchA, batchB } = await setUpGroupWithTwoBatches();
    fireEvent.click(screen.getByRole('button', { name: 'Run rotation' }));
    let dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Batch A/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'First rotation to bring Batch A live.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Run full rotation/ }));
    await waitFor(() => expect(db.rotationBatches.find((b) => b.id === batchA.id)?.status).toBe('Active'));
    await screen.findByText('2 domains');

    const dueBefore = db.rotationGroups.find((g) => g.id === group.id)!.nextRotationDueAt;

    fireEvent.click(screen.getByRole('button', { name: /Partial rotation/ }));
    dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Move invite-alpha.com to'), { target: { value: batchB.id } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'invite-alpha.com failed checks; swapping it out.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Move 1 domain/ }));

    await waitFor(() => {
      const alpha = db.domainMonitors.find((d) => d.domainName === 'invite-alpha.com')!;
      expect(db.rotationBatchMembers.find((m) => m.domainMonitorId === alpha.id)?.rotationBatchId).toBe(batchB.id);
    });
    // Batch B is Standby, so the moved domain reads Standby now — Batch A's own status is untouched.
    expect(db.domainMonitors.find((d) => d.domainName === 'invite-alpha.com')?.activationStatus).toBe('Standby');
    expect(db.rotationBatches.find((b) => b.id === batchA.id)?.status).toBe('Active');
    expect(db.rotationGroups.find((g) => g.id === group.id)!.nextRotationDueAt).toBe(dueBefore);
  });

  it('postpones the next rotation with a schedule override', async () => {
    await mount();
    const { group } = await setUpGroupWithTwoBatches();

    fireEvent.click(screen.getByRole('button', { name: 'Override' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/New rotation date/), { target: { value: '2027-01-01T09:00' } });
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Holding off the rotation until the new year.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Apply override/ }));

    await waitFor(() => {
      const updated = db.rotationGroups.find((g) => g.id === group.id)!;
      expect(new Date(updated.nextRotationDueAt!).getUTCFullYear()).toBe(2027);
    });
    expect(db.rotationEvents.some((e) => e.rotationGroupId === group.id && e.eventType === 'postpone' && e.isOverride)).toBe(true);
  });
});
