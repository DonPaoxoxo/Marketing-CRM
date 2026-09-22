import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useSession } from './useSession';
import { CONFIG } from '@/lib/config';
import { bootstrapFor } from '@/lib/access';
import { useAuth } from './useAuth';
import type { Agent, AgentProof, AuditEntry, Bootstrap } from '@/lib/types';

// The shape itself lives in the domain model so the server can share it.
export type { Bootstrap } from '@/lib/types';

export class ApiError extends Error {
  status: number;
  field?: string;
  conflictId?: string;
  constructor(message: string, status: number, field?: string, conflictId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
    this.conflictId = conflictId;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    // The session cookie is httpOnly and SameSite=Lax, and the API is proxied
    // onto this origin, so same-origin is both sufficient and the strictest
    // setting that works. Stated rather than left to the default.
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new ApiError(body.message ?? 'Request failed', res.status, body.field, body.conflictId);
  }
  return res.json() as Promise<T>;
}

export const BOOTSTRAP_KEY = ['bootstrap'] as const;

/** Identity of the acting user, for attribution in the audit trail.
 *
 *  Only the mock reads this. The real API resolves the caller from the session
 *  cookie and ignores anything the request claims about who sent it, which is
 *  why this is an empty string there rather than a signed or hashed assertion —
 *  a client-supplied identity has no value once the server has a real one.
 *
 *  The mock still needs it: it has no sessions, and an audit trail attributed to
 *  nobody would make the history screens untestable. */
export function useActorQuery() {
  const { actorId, actorName, role } = useSession();
  return useMemo(
    () => (CONFIG.useMockApi
      ? `actorId=${encodeURIComponent(actorId)}&actorName=${encodeURIComponent(actorName)}&actorRole=${encodeURIComponent(role)}`
      : ''),
    [actorId, actorName, role],
  );
}

/** Appends the actor query only when there is one, so real requests carry a
 *  clean URL rather than a trailing `?`. */
export const withActor = (path: string, actorQuery: string): string =>
  actorQuery ? `${path}${path.includes('?') ? '&' : '?'}${actorQuery}` : path;

export function useBootstrap() {
  return useQuery({
    queryKey: BOOTSTRAP_KEY,
    queryFn: () => request<Bootstrap>('/api/bootstrap'),
    staleTime: 30_000,
  });
}

/** Every collection plus the lookup helpers each module needs. */
export function useCrmData() {
  // See bootstrapFor: restricted areas are removed from the view of anyone without them.
  // The real server already leaves them out; this also covers the preview.
  const query = useBootstrap();
  const { role } = useSession();
  const livePermissions = useAuth().user?.permissions;
  const d = useMemo(() => (query.data ? bootstrapFor(query.data, { role, permissions: livePermissions }) : query.data), [query.data, role, livePermissions]);

  const lookups = useMemo(() => {
    const brandById = new Map((d?.brands ?? []).map((b) => [b.id, b]));
    const projectById = new Map((d?.projects ?? []).map((p) => [p.id, p]));
    const platformById = new Map((d?.platforms ?? []).map((p) => [p.id, p]));
    const memberById = new Map((d?.teamMembers ?? []).map((m) => [m.id, m]));
    const agentById = new Map((d?.agents ?? []).map((a) => [a.id, a]));
    const simById = new Map((d?.sims ?? []).map((s) => [s.id, s]));
    const accountById = new Map((d?.socialAccounts ?? []).map((a) => [a.id, a]));
    const countryByCode = new Map((d?.countries ?? []).map((c) => [c.code, c]));
    const credentialById = new Map((d?.credentials ?? []).map((c) => [c.id, c]));

    return {
      brandById, projectById, platformById, memberById, agentById, simById, accountById, countryByCode, credentialById,
      brandName: (id: string | null) => (id ? brandById.get(id)?.name ?? id : '—'),
      projectName: (id: string | null) => (id ? projectById.get(id)?.name ?? id : '—'),
      platformName: (id: string) => platformById.get(id)?.name ?? id,
      countryName: (code: string | null) => (code ? countryByCode.get(code)?.name ?? code : '—'),
      /** Resolves a team member OR agent id to a display name. */
      personName: (id: string | null) => {
        if (!id) return '—';
        return memberById.get(id)?.name ?? agentById.get(id)?.name ?? id;
      },
    };
  }, [d]);

  return { ...query, data: d, lookups };
}

