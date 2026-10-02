import * as React from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PROOF_ACCEPT, checkProofImage } from '@/lib/proofs';
import type { SocialMediaPost, SocialPostScreenshot } from '@/lib/types';
import { screenshotImageUrl, useRemoveScreenshot, useUploadScreenshot } from './api';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** One screenshot per post: a thumbnail that opens the full image, or an
 *  upload button when there isn't one yet. Uploads immediately on choosing a
 *  file — there is nothing else to fill in, so a confirmation dialog would
 *  only add a click. */
export function ScreenshotCell({
  post, screenshot, canEdit,
}: { post: SocialMediaPost; screenshot?: SocialPostScreenshot; canEdit: boolean }) {
  const upload = useUploadScreenshot();
  const remove = useRemoveScreenshot();
  const input = React.useRef<HTMLInputElement>(null);
  const [error, setError] = React.useState<string>();

  const choose = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = checkProofImage(bytes);
    if ('error' in checked) { setError(checked.error); return; }
    setError(undefined);
    try {
      await upload.mutateAsync({ postId: post.id, image: toBase64(bytes) });
    } catch { /* toast shown by the mutation */ }
  };

  return (
    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        ref={input} type="file" accept={PROOF_ACCEPT} className="sr-only" tabIndex={-1}
        aria-label={`Screenshot for ${post.id}`}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }}
      />
      {screenshot ? (
        <>
          <a href={screenshotImageUrl(post.id)} target="_blank" rel="noopener noreferrer" title="Open screenshot">
            <img
              src={screenshotImageUrl(post.id)} alt={`Screenshot for ${post.id}`} loading="lazy"
              className="h-9 w-9 rounded border border-border object-cover"
            />
          </a>
          {canEdit && (
            <Button
              size="icon-sm" variant="ghost" aria-label={`Remove screenshot for ${post.id}`}
              disabled={upload.isPending || remove.isPending}
              onClick={() => remove.mutate({ postId: post.id })}
            >
              <Trash2 />
            </Button>
          )}
        </>
      ) : canEdit ? (
        <Button
          size="icon-sm" variant="ghost" aria-label={`Upload screenshot for ${post.id}`} disabled={upload.isPending}
          onClick={() => input.current?.click()}
        >
          <ImagePlus />
        </Button>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
