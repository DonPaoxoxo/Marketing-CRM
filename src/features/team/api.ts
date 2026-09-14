/** The people who can sign in, and the calls that change who can.
 *
 *  Only the real API serves these — the mock has no accounts — so nothing here
 *  is reached unless a signed-in administrator opens the Team and access tab.
 *  Every call is authorised again on the server against `manage:users`; the tab
 *  being hidden from other roles is a convenience, not the check. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, BOOTSTRAP_KEY } from '@/hooks/useData';
import type { RoleName } from '@/lib/types';

/** `no-access` means no password yet and no usable invite — the link expired. */
export type AccountStatus = 'active' | 'invited' | 'no-access';

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  title: string;
  role: RoleName;
  active: boolean;
  status: AccountStatus;
  lastLoginAt: string | null;
}

export interface IssuedInvite {
  inviteToken: string;
  inviteExpiresAt: string;
}

export const TEAM_USERS_KEY = ['team-users'] as const;

async function call<T>(path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`/api/users${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({ message: res.statusText }));
  if (!res.ok) {
    throw new ApiError(payload.message ?? 'Request failed', res.status, payload.field, payload.conflictId);
  }
  return payload as T;
}

/** The link a person opens to set their password.
 *
 *  Built from the page's own origin, which on the live site is the same
 *  address the server puts in seeded invites — so a link copied from here and
 *  one from `invites.local.txt` are interchangeable. */
export function inviteLink(token: string, origin = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;
}

export function useTeamUsers(enabled = true) {
  return useQuery({
    queryKey: TEAM_USERS_KEY,
    queryFn: async () => (await call<{ users: TeamUser[] }>('')).users,
    enabled,
  });
}

/** After any change the team list is stale, and so is the workspace payload —
 *  its `teamMembers` feed every owner and assignee dropdown in the app. */
function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: TEAM_USERS_KEY });
    qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: { name: string; email: string; title: string; role: RoleName }) =>
      call<{ user: TeamUser } & IssuedInvite>('', 'POST', input),
    onSuccess: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...patch }: { id: string; role?: RoleName; active?: boolean; reason?: string }) =>
      call<{ user: TeamUser }>(`/${encodeURIComponent(id)}`, 'PATCH', patch),
    onSuccess: invalidate,
  });
}

export function useReissueInvite() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => call<IssuedInvite>(`/${encodeURIComponent(id)}/invite`, 'POST', {}),
    onSuccess: invalidate,
  });
}
