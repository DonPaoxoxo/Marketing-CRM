// @vitest-environment jsdom
/** The account form refuses a page that is already registered, before saving.
 *
 *  The server refuses it too; this is about the person typing seeing why at the
 *  field, instead of pressing Save and getting a toast. */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { setupServer } from 'msw/node';
import { http } from 'msw';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_ORIGIN, handlers } from '@/mocks/handlers';
import { db, loadFixtures } from '@/mocks/db';
import { SessionProvider } from '@/hooks/useSession';
import { AccountFormDialog } from './AccountFormDialog';

let posts = 0;
const server = setupServer(
  // Counts attempts to save, then lets the normal mock answer.
  http.post(`${API_ORIGIN}/api/social-accounts`, () => { posts++; return undefined; }),
  ...handlers,
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => { loadFixtures(); posts = 0; });
afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <MemoryRouter>
          <AccountFormDialog open onOpenChange={() => undefined} />
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

describe('account form', () => {
  it('shows the clash at the Profile URL field and does not send the save', async () => {
    const existing = db.socialAccounts.find((a) => !a.archived)!;
    existing.profileUrl = 'https://www.facebook.com/xBrightgamers';
    mount();

    // Wait for the workspace to load, so the form has something to compare against.
    await waitFor(() => expect(document.getElementById('acc-platform')!.querySelectorAll('option').length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText(/^Username or handle/), { target: { value: 'Lenny' } });
    fireEvent.change(screen.getByLabelText(/^Display name/), { target: { value: 'Bright Gamers' } });
    fireEvent.change(screen.getByLabelText(/^Profile URL/), { target: { value: 'https://www.facebook.com/xBrightgamers' } });

    expect(await screen.findByText(new RegExp(`already registered on ${existing.id}`))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Register account' }));
    // Give a submit the chance to happen, then confirm it did not.
    await new Promise((r) => setTimeout(r, 300));
    expect(posts).toBe(0);
  });

  it('accepts the same handle on a different page', async () => {
    const existing = db.socialAccounts.find((a) => !a.archived)!;
    existing.username = 'Lenny';
    mount();
    await waitFor(() => expect(document.getElementById('acc-platform')!.querySelectorAll('option').length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText(/^Username or handle/), { target: { value: 'Lenny' } });
    expect(screen.queryByText(/already/i)).toBeNull();
  });
});
