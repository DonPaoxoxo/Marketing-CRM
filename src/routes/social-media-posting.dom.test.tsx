// @vitest-environment jsdom
/** Social Media Posting: the daily log, its dashboard, and bulk actions on the
 *  Posting Records table. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { ThemeProvider } from '@/hooks/useTheme';
import { SessionProvider } from '@/hooks/useSession';
import SocialMediaPostingPage from './SocialMediaPosting';

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
afterEach(() => cleanup());
beforeEach(() => loadFixtures());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/social-media-posting']}>
            <Routes><Route path="/social-media-posting" element={<SocialMediaPostingPage />} /></Routes>
          </MemoryRouter>
        </SessionProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const heading = (name: RegExp) => screen.findByRole('heading', { level: 1, name });

/** The fixture posts are dated relative to a fixed point in the past, not the
 *  real clock, so they are outside the page's default "Today" window. Widens
 *  the Date filter to a range covering every fixture post, so tests that need
 *  to interact with a row can actually see it. */
async function showAllFixtureDates() {
  const dates = db.socialMediaPosts.map((p) => p.postDate).sort();
  fireEvent.change(screen.getByLabelText('Date'), { target: { value: 'range' } });
  fireEvent.change(await screen.findByLabelText('From'), { target: { value: dates[0] } });
  fireEvent.change(screen.getByLabelText('To'), { target: { value: dates[dates.length - 1] } });
}

describe('Social Media Posting — dashboard and date filtering', () => {
  it('defaults to Today, which is empty for fixtures anchored to a fixed past date', async () => {
    mount();
    await heading(/Social Media Posting/);
    // The fixtures are dated relative to a fixed point in the past, not the real
    // clock, so "Today" (the real today) legitimately finds nothing — exactly
    // the kind of empty state the dashboard must handle without erroring.
    expect(await screen.findByText('No posts match')).toBeTruthy();
    const table = screen.getByRole('table');
    expect(within(table).queryAllByText('View Post')).toHaveLength(0);
  });

  it('a Custom Date matching the fixtures shows exactly that day’s posts', async () => {
    mount();
    await heading(/Social Media Posting/);
    await screen.findByText('No posts match'); // the default Today view, once data has actually loaded
    const anchorDate = db.socialMediaPosts.find((p) => p.status === 'active')!.postDate;
    const sameDayActive = db.socialMediaPosts.filter((p) => p.status === 'active' && p.postDate === anchorDate);

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: 'custom' } });
    fireEvent.change(await screen.findByLabelText('Which day'), { target: { value: anchorDate } });

    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByText('View Post')).toHaveLength(sameDayActive.length), { timeout: 8000 });
  });
});

describe('Social Media Posting — create, archive, restore', () => {
  it('logging a post shows it in the table and updates the dashboard', async () => {
    mount();
    await heading(/Social Media Posting/);
    // Today is empty in the fixture data, so one new post makes the table go
    // from the empty state to exactly one row — an easy way to see the
    // dashboard actually recomputed rather than just trusting the form closed.
    expect(await screen.findByText('No posts match')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Add Social Media Post/ }));
    const dialog = await screen.findByRole('dialog');
    // NativeSelects are queried by id directly: this environment's accessible-name
    // resolution for plain <select> elements is unreliable, unlike text inputs.
    fireEvent.change(dialog.querySelector('#smp-member')!, { target: { value: 'TM-02' } });
    fireEvent.change(dialog.querySelector('#smp-purpose')!, { target: { value: 'Others' } });
    fireEvent.change(await within(dialog).findByLabelText(/Custom Purpose/), { target: { value: 'Flash sale' } });
    fireEvent.change(dialog.querySelector('#smp-platform')!, { target: { value: 'Pinterest' } });
    fireEvent.change(within(dialog).getByLabelText(/Post Link/), { target: { value: 'https://pinterest.com/pin/123' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add post/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 8000 });
    const table = await screen.findByRole('table');
    await waitFor(() => expect(within(table).getAllByText('View Post')).toHaveLength(1), { timeout: 8000 });
    expect(within(table).getByText('Pinterest')).toBeTruthy();
    expect(within(table).getByText(/Others \(Flash sale\)/)).toBeTruthy();
    expect(screen.queryByText('No posts match')).toBeNull();
  });

  it('rejects a post link that is not a valid URL', async () => {
    mount();
    await heading(/Social Media Posting/);
    await screen.findByText('No posts match');
    fireEvent.click(screen.getByRole('button', { name: /Add Social Media Post/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Post Link/), { target: { value: 'not-a-url' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Add post/ }));
    expect(await within(dialog).findByText(/valid URL/i)).toBeTruthy();
  });

  it('archives a post from its row, then restores it from the Archived view', async () => {
    mount();
    await heading(/Social Media Posting/);
    await screen.findByText('No posts match'); // data has actually loaded, before trusting any count
    await showAllFixtureDates();

    const active = await screen.findByRole('button', { name: /Active \(\d+\)/ }, { timeout: 8000 });
    const activeBefore = Number(active.textContent!.match(/\((\d+)\)/)![1]);
    const target = db.socialMediaPosts.find((p) => p.status === 'active')!;

    fireEvent.click(await screen.findByRole('button', { name: `Archive ${target.id}` }, { timeout: 8000 }));
    const archiveDialog = await screen.findByRole('dialog');
    fireEvent.change(within(archiveDialog).getByRole('textbox'), { target: { value: 'Campaign ended early' } });
    fireEvent.click(within(archiveDialog).getByRole('button', { name: /Archive/ }));
    await waitFor(() => expect(target.status).toBe('archived'), { timeout: 8000 });
    expect(await screen.findByRole('button', { name: `Active (${activeBefore - 1})` }, { timeout: 8000 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Archived \(\d+\)/ }));
    fireEvent.click(await screen.findByRole('button', { name: `Restore ${target.id}` }, { timeout: 8000 }));
    const restoreDialog = await screen.findByRole('dialog');
    fireEvent.change(within(restoreDialog).getByRole('textbox'), { target: { value: 'Campaign resumed after all' } });
    fireEvent.click(within(restoreDialog).getByRole('button', { name: /Restore/ }));
    await waitFor(() => expect(target.status).toBe('active'), { timeout: 8000 });
  });
});

