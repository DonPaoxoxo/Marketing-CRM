/** Shared Spiel Library: the calls behind the page. The server re-checks every
 *  rule; hiding a button here is a courtesy, not the permission. */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/hooks/useData';
import type { AiAction, AiAssistResult, AiHistoryItem, AiSettings } from '@/lib/spiel-ai';
import type { AppNotification, Spiel, SpielCategory, SpielDetail, SpielDocument, SpielInput } from '@/lib/spiels';

export const SPIEL_KEY = ['spiels'] as const;

export class AiError extends ApiError {
  original: string;
  errorType: string;
  attempts: AiAssistResult['attempts'];
  constructor(message: string, status: number, original: string, errorType: string, attempts: AiAssistResult['attempts']) {
    super(message, status);
    this.original = original;
    this.errorType = errorType;
    this.attempts = attempts;
  }
}

export async function spielCall<T>(url: string, init: RequestInit = {}): Promise<T> {
  const binary = init.body instanceof ArrayBuffer || init.body instanceof Uint8Array;
  const res = await fetch(`/api${url}`, {
    ...init,
    credentials: 'same-origin',
    headers: binary || !init.body ? init.headers : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const payload = await res.json().catch(() => ({ message: res.status === 413 ? 'That file is too large.' : res.status === 501 ? 'The Shared Spiel Library needs the real API and database.' : res.statusText }));
  if (!res.ok) {
    if (payload.errorType) throw new AiError(payload.message, res.status, payload.original ?? '', payload.errorType, payload.attempts ?? []);
    throw new ApiError(payload.message ?? 'Request failed', res.status, payload.field, payload.conflictId);
  }
  return payload as T;
}

export const documentFileUrl = (docId: string, versionId: string, download = false) =>
  `/api/spiels/documents/${encodeURIComponent(docId)}/versions/${encodeURIComponent(versionId)}/file${download ? '?download' : ''}`;

/* ── Types ─────────────────────────────────────────────────────── */

export interface LibrarySpiel extends Spiel { pendingVersion: boolean }
export interface Library { spiels: LibrarySpiel[]; announcement: string; today: string; isSystemOwner: boolean; mayWrite: boolean }
export interface AiStatus { enabled: boolean; configured: boolean; mayUse: boolean; requestsLeftToday: number | null; maxRegenerations: number; primaryModel: string }
export interface AiLog {
  id: string; userName: string; action: string; status: string; model: string; usedFallback: boolean; fallbackAttempts: number;
  errorType: string; durationMs: number; totalTokens: number | null; createdAt: string;
  attempts: { model: string; outcome: string; errorType: string; httpStatus: number | null; durationMs: number }[];
}

/* ── Queries ───────────────────────────────────────────────────── */

export const useLibrary = () => useQuery({ queryKey: [...SPIEL_KEY, 'library'], queryFn: () => spielCall<Library>('/spiels/library') });
export const useMySpiels = () => useQuery({ queryKey: [...SPIEL_KEY, 'mine'], queryFn: () => spielCall<{ spiels: Spiel[] }>('/spiels/mine').then((r) => r.spiels) });
export const useReviews = (enabled: boolean) => useQuery({ queryKey: [...SPIEL_KEY, 'reviews'], enabled, queryFn: () => spielCall<{ spiels: Spiel[] }>('/spiels/reviews').then((r) => r.spiels) });
export const useCategories = () => useQuery({ queryKey: [...SPIEL_KEY, 'categories'], queryFn: () => spielCall<{ categories: SpielCategory[] }>('/spiels/categories').then((r) => r.categories), staleTime: 60_000 });
export const useSpiel = (id: string | null) => useQuery({ queryKey: [...SPIEL_KEY, 'detail', id], enabled: Boolean(id), queryFn: () => spielCall<SpielDetail>(`/spiels/${encodeURIComponent(id!)}`) });
export const useDocuments = () => useQuery({ queryKey: [...SPIEL_KEY, 'documents'], queryFn: () => spielCall<{ documents: SpielDocument[] }>('/spiels/documents').then((r) => r.documents) });
export const useDocument = (id: string | null) => useQuery({ queryKey: [...SPIEL_KEY, 'document', id], enabled: Boolean(id), queryFn: () => spielCall<SpielDocument>(`/spiels/documents/${encodeURIComponent(id!)}`) });
export const useAiStatus = () => useQuery({ queryKey: [...SPIEL_KEY, 'ai-status'], queryFn: () => spielCall<AiStatus>('/spiels/ai/status') });
export const useAiSettings = (enabled: boolean) => useQuery({ queryKey: [...SPIEL_KEY, 'ai-settings'], enabled, queryFn: () => spielCall<{ settings: AiSettings; configured: boolean }>('/spiels/ai/settings') });
export const useAiLogs = (enabled: boolean, failedOnly: boolean) => useQuery({
  queryKey: [...SPIEL_KEY, 'ai-logs', failedOnly], enabled,
  queryFn: () => spielCall<{ today: { requests: number; failed: number; fallbacks: number; tokens: number }; logs: AiLog[] }>(`/spiels/ai/logs${failedOnly ? '?status=failed' : ''}`),
});

/* ── Mutations ─────────────────────────────────────────────────── */

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SPIEL_KEY });
}

