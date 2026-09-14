import * as React from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, ImagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { ApiError } from '@/hooks/useData';
import { checkAdsUrl } from '@/lib/ads/campaign';
import { CREATIVE_ACCEPT, CREATIVE_HEIGHT, CREATIVE_WIDTH, checkCreative, formatBytes } from '@/lib/ads/files';
import { formatDate } from '@/lib/utils';
import { creativeUrl, useUploadCreative, type CreativeSummary } from './api';

/** A new-tab link out to the Ads Library, with safe attributes. */
export function AdsLibraryLink({ href, label = 'Open in Ads Library' }: { href: string; label?: string }) {
  if (!href || !/^https?:\/\//i.test(href)) return <span className="text-muted-foreground">—</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer external" className="inline-flex items-center gap-1 whitespace-nowrap text-primary hover:underline">
      {label} <ExternalLink className="h-3 w-3" aria-hidden="true" />
    </a>
  );
}

/** Full-size viewer with previous/next. Aspect ratio is always preserved. */
export function CreativeViewer({ creatives, index, onIndex, onClose, campaignAdsUrl }: {
  creatives: (CreativeSummary & { usedFrom?: string | null; usedTo?: string | null })[]; index: number | null; onIndex: (i: number) => void; onClose: () => void; campaignAdsUrl?: string;
}) {
  const current = index === null ? undefined : creatives[index];
  const go = (delta: number) => { if (index !== null) onIndex((index + delta + creatives.length) % creatives.length); };
  return (
    <Dialog open={Boolean(current)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="lg" onKeyDown={(e) => { if (e.key === 'ArrowLeft') go(-1); if (e.key === 'ArrowRight') go(1); }}>
        {current && (
          <>
            <DialogHeader>
              <DialogTitle className="break-all">{current.fileName}</DialogTitle>
              <DialogDescription>
                Creative {index! + 1} of {creatives.length}. Being active on a date does not mean this creative caused that day's results.
              </DialogDescription>
            </DialogHeader>
            <div className="relative flex items-center justify-center rounded-md bg-muted">
              <img src={creativeUrl(current.id)} alt={`Creative ${current.fileName}`} className="max-h-[60vh] w-auto max-w-full object-contain" />
              {creatives.length > 1 && (
                <>
                  <Button size="icon-sm" variant="secondary" className="absolute left-2 top-1/2 -translate-y-1/2" aria-label="Previous creative" onClick={() => go(-1)}><ChevronLeft /></Button>
                  <Button size="icon-sm" variant="secondary" className="absolute right-2 top-1/2 -translate-y-1/2" aria-label="Next creative" onClick={() => go(1)}><ChevronRight /></Button>
                </>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Dimensions</dt><dd>{current.width} × {current.height} px</dd></div>
              <div><dt className="text-muted-foreground">File size</dt><dd>{current.sizeBytes.toLocaleString('en-US')} bytes ({formatBytes(current.sizeBytes)})</dd></div>
              <div><dt className="text-muted-foreground">Uploaded</dt><dd>{formatDate(current.createdAt.slice(0, 10))} by {current.createdByName}</dd></div>
              {'usedFrom' in current && <div><dt className="text-muted-foreground">Used</dt><dd>{current.usedFrom ? formatDate(current.usedFrom) : '—'} to {current.usedTo ? formatDate(current.usedTo) : '—'}</dd></div>}
              <div className="col-span-2"><dt className="text-muted-foreground">Ads URL</dt><dd><AdsLibraryLink href={current.adsUrl || campaignAdsUrl || ''} /></dd></div>
            </dl>
            <DialogFooter>
              <Button variant="outline" asChild><a href={creativeUrl(current.id, true)}><Download /> Download</a></Button>
              <Button onClick={onClose}>Close</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The "Creative Used" table cell: first thumbnail and "+N more". */
export function CreativeCell({ creatives, adsUrl }: { creatives: CreativeSummary[]; adsUrl: string }) {
  const [index, setIndex] = React.useState<number | null>(null);
  if (!creatives.length) return <span className="text-[12px] text-muted-foreground">None</span>;
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="shrink-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setIndex(0)} aria-label={`View creatives (${creatives.length})`}>
        <img src={creativeUrl(creatives[0].id)} alt="" loading="lazy" className="h-12 w-[38px] rounded border border-border object-cover" />
      </button>
      {creatives.length > 1 && <button type="button" className="text-[12px] text-primary hover:underline" onClick={() => setIndex(1)}>+{creatives.length - 1} more</button>}
      <CreativeViewer creatives={creatives} index={index} onIndex={setIndex} onClose={() => setIndex(null)} campaignAdsUrl={adsUrl} />
    </div>
  );
}

export function CreativeUploadDialog({ open, onOpenChange, campaignId, defaultAdsUrl }: { open: boolean; onOpenChange: (v: boolean) => void; campaignId: string; defaultAdsUrl: string }) {
  const upload = useUploadCreative();
  const [file, setFile] = React.useState<{ file: File; preview: string; info: string } | null>(null);
  const [fileError, setFileError] = React.useState<string>();
  const [adsUrl, setAdsUrl] = React.useState('');
  const [usedFrom, setUsedFrom] = React.useState('');
  const [usedTo, setUsedTo] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [urlError, setUrlError] = React.useState<string>();
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (open) { setFile(null); setFileError(undefined); setAdsUrl(defaultAdsUrl); setUsedFrom(''); setUsedTo(''); setDescription(''); setUrlError(undefined); } }, [open, defaultAdsUrl]);
  React.useEffect(() => () => { if (file) URL.revokeObjectURL(file.preview); }, [file]);

  const choose = async (chosen: File) => {
    const checked = checkCreative(chosen.name, new Uint8Array(await chosen.arrayBuffer()));
    if ('error' in checked) { setFile(null); setFileError(checked.error); return; }
    setFileError(undefined);
    setFile({ file: chosen, preview: URL.createObjectURL(chosen), info: `${checked.width} × ${checked.height} px · ${checked.sizeBytes.toLocaleString('en-US')} bytes` });
  };

  const submit = async () => {
    const url = checkAdsUrl(adsUrl);
    if ('error' in url) { setUrlError(url.error); return; }
    if (!file) { setFileError('Choose an image.'); return; }
    try {
      await upload.mutateAsync({ campaignId, file: file.file, adsUrl: url.value, usedFrom, usedTo, description });
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.field === 'file') setFileError(err.message);
      if (err instanceof ApiError && err.field === 'adsUrl') setUrlError(err.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Upload creative</DialogTitle>
          <DialogDescription>Exactly {CREATIVE_WIDTH} × {CREATIVE_HEIGHT} pixels, JPG, PNG or WebP, at most 1 MB (1,000,000 bytes). Images are never resized or compressed for you.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Field label="Image" htmlFor="creative-file" required error={fileError} hint={file?.info}>
            <div className="flex flex-col gap-2">
              <input ref={input} id="creative-file" type="file" accept={CREATIVE_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Creative image file"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void choose(f); }} />
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => input.current?.click()}><ImagePlus /> {file ? 'Choose a different image' : 'Choose image'}</Button>
              {file && <img src={file.preview} alt="Selected creative" className="max-h-60 w-fit max-w-full rounded border border-border object-contain" />}
            </div>
          </Field>
          <Field label="Ads URL for this creative" htmlFor="creative-url" error={urlError} hint="Its exact Ads Library listing, if different from the campaign's.">
            <Input id="creative-url" value={adsUrl} onChange={(e) => { setAdsUrl(e.target.value); setUrlError(undefined); }} spellCheck={false} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Used from" htmlFor="creative-from"><Input id="creative-from" type="date" value={usedFrom} onChange={(e) => setUsedFrom(e.target.value)} /></Field>
            <Field label="Used to" htmlFor="creative-to"><Input id="creative-to" type="date" value={usedTo} onChange={(e) => setUsedTo(e.target.value)} /></Field>
          </div>
          <Field label="Description" htmlFor="creative-desc"><Input id="creative-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!file || upload.isPending}>{upload.isPending ? 'Uploading…' : 'Upload creative'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
