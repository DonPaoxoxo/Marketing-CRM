import * as React from 'react';
import { CONFIG } from '@/lib/config';
import type { Permission, RoleName } from '@/lib/types';

/** Who is signed in.
 *
 *  While the mock API is serving there is no server to ask, so this reports
 *  `disabled` and the app runs exactly as it did — the synthetic role preview
 *  stays in charge. Once `VITE_USE_MOCK_API=false`, the real session governs. */

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'disabled';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  title: string;
  role: RoleName;
  active: boolean;
  /** Effective permissions resolved by the server. */
  permissions?: Permission[];
}

interface AuthValue {
  status: AuthStatus;
  user: AuthUser | null;
  /** Throws with a readable message on bad credentials. */
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DISABLED: AuthValue = {
  status: 'disabled',
  user: null,
  signIn: async () => undefined,
  signOut: async () => undefined,
  refresh: async () => undefined,
};

const AuthContext = React.createContext<AuthValue | null>(null);

export async function authRequest<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    // The session lives in an httpOnly cookie, so it has to be sent explicitly.
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({ message: res.statusText }));
  if (!res.ok) throw new Error(payload.message ?? 'Request failed');
  return payload as T;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = React.useState<AuthStatus>(CONFIG.useMockApi ? 'disabled' : 'loading');
  const [user, setUser] = React.useState<AuthUser | null>(null);

  const refresh = React.useCallback(async () => {
    if (CONFIG.useMockApi) return;
    try {
      const { user: me } = await authRequest<{ user: AuthUser }>('me');
      setUser(me);
      setStatus('authenticated');
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = React.useCallback(async (email: string, password: string) => {
    await authRequest<{ user: AuthUser }>('login', { email, password });
    // The session read resolves the person's live permissions; use it as the one source.
    const { user: me } = await authRequest<{ user: AuthUser }>('me');
    setUser(me);
    setStatus('authenticated');
  }, []);

  const signOut = React.useCallback(async () => {
    await authRequest('logout', {}).catch(() => undefined);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = React.useMemo<AuthValue>(
    () => (CONFIG.useMockApi ? DISABLED : { status, user, signIn, signOut, refresh }),
    [status, user, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Returns a disabled session rather than throwing when there is no provider.
 *
 *  Deliberate: every route renders fine without authentication while the mock is
 *  serving, and the test suite mounts pages directly. A hard throw here would
 *  make auth a dependency of screens that do not need one. */
export function useAuth(): AuthValue {
  return React.useContext(AuthContext) ?? DISABLED;
}