const reportError = (e: Error) => { if (!(e instanceof ApiError && e.status === 409 && e.field === 'content')) toast.error(e.message); };

export function useSaveSpiel() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...body }: SpielInput & { id?: string; submit: boolean; allowDuplicate?: boolean }) =>
      spielCall<SpielDetail>(id ? `/spiels/${encodeURIComponent(id)}` : '/spiels', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }),
    onSuccess: (s, vars) => {
      invalidate();
      toast.success(s.status === 'Pending Approval' ? (vars.id && s.approved ? `Version ${s.current.versionNo} sent for approval — the approved version stays live` : 'Submitted for approval') : 'Draft saved');
    },
    onError: reportError,
  });
}

export function useSpielAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action, feedback }: { id: string; action: string; feedback?: string }) =>
      spielCall<SpielDetail>(`/spiels/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ action, feedback }) }),
    onSuccess: (s) => { invalidate(); toast.success(`Spiel is now ${s.status}`); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteSpiel() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => spielCall(`/spiels/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }),
    onSuccess: () => { invalidate(); toast.success('Spiel deleted'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useSpielPersonal() {
  const invalidate = useInvalidate();
  return {
    use: useMutation({ mutationFn: (id: string) => spielCall(`/spiels/${encodeURIComponent(id)}/use`, { method: 'POST' }), onSuccess: invalidate }),
    favorite: useMutation({
      mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => spielCall(`/spiels/${encodeURIComponent(id)}/favorite`, { method: 'PUT', body: JSON.stringify({ favorite }) }),
      onSuccess: (_r, v) => { invalidate(); toast.success(v.favorite ? 'Added to favorites' : 'Removed from favorites'); },
      onError: (e: Error) => toast.error(e.message),
    }),
    note: useMutation({
      mutationFn: ({ id, body }: { id: string; body: string }) => spielCall(`/spiels/${encodeURIComponent(id)}/note`, { method: 'PUT', body: JSON.stringify({ body }) }),
      onSuccess: () => { invalidate(); toast.success('Personal note saved'); },
      onError: (e: Error) => toast.error(e.message),
    }),
  };
}

export function useComments() {
  const invalidate = useInvalidate();
  const opts = { onSuccess: invalidate, onError: (e: Error) => toast.error(e.message) };
  return {
    add: useMutation({ mutationFn: ({ spielId, body }: { spielId: string; body: string }) => spielCall(`/spiels/${encodeURIComponent(spielId)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }), ...opts }),
    edit: useMutation({ mutationFn: ({ id, body }: { id: string; body: string }) => spielCall(`/spiels/comments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ body }) }), ...opts }),
    remove: useMutation({ mutationFn: (id: string) => spielCall(`/spiels/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }), ...opts }),
  };
}

export function useCheckSimilar() {
  return useMutation({
    mutationFn: ({ content, exceptId }: { content: string; exceptId?: string }) =>
      spielCall<{ similar: { id: string; title: string; score: number }[] }>('/spiels/check-similar', { method: 'POST', body: JSON.stringify({ content, exceptId }) }).then((r) => r.similar),
  });
}

export function useUploadDocument() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ file, meta, replaceId }: { file: File; meta?: Record<string, unknown>; replaceId?: string }) =>
      spielCall<SpielDocument>(replaceId ? `/spiels/documents/${encodeURIComponent(replaceId)}/replace` : '/spiels/documents', {
        method: 'POST',
        body: await file.arrayBuffer(),
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
          'X-File-Type': file.type,
          ...(meta ? { 'X-Document-Meta': encodeURIComponent(JSON.stringify(meta)) } : {}),
        },
      }),
    onSuccess: (d, v) => { invalidate(); toast.success(v.replaceId ? `Version ${d.current.versionNo} uploaded` : d.status === 'Pending Review' ? 'Document submitted for review' : 'Document saved as draft'); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDocumentMutations() {
  const invalidate = useInvalidate();
  const onError = (e: Error) => toast.error(e.message);
  return {
    update: useMutation({ mutationFn: ({ id, ...meta }: Record<string, unknown> & { id: string }) => spielCall<SpielDocument>(`/spiels/documents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(meta) }), onSuccess: () => { invalidate(); toast.success('Document details saved'); }, onError }),
    action: useMutation({ mutationFn: ({ id, action, feedback }: { id: string; action: string; feedback?: string }) => spielCall<SpielDocument>(`/spiels/documents/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ action, feedback }) }), onSuccess: (d) => { invalidate(); toast.success(`Document is now ${d.status}`); }, onError }),
    remove: useMutation({ mutationFn: ({ id, reason }: { id: string; reason: string }) => spielCall(`/spiels/documents/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) }), onSuccess: () => { invalidate(); toast.success('Document deleted'); }, onError }),
  };
}

