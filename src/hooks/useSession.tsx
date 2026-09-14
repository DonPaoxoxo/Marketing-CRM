import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { hasPermission } from '@/lib/permissions';
import { useAuth } from './useAuth';
import type { Permission, RoleName } from '@/lib/types';

/** SYNTHETIC role switching for the preview.
 *  There is no authentication here. Production must resolve the acting user
 *  server-side and enforce the permission matrix on every request. */

const ACTORS: { id: string; name: string; role: RoleName }[] = [
  { id: 'TM-01', name: 'Priya Raghunathan', role: 'System Administrator' },
  { id: 'TM-02', name: 'Devan Sharma', role: 'Marketing Manager' },
  { id: 'TM-04', name: 'Rohit Menon', role: 'Marketing Staff' },
  { id: 'TM-07', name: 'Meera Iyer', role: 'Read-only Reviewer' },
];

interface SessionValue {
  actorId: string;
  actorName: string;
  role: RoleName;
  actors: typeof ACTORS;
  setRole: (r: RoleName) => void;
  can: (p: Permission) => boolean;
  /** Live permissions for a signed-in person; undefined in the preview (role defaults apply). */
  permissions: Permission[] | undefined;
  /** Whether full phone numbers and email addresses are currently shown.
   *  Permission is necessary but not sufficient — they stay masked until asked for. */
  showContactDetails: boolean;
  mayRevealContactDetails: boolean;
  setContactRevealed: (v: boolean) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const [previewRole, setRoleState] = useState<RoleName>('System Administrator');

  // A signed-in user's role comes from their session row and cannot be changed
  // from the browser. The preview role only applies while the mock is serving.
  const role: RoleName = auth.user?.role ?? previewRole;
  // Deliberately not persisted: a reload re-masks. Opening a register should not
  // put a screenful of real phone numbers in front of whoever is walking past.
  const [contactRevealed, setContactRevealed] = useState(false);

  const previewActor = ACTORS.find((a) => a.role === role) ?? ACTORS[0];
  const actor = auth.user ?? previewActor;
  // A signed-in person carries the permissions the server resolved; the preview uses role defaults.
  const livePermissions = auth.user?.permissions;
  const can = useCallback((p: Permission) => hasPermission({ role, permissions: livePermissions }, p), [role, livePermissions]);
  const mayRevealContactDetails = can('view:contact-details');

  const value = useMemo<SessionValue>(
    () => ({
      actorId: actor.id,
      actorName: actor.name,
      role,
      actors: ACTORS,
      // Switching role is a preview device; a real session cannot re-role itself.
      setRole: auth.user ? () => undefined : setRoleState,
      can,
      permissions: livePermissions,
      mayRevealContactDetails,
      showContactDetails: mayRevealContactDetails && contactRevealed,
      setContactRevealed,
    }),
    [actor.id, actor.name, role, can, livePermissions, mayRevealContactDetails, contactRevealed, auth.user],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