describe('Social Media Posting — bulk selection', () => {
  it('selects a row, bulk-deletes it, and clears the selection on a filter change', async () => {
    mount();
    await heading(/Social Media Posting/);
    await screen.findByText('No posts match'); // data has actually loaded, before trusting any count
    await showAllFixtureDates();
    fireEvent.click(await screen.findByRole('button', { name: /Archived \(\d+\)/ }, { timeout: 8000 }));

    const archivedBefore = db.socialMediaPosts.filter((p) => p.status === 'archived').length;
    const table = await screen.findByRole('table');
    const rowCheckboxes = await waitFor(() => {
      const boxes = within(table).getAllByRole('checkbox').slice(1); // first is the header "select all"
      expect(boxes).toHaveLength(archivedBefore);
      return boxes;
    }, { timeout: 8000 });
    fireEvent.click(rowCheckboxes[0]);
    expect(await screen.findByText('1 selected')).toBeTruthy();

    // A new search term is a filter change — the selection must not survive it,
    // even though this particular row still matches and stays on screen.
    fireEvent.change(screen.getByLabelText(/Search/), { target: { value: 'x' } });
    await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
    fireEvent.change(screen.getByLabelText(/Search/), { target: { value: '' } });

    fireEvent.click(within(await screen.findByRole('table')).getAllByRole('checkbox').slice(1)[0]);
    await screen.findByText('1 selected');

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const deleteDialog = await screen.findByRole('dialog');
    expect(within(deleteDialog).getByText(/permanently delete 1 posting record/)).toBeTruthy();
    fireEvent.change(within(deleteDialog).getByRole('textbox'), { target: { value: 'Duplicate entry, removing it' } });
    fireEvent.click(within(deleteDialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(db.socialMediaPosts.filter((p) => p.status === 'archived').length).toBe(archivedBefore - 1), { timeout: 8000 });
    expect(screen.queryByText('1 selected')).toBeNull();
  });
});

describe('Social Media Posting — screenshot', () => {
  it('uploads a screenshot, shows it as a thumbnail, and can remove it', async () => {
    mount();
    await heading(/Social Media Posting/);
    await screen.findByText('No posts match');
    await showAllFixtureDates();

    const target = db.socialMediaPosts.find((p) => p.status === 'active')!;
    const uploadInput = await screen.findByLabelText(`Screenshot for ${target.id}`, {}, { timeout: 8000 });
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'proof.png', { type: 'image/png' });
    fireEvent.change(uploadInput, { target: { files: [png] } });

    await waitFor(() => expect(db.socialPostScreenshots.some((s) => s.postId === target.id)).toBe(true), { timeout: 8000 });
    await screen.findByRole('img', { name: `Screenshot for ${target.id}` }, { timeout: 8000 });

    fireEvent.click(await screen.findByRole('button', { name: `Remove screenshot for ${target.id}` }, { timeout: 8000 }));
    await waitFor(() => expect(db.socialPostScreenshots.some((s) => s.postId === target.id)).toBe(false), { timeout: 8000 });
    expect(await screen.findByRole('button', { name: `Upload screenshot for ${target.id}` }, { timeout: 8000 })).toBeTruthy();
  });
});
