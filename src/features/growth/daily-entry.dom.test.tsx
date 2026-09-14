// @vitest-environment jsdom
/** The daily entry grid tells same-handle pages apart by their profile URL.
 *
 *  Uses direct element lookups rather than role queries: the fixture workspace
 *  has around a hundred trackable accounts, and role queries over a table that
 *  size take seconds in jsdom. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { trackableAccounts } from '@/lib/growth';
import { DailyEntryGrid } from './DailyEntryGrid';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => cleanup());

const PAGES = ['https://www.facebook.com/xBrightgamers', 'https://www.facebook.com/BrightGames/', 'https://facebook.com/bright.slots', ''];
let pageIds: string[] = [];

beforeEach(() => {
  loadFixtures();
  // Only the four pages under test, all recorded under the same handle as the
  // team does. Rendering the whole fixture workspace (~100 rows) made this file
  // slow enough to starve other suites running in parallel into timeouts.
  const four = trackableAccounts(db.socialAccounts).slice(0, 4);
  four.forEach((a, i) => {
    a.username = 'Lenny';
    a.profileUrl = PAGES[i];
  });
  db.socialAccounts = four;
  db.followerSnapshots = [];
  db.contentPosts = [];
  pageIds = four.map((a) => a.id);
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <DailyEntryGrid />
      </SessionProvider>
    </QueryClientProvider>,
  );
}

/** The row holding a given account's count input. */
const rowOf = (accountId: string) => document.getElementById(`count-${accountId}`)!.closest('tr')!;
const headers = () => [...document.querySelectorAll('thead th')].map((th) => th.textContent);

describe('daily follower entry — Profile URL column', () => {
  it('shows each page’s URL as a readable link that opens the real page', async () => {
    const { container } = mount();
    await waitFor(() => expect(document.getElementById(`count-${pageIds[0]}`)).toBeTruthy(), { timeout: 5000 });

    expect(headers().slice(0, 3)).toEqual(['Account', 'Platform', 'Profile URL']);

    const link = rowOf(pageIds[0]).querySelector('a')!;
    expect(link.textContent).toBe('facebook.com/xBrightgamers');
    expect(link.getAttribute('href')).toBe('https://www.facebook.com/xBrightgamers');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');

    // Readable: no scheme, no www, no trailing slash.
    expect(rowOf(pageIds[1]).querySelector('a')!.textContent).toBe('facebook.com/BrightGames');
    expect(rowOf(pageIds[3]).textContent).toContain('No profile URL');
    expect(container.querySelector('table')).toBeTruthy();
  }, 15000);

  it('filters rows by a piece of the URL', async () => {
    mount();
    await waitFor(() => expect(document.getElementById(`count-${pageIds[0]}`)).toBeTruthy(), { timeout: 5000 });

    fireEvent.change(screen.getByLabelText('Filter accounts'), { target: { value: 'xBrightgamers' } });

    await waitFor(() => {
      const bodyRows = document.querySelectorAll('tbody tr');
      expect(bodyRows).toHaveLength(1);
      expect(bodyRows[0].querySelector('a')!.textContent).toBe('facebook.com/xBrightgamers');
    });
  }, 15000);
});
