// @vitest-environment jsdom
/** The Team and access panel against a stand-in for `/api/users`.
 *
 *  The stand-in enforces the same guard rails as the server, so these tests
 *  would catch the panel sending something the server refuses — not only the
 *  panel drawing itself. */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TeamAccess } from './TeamAccess';
import type { TeamUser } from './api';

const API = `${window.location.origin}/api/users`;
const TOKEN = 'tok_0123456789abcdefghij';

let users: TeamUser[];
let requests: { method: string; path: string; body: unknown }[];

const person = (over: Partial<TeamUser>): TeamUser => ({
  id: 'TM-0000', email: 'x@example.com', name: 'X', title: '', role: 'Marketing Staff',
  active: true, status: 'active', lastLoginAt: null, ...over,
});

const server = setupServer(
  http.get(API, () => HttpResponse.json({ users })),
  http.post(API, async ({ request }) => {
    const body = (await request.json()) as { email: string; name: string; title: string; role: TeamUser['role'] };
    requests.push({ method: 'POST', path: '', body });
    if (users.some((u) => u.email === body.email.toLowerCase())) {
      return HttpResponse.json({ message: 'Someone already has that email address.', field: 'email' }, { status: 409 });
    }
    const user = person({ id: 'TM-0099', ...body, status: 'invited' });
    users.push(user);
    return HttpResponse.json({ user, inviteToken: TOKEN, inviteExpiresAt: '2026-09-16T07:00:00.000Z' }, { status: 201 });
  }),
  http.patch(`${API}/:id`, async ({ request, params }) => {
    const body = (await request.json()) as Partial<TeamUser> & { reason?: string };
    requests.push({ method: 'PATCH', path: String(params.id), body });
    const user = users.find((u) => u.id === params.id)!;
    Object.assign(user, body);
    return HttpResponse.json({ user });
  }),
  http.post(`${API}/:id/invite`, ({ params }) => {
    requests.push({ method: 'POST', path: `${params.id}/invite`, body: null });
    return HttpResponse.json({ inviteToken: TOKEN, inviteExpiresAt: '2026-09-16T07:00:00.000Z' });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => cleanup());
beforeEach(() => {
  requests = [];
  users = [
    person({ id: 'TM-0001', name: 'Ana', email: 'ana@example.com', role: 'System Administrator', lastLoginAt: '2026-09-13T07:10:00.000Z' }),
    person({ id: 'TM-0002', name: 'DK', email: 'dk@example.com', status: 'invited' }),
    person({ id: 'TM-0003', name: 'Timon', email: 'timon@example.com', status: 'no-access' }),
    person({ id: 'TM-0004', name: 'Bea', email: 'bea@example.com', active: false }),
    person({ id: 'TM-0005', name: 'Gordon', email: 'gordon@example.com' }),
  ];
});

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TeamAccess currentUserId="TM-0001" />
    </QueryClientProvider>,
  );
}

const row = async (name: string) => (await screen.findByRole('rowheader', { name: new RegExp(`^${name}\\b`) })).closest('tr')!;

describe('Team and access', () => {
  it('shows each person’s access in words, not just a colour', async () => {
    mount();
    expect(within(await row('Ana')).getByText('Signed up')).toBeTruthy();
    expect(within(await row('DK')).getByText('Invited, waiting')).toBeTruthy();
    expect(within(await row('Timon')).getByText('Link expired')).toBeTruthy();
    expect(within(await row('Bea')).getByText('Deactivated')).toBeTruthy();
    expect(within(await row('Ana')).getByText('(you)')).toBeTruthy();
  });

  it('will not let the only administrator deactivate themselves, and says why', async () => {
    mount();
    const ana = await row('Ana');
    const button = within(ana).getByRole('button', { name: 'Deactivate Ana' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(within(ana).getByText('You cannot deactivate your own account.')).toBeTruthy();
  });

  it('adds a person and shows their link exactly once, built on this site’s address', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Add person/ }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Marwin' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'marwin@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Job title/), { target: { value: 'Marketing Editor' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and get link' }));

    const link = (await screen.findByLabelText('Link')) as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/accept-invite?token=${TOKEN}`);
    expect(screen.getByText(/only time it is shown/)).toBeTruthy();
    expect(requests[0]).toEqual({
      method: 'POST', path: '',
      body: { name: 'Marwin', email: 'marwin@example.com', title: 'Marketing Editor', role: 'Marketing Staff' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'I have sent it' }));
    await waitFor(() => expect(screen.queryByLabelText('Link')).toBeNull());
  });

  it('puts a duplicate-email refusal under the Email field', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /Add person/ }));
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'Another DK' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'DK@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create and get link' }));
    expect(await screen.findByText('Someone already has that email address.')).toBeTruthy();
    expect(screen.queryByLabelText('Link')).toBeNull();
  });

  it('calls a link for someone with a password a reset, and warns what it does', async () => {
    mount();
    expect(within(await row('DK')).getByRole('button', { name: 'New invite link for DK' })).toBeTruthy();

    fireEvent.click(within(await row('Gordon')).getByRole('button', { name: 'Password reset link for Gordon' }));
    expect(await screen.findByText(/Whoever opens this link can replace it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create reset link' }));

    expect(((await screen.findByLabelText('Link')) as HTMLInputElement).value).toContain(TOKEN);
    expect(requests).toEqual([{ method: 'POST', path: 'TM-0005/invite', body: null }]);
  });

  it('deactivates only with a written reason, and sends that reason', async () => {
    mount();
    fireEvent.click(within(await row('Gordon')).getByRole('button', { name: 'Deactivate Gordon' }));
    const confirm = screen.getByRole('button', { name: 'Deactivate account' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Left the team on 13 Sep' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(requests).toEqual([
      { method: 'PATCH', path: 'TM-0005', body: { active: false, reason: 'Left the team on 13 Sep' } },
    ]));
  });

  it('refuses to demote the last administrator before sending anything', async () => {
    mount();
    fireEvent.click(within(await row('Ana')).getByRole('button', { name: 'Change role for Ana' }));
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'Marketing Manager' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Stepping back from admin work' } });

    expect(screen.getByText(/only active administrator/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Change role' }) as HTMLButtonElement).disabled).toBe(true);
    expect(requests).toEqual([]);
  });

  it('changes a role with its reason', async () => {
    mount();
    fireEvent.click(within(await row('Gordon')).getByRole('button', { name: 'Change role for Gordon' }));
    fireEvent.change(screen.getByLabelText(/^Role/), { target: { value: 'System Administrator' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Second administrator for cover' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change role' }));

    await waitFor(() => expect(requests).toEqual([
      { method: 'PATCH', path: 'TM-0005', body: { role: 'System Administrator', reason: 'Second administrator for cover' } },
    ]));
  });
});
