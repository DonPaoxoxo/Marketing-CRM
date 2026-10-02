/** Social Media Posting: bulk actions beyond what the generic useCreate/useUpdate
 *  hooks (src/hooks/useData.ts) cover for single-record create/edit/archive/restore. */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, BOOTSTRAP_KEY, useActorQuery, withActor } from '@/hooks/useData';
import type { SocialPostScreenshot } from '@/lib/types';

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const payload = await res.json().catch(() => ({ message: res.statusText }));
  if (!res.ok) throw new ApiError(payload.message ?? 'Request failed', res.status, payload.field, payload.conflictId);
  return payload as T;
}

/** Permanent. One DELETE request per id, in parallel, with one summary toast
 *  rather than one per record — the same shape as Team Reports' bulk delete. */
export function useBulkDeleteSocialPosts() {
  const qc = useQueryClient();
  const actor = useActorQuery();
  return useMutation({
    mutationFn: async ({ ids, reason }: { ids: string[]; reason: string }) => {
      const results = await Promise.allSettled(
        ids.map((id) => call<{ deleted: string }>(withActor(`/api/social-media-posts/${id}`, actor), {
          method: 'DELETE', body: JSON.stringify({ reason }),
        })),
      );
      return { total: ids.length, failed: results.filter((r) => r.status === 'rejected').length };
    },
    onSuccess: ({ total, failed }) => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      if (failed > 0) {
        toast.error(`${total - failed} of ${total} post${total === 1 ? '' : 's'} deleted — ${failed} failed.`);
      } else {
        toast.success(`${total} posting record${total === 1 ? '' : 's'} deleted successfully`);
      }
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** Archives several posts at once — one PATCH per id, in parallel. Restoring
 *  reuses the same shape with status: 'active'. */
export function useBulkSetSocialPostsStatus() {
  const qc = useQueryClient();
  const actor = useActorQuery();
  return useMutation({
    mutationFn: async ({ ids, status, reason }: { ids: string[]; status: 'active' | 'archived'; reason: string }) => {
      const results = await Promise.allSettled(
        ids.map((id) => call(withActor(`/api/social-media-posts/${id}`, actor), {
          method: 'PATCH', body: JSON.stringify({ status, reason }),
        })),
      );
      return { total: ids.length, failed: results.filter((r) => r.status === 'rejected').length, status };
    },
    onSuccess: ({ total, failed, status }) => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      const verb = status === 'archived' ? 'archived' : 'restored';
      if (failed > 0) {
        toast.error(`${total - failed} of ${total} post${total === 1 ? '' : 's'} ${verb} — ${failed} failed.`);
      } else {
        toast.success(`${total} posting record${total === 1 ? '' : 's'} ${verb}`);
      }
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

/** Where a post's screenshot is served from. Same origin, so the session
 *  cookie goes with it — the image is never carried in the bootstrap payload. */
export const screenshotImageUrl = (postId: string) => `/api/social-media-posts/${encodeURIComponent(postId)}/screenshot`;

export function useUploadScreenshot() {
  const qc = useQueryClient();
  const actor = useActorQuery();
  return useMutation({
    mutationFn: ({ postId, image }: { postId: string; image: string }) =>
      call<SocialPostScreenshot>(withActor(`/api/social-media-posts/${postId}/screenshot`, actor), {
        method: 'POST', body: JSON.stringify({ image }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success('Screenshot uploaded');
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}

export function useRemoveScreenshot() {
  const qc = useQueryClient();
  const actor = useActorQuery();
  return useMutation({
    mutationFn: ({ postId }: { postId: string }) =>
      call<{ removed: string }>(withActor(`/api/social-media-posts/${postId}/screenshot`, actor), { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
      toast.success('Screenshot removed');
    },
    onError: (e: ApiError) => toast.error(e.message),
  });
}