/* ── Mutations ────────────────────────────────────────────────── */

type Entity = 'sims' | 'agents' | 'social-accounts' | 'assignments' | 'credentials' | 'domains' | 'content-posts' | 'pakistan-competitors';

export function useCreate<T>(entity: Entity, label = 'Record') {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      request<T>(withActor(`/api/${entity}`, actorQuery), { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success(`${label} created`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

export function useUpdate<T>(entity: Entity, label = 'Record') {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    mutationFn: ({ id, ...payload }: { id: string } & Record<string, unknown>) =>
      request<T>(withActor(`/api/${entity}/${id}`, actorQuery), { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success(`${label} updated`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** What an import reports back: rows skipped are named with the reason, so a
 *  person can fix those rows and upload them again. */
export interface ImportResult {
  created: number;
  /** Existing records updated (domain uploads with overwrite on). */
  updated?: number;
  /** Existing records the sheet matched exactly — nothing to change. */
  unchanged?: number;
  skipped: number;
  problems?: { row: number; reason: string }[];
}

export function useImportCommit(entity: 'sims' | 'agents' | 'social-accounts' | 'domains') {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    // fallbackCountryCode: for SIM numbers written without a country code.
    mutationFn: (payload: { rows: Record<string, unknown>[]; reason?: string; fallbackCountryCode?: string; overwrite?: boolean }) =>
      request<ImportResult>(withActor(`/api/import/${entity}`, actorQuery), {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success(`Imported ${r.created} record${r.created === 1 ? '' : 's'}${r.updated ? `, updated ${r.updated}` : ''}`, {
        description: r.skipped ? `${r.skipped} row(s) skipped — see the import summary.` : undefined,
      });
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** Logs an export event to the audit trail. The exported data itself never leaves the browser. */
export function useLogAudit() {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useCallback(
    async (entry: {
      recordType: string; recordId: string; recordLabel: string;
      action: AuditEntry['action']; reason: string;
      changes?: { field: string; from: string | null; to: string | null }[];
    }) => {
      await request<AuditEntry>(withActor('/api/audit', actorQuery), {
        method: 'POST',
        body: JSON.stringify({ changes: [], ...entry }),
      }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
    },
    [actorQuery, qc],
  );
}

/* ── Agent proofs ─────────────────────────────────────────────── */

/** Upload a proof image (base64) with its Post URL. The server checks the size,
 *  the real image type, the Post URL and the agent's edit lock again. */
export function useUploadProof() {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    mutationFn: ({ agentId, ...payload }: { agentId: string; postUrl: string; image: string }) =>
      request<AgentProof>(withActor(`/api/agents/${agentId}/proofs`, actorQuery), { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success('Proof uploaded');
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

export function useRemoveProof() {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      request<AgentProof>(withActor(`/api/agent-proofs/${id}`, actorQuery), { method: 'PATCH', body: JSON.stringify({ archived: true, reason }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success('Proof removed');
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** Verdict and payment on a proof. System Administrator only; the server decides. */
export function useReviewProof() {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; verdict?: 'Accepted' | 'Rejected'; reason?: string; payment?: 'Paid' | 'Not paid' }) =>
      request<AgentProof>(withActor(`/api/agent-proofs/${id}/review`, actorQuery), { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (proof) => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success(`Proof ${proof.id}: ${proof.verdict ?? 'Not reviewed'} · ${proof.payment}`);
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** Salary status on an agent. System Administrator only; the server decides. */
export function useSetSalaryStatus() {
  const qc = useQueryClient();
  const actorQuery = useActorQuery();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: 'Hold' | 'Advance' | 'Customize' | null; note?: string }) =>
      request<Agent>(withActor(`/api/agents/${encodeURIComponent(id)}/salary`, actorQuery), { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success(agent.salaryStatus ? `Salary status: ${agent.salaryStatus === 'Customize' ? agent.salaryNote : agent.salaryStatus}` : 'Salary status cleared');
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** Where a proof image is served from. Same origin, so the session cookie goes with it. */
export const proofImageUrl = (id: string) => `/api/agent-proofs/${encodeURIComponent(id)}/image`;
