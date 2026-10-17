// @vitest-environment jsdom
/** Domain Monitoring bulk add, driven the way a person uses it: paste a list,
 *  read the preview — a domain already in the register, or repeated in the
 *  paste, is skipped and named, never overwritten — then add only the valid ones. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { BOOTSTRAP_KEY } from '@/hooks/useData';
import { DomainBulkAddDialog } from './DomainBulkAddDialog';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => loadFixtures());
afterEach(() => cleanup());

const pasted = [
  'new-cash-one.com',
  'freecash-alpha.com', // already in the register — skipped
  'new-cash-two.com',
  'new-cash-two.com', // repeated in this same paste — skipped on its second line
  'not a domain', // invalid — skipped
].join('\n');

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <DomainBulkAddDialog open onOpenChange={() => undefined} domainType="Free Cash" />
      </SessionProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(qc.getQueryData(BOOTSTRAP_KEY)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/Domain URLs/), { target: { value: pasted } });
  // The count figures sit in their own <span>, so the summary sentence is split
  // across elements — the submit button's own label is a single text node.
  await screen.findByRole('button', { name: 'Add 2 domains' });
  return qc;
}

describe('Domain Monitoring bulk add', () => {
  it('previews the paste: 2 valid, 3 skipped (existing, duplicated, invalid)', async () => {
    await mount();
    expect(screen.getByText(/Line 2.*Already in the register/)).toBeTruthy();
    expect(screen.getByText(/Line 4.*Duplicated earlier in this list/)).toBeTruthy();
    expect(screen.getByText(/Line 5.*Not a valid domain/)).toBeTruthy();
  });

  it('adds only the valid, non-duplicate domains as Free Cash', async () => {
    await mount();
    const before = db.domainMonitors.length;

    fireEvent.click(screen.getByRole('button', { name: /Add 2 domains/ }));
    expect(await screen.findByText(/2 domains added, 3 skipped/)).toBeTruthy();

    expect(db.domainMonitors.length).toBe(before + 2);
    const created = db.domainMonitors.filter((d) => d.domainName === 'new-cash-one.com' || d.domainName === 'new-cash-two.com');
    expect(created).toHaveLength(2);
    expect(created.every((d) => d.domainType === 'Free Cash' && d.lastAccessibilityStatus === 'Not Checked')).toBe(true);
    // The duplicate paste line never created a second row for new-cash-two.com.
    expect(db.domainMonitors.filter((d) => d.domainName === 'new-cash-two.com')).toHaveLength(1);
  });
});