export function useAssist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: AiAction; text: string } & Record<string, unknown>) => spielCall<AiAssistResult>('/spiels/ai/assist', { method: 'POST', body: JSON.stringify(body) }),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [...SPIEL_KEY, 'ai-status'] });
      qc.invalidateQueries({ queryKey: [...SPIEL_KEY, 'ai-history'] });
    },
  });
}

export const useAiHistory = (enabled = true) => useQuery({
  queryKey: [...SPIEL_KEY, 'ai-history'], enabled,
  queryFn: () => spielCall<{ items: AiHistoryItem[]; total: number }>('/spiels/ai/history?limit=200'),
});

export function useAiHistoryMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: [...SPIEL_KEY, 'ai-history'] });
  const onError = (e: Error) => toast.error(e.message);
  return {
    remove: useMutation({ mutationFn: (id: string) => spielCall(`/spiels/ai/history/${encodeURIComponent(id)}`, { method: 'DELETE' }), onSuccess: () => { done(); toast.success('Removed from your AI history'); }, onError }),
    clear: useMutation({ mutationFn: (reason: string) => spielCall<{ removed: number }>('/spiels/ai/history', { method: 'DELETE', body: JSON.stringify({ reason }) }), onSuccess: (r) => { done(); toast.success(`Cleared ${r.removed} entries from your AI history`); }, onError }),
  };
}

export function useOwnerSettings() {
  const invalidate = useInvalidate();
  const onError = (e: Error) => toast.error(e.message);
  return {
    ai: useMutation({ mutationFn: (s: AiSettings) => spielCall('/spiels/ai/settings', { method: 'PUT', body: JSON.stringify(s) }), onSuccess: () => { invalidate(); toast.success('AI settings saved'); }, onError }),
    checkModels: useMutation({ mutationFn: (ids: string[]) => spielCall<{ availability: Record<string, boolean> | null; checkedAt: string }>('/spiels/ai/models/check', { method: 'POST', body: JSON.stringify({ ids }) }), onError }),
    addCategory: useMutation({ mutationFn: (name: string) => spielCall('/spiels/categories', { method: 'POST', body: JSON.stringify({ name }) }), onSuccess: () => { invalidate(); toast.success('Category added'); }, onError }),
    updateCategory: useMutation({ mutationFn: ({ id, ...body }: { id: string; name?: string; active?: boolean }) => spielCall(`/spiels/categories/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }), onSuccess: invalidate, onError }),
    reorder: useMutation({ mutationFn: (ids: string[]) => spielCall('/spiels/categories/order', { method: 'PUT', body: JSON.stringify({ ids }) }), onSuccess: invalidate, onError }),
    announcement: useMutation({ mutationFn: (announcement: string) => spielCall('/spiels/announcement', { method: 'PUT', body: JSON.stringify({ announcement }) }), onSuccess: () => { invalidate(); toast.success('Announcement saved'); }, onError }),
  };
}

/* ── Notifications ─────────────────────────────────────────────── */

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: ['notifications'],
    enabled,
    refetchInterval: 60_000,
    queryFn: () => spielCall<{ notifications: AppNotification[]; unread: number }>('/notifications'),
  });
}

export function useNotificationMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  return {
    read: useMutation({ mutationFn: (id: string) => spielCall(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }), onSuccess: done }),
    readAll: useMutation({ mutationFn: () => spielCall('/notifications/read-all', { method: 'POST' }), onSuccess: done }),
  };
}

/** Copy to the clipboard, with a fallback for browsers that block the async API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}
