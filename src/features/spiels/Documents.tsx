import * as React from 'react';
import { Archive, ArchiveRestore, Check, Download, Eye, FileUp, Pencil, Send, Trash2, Upload, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DrawerContent } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input, NativeSelect, Skeleton, Switch, Label, Textarea } from '@/components/ui/primitives';
import { ConfirmWithReason, FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { EmptyState, ErrorState } from '@/components/common/bits';
import { formatDate, formatDateTime } from '@/lib/utils';
import {
  DOCUMENT_ACCEPT, DOCUMENT_LIMITS, DOCUMENT_STATUSES, LIMITS, SUGGESTED_LANGUAGES, TARGET_COUNTRIES, classifyDocument, documentMetaSchema, firstIssue,
  formatFileSize, isSpielOwner, type SpielDocument, type TargetCountry,
} from '@/lib/spiels';
import { useSession } from '@/hooks/useSession';
import { documentFileUrl, useCategories, useDocument, useDocumentMutations, useDocuments, useUploadDocument } from './api';
import { SpielLabels, SpielStatusBadge } from './bits';

const LIMITS_TEXT = 'Excel (.xlsx, .xls, .csv), Word (.docx, .doc) and text (.txt, .md) up to 10 MB · PowerPoint (.pptx, .ppt) and PDF up to 20 MB · images (.jpg, .png, .webp) up to 1 MB.';

export function DocumentsTab({ openId, onOpen, spiels }: { openId: string | null; onOpen: (id: string | null) => void; spiels: { id: string; title: string }[] }) {
  const documents = useDocuments();
  const categories = useCategories();
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState('all');
  const [category, setCategory] = React.useState('all');
  const [country, setCountry] = React.useState('all');
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const list = (documents.data ?? []).filter((d) =>
    (status === 'all' || d.status === status) && (category === 'all' || d.categoryId === category) && (country === 'all' || d.targetCountry === country)
    && (!search || `${d.title} ${d.description} ${d.current.fileName}`.toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">Guidelines, approved examples, translations and training material. Only approved documents are shared and used by the AI Assistant.</p>
        <Button size="sm" onClick={() => setUploadOpen(true)}><Upload /> Upload document</Button>
      </div>
      <FilterBar activeCount={[status, category, country].filter((v) => v !== 'all').length + (search ? 1 : 0)} onClear={() => { setSearch(''); setStatus('all'); setCategory('all'); setCountry('all'); }}>
        <SearchInput id="doc-search" label="Search documents" value={search} onChange={setSearch} placeholder="Search title, description, file…" className="min-w-[14rem] flex-1" />
        <FilterSelect id="doc-status" label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, ...DOCUMENT_STATUSES.map((s) => ({ value: s, label: s }))]} />
        <FilterSelect id="doc-category" label="Category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
        <FilterSelect id="doc-country" label="Country" value={country} onChange={setCountry} options={[{ value: 'all', label: 'All' }, ...TARGET_COUNTRIES.map((c) => ({ value: c, label: c }))]} />
      </FilterBar>
      {documents.error ? <ErrorState message={documents.error.message} onRetry={() => documents.refetch()} />
        : documents.isLoading ? <Skeleton className="h-40 w-full" />
          : list.length === 0 ? <EmptyState title="No documents" description="Upload a guideline or example to share it after approval." />
            : (
              <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => onOpen(d.id)} className="flex h-full w-full flex-col gap-1.5 rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring">
                      <span className="flex items-start justify-between gap-2">
                        <span className="text-[13px] font-semibold">{d.title}</span>
                        <SpielStatusBadge status={d.status} />
                      </span>
                      <span className="text-[12px] text-muted-foreground">{d.current.fileName} · {formatFileSize(d.current.sizeBytes)} · v{d.current.versionNo}</span>
                      <SpielLabels country={d.targetCountry} language={d.language} />
                      {d.categoryName && <Badge tone="accent" className="w-fit">{d.categoryName}</Badge>}
                      {d.description && <span className="line-clamp-2 text-[12px]">{d.description}</span>}
                      <span className="text-[11px] text-muted-foreground">Uploaded by {d.createdByName} · {formatDate(d.createdAt.slice(0, 10))}</span>
                      {d.outdated && <Badge tone="warning" className="w-fit">Approved over 6 months ago — may be outdated</Badge>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
      <DocumentFormDialog open={uploadOpen} onOpenChange={setUploadOpen} spiels={spiels} />
      <DocumentDrawer id={openId} onClose={() => onOpen(null)} spiels={spiels} />
    </div>
  );
}

function DocumentFormDialog({ open, onOpenChange, spiels, document: existing }: { open: boolean; onOpenChange: (v: boolean) => void; spiels: { id: string; title: string }[]; document?: SpielDocument }) {
  const categories = useCategories();
  const upload = useUploadDocument();
  const { update } = useDocumentMutations();
  const [meta, setMeta] = React.useState({ title: '', categoryId: '', spielId: '', targetCountry: 'India' as TargetCountry, language: 'English', description: '' });
  const [file, setFile] = React.useState<File | null>(null);
  const [submit, setSubmit] = React.useState(true);
  const [error, setError] = React.useState<{ field: string; message: string } | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setMeta(existing ? { title: existing.title, categoryId: existing.categoryId ?? '', spielId: existing.spielId ?? '', targetCountry: existing.targetCountry, language: existing.language, description: existing.description }
      : { title: '', categoryId: '', spielId: '', targetCountry: 'India', language: 'English', description: '' });
    setFile(null); setError(null); setSubmit(true);
  }, [open, existing]);

  const choose = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    // A first check here for a quick answer; the server checks again.
    const head = new Uint8Array(await f.slice(0, 65536).arrayBuffer());
    const checked = classifyDocument(f.name, head, f.type);
    const problem = 'error' in checked ? checked.error
      : f.size > DOCUMENT_LIMITS[checked.kind] ? `${checked.fileName} is ${formatFileSize(f.size)}. That kind of file can be up to ${formatFileSize(DOCUMENT_LIMITS[checked.kind])}.` : null;
    if (problem) { setFile(null); setError({ field: 'file', message: problem }); return; }
    setFile(f);
    if (!meta.title) setMeta((m) => ({ ...m, title: f.name.replace(/\.[^.]+$/, '').slice(0, LIMITS.title) }));
  };

  const save = async () => {
    const parsed = documentMetaSchema.safeParse({ ...meta, categoryId: meta.categoryId || null, spielId: meta.spielId || null });
    if (!parsed.success) { const i = firstIssue(parsed.error); setError({ field: i.field, message: i.error }); return; }
    if (existing) { await update.mutateAsync({ id: existing.id, ...parsed.data }); onOpenChange(false); return; }
    if (!file) { setError({ field: 'file', message: 'Choose a file.' }); return; }
    try {
      await upload.mutateAsync({ file, meta: { ...parsed.data, submit } });
      onOpenChange(false);
    } catch (e) {
      setError({ field: (e as { field?: string }).field ?? 'file', message: (e as Error).message });
    }
  };
  const err = (f: string) => (error?.field === f ? error.message : undefined);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit document details' : 'Upload reference document'}</DialogTitle>
          <DialogDescription>{existing ? 'Change the details. To change the file, use Replace file.' : LIMITS_TEXT}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {!existing && (
            <Field label="File" htmlFor="doc-file" required error={err('file')} hint={file ? `${file.name} · ${formatFileSize(file.size)}` : 'Executable, macro-enabled and web files are refused.'} className="sm:col-span-2">
              <Input type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => void choose(e.target.files?.[0])} />
            </Field>
          )}
          <Field label="Document title" htmlFor="doc-title" required error={err('title')} className="sm:col-span-2">
            <Input value={meta.title} maxLength={LIMITS.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          </Field>
          <Field label="Category" htmlFor="doc-category-select" hint="Optional">
            <NativeSelect value={meta.categoryId} onChange={(e) => setMeta({ ...meta, categoryId: e.target.value })}>
              <option value="">No category</option>
              {(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Related spiel" htmlFor="doc-spiel" hint="Optional">
            <NativeSelect value={meta.spielId} onChange={(e) => setMeta({ ...meta, spielId: e.target.value })}>
              <option value="">None</option>
              {spiels.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Target country" htmlFor="doc-country-select" required>
            <NativeSelect value={meta.targetCountry} onChange={(e) => setMeta({ ...meta, targetCountry: e.target.value as TargetCountry })}>
              {TARGET_COUNTRIES.map((c) => <option key={c}>{c}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Language" htmlFor="doc-language" required error={err('language')}>
            <Input list="doc-languages" value={meta.language} onChange={(e) => setMeta({ ...meta, language: e.target.value })} />
          </Field>
          <datalist id="doc-languages">{SUGGESTED_LANGUAGES.map((l) => <option key={l} value={l} />)}</datalist>
          <Field label="Description" htmlFor="doc-description" className="sm:col-span-2" hint="What is in it and when to use it">
            <Textarea rows={3} maxLength={LIMITS.description} value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
          </Field>
          {!existing && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Switch id="doc-submit" checked={submit} onCheckedChange={setSubmit} />
              <Label htmlFor="doc-submit">Submit for review now (otherwise saved as a draft)</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={upload.isPending || update.isPending} onClick={save}><FileUp /> {existing ? 'Save details' : upload.isPending ? 'Uploading…' : 'Upload'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentDrawer({ id, onClose, spiels }: { id: string | null; onClose: () => void; spiels: { id: string; title: string }[] }) {
  const doc = useDocument(id);
  const { actorId, role } = useSession();
  const owner = isSpielOwner({ id: actorId, role });
  const { action, remove } = useDocumentMutations();
  const upload = useUploadDocument();
  const [pending, setPending] = React.useState<'reject' | 'archive' | 'restore' | 'delete' | null>(null);
  const [editOpen, setEditOpen] = React.useState(false);
  const replaceInput = React.useRef<HTMLInputElement>(null);
  const d = doc.data;

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="sm:max-w-xl">
        {doc.error && <div className="p-5"><ErrorState message={doc.error.message} /></div>}
        {!d && !doc.error && <div className="p-5"><Skeleton className="h-40 w-full" /></div>}
        {d && (
          <div className="flex flex-col gap-4 p-5">
            <header className="flex flex-col gap-1.5 pr-8">
              <DialogTitle className="text-lg font-semibold">{d.title}</DialogTitle>
              <DialogDescription className="sr-only">Document details and versions</DialogDescription>
              <div className="flex flex-wrap items-center gap-1.5">
                <SpielStatusBadge status={d.status} />
                <Badge tone="outline">Version {d.current.versionNo}</Badge>
                {d.categoryName && <Badge tone="accent">{d.categoryName}</Badge>}
                {d.outdated && <Badge tone="warning">May be outdated</Badge>}
                {d.approved && d.approved.id !== d.current.id && d.canEdit && <Badge tone="warning">Version {d.approved.versionNo} stays in use until version {d.current.versionNo} is approved</Badge>}
              </div>
              <SpielLabels country={d.targetCountry} language={d.language} />
              <p className="text-[12px] text-muted-foreground">Uploaded by {d.createdByName} · {formatDateTime(d.createdAt)}{d.approvedAt && ` · approved ${formatDate(d.approvedAt.slice(0, 10))}`}
                {d.spielId && ` · for spiel ${spiels.find((s) => s.id === d.spielId)?.title ?? d.spielId}`}</p>
            </header>
            {d.description && <p className="text-[13px]">{d.description}</p>}
            {d.adminFeedback && d.canEdit && <p role="note" className="rounded-md border border-info/40 bg-info-bg/50 p-2 text-[13px]"><span className="font-medium">Administrator feedback: </span>{d.adminFeedback}</p>}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Preview</h3>
              {d.current.kind === 'image'
                ? <img src={documentFileUrl(d.id, d.current.id)} alt={d.title} className="max-h-72 w-fit max-w-full rounded-md border border-border object-contain" />
                : <p className="text-[12px] text-muted-foreground">{d.current.kind === 'pdf' || d.current.kind === 'text' ? 'Opens in a new tab.' : 'Office files are downloaded and opened in their app.'} {d.current.hasText ? 'Its text is available to the AI Assistant once approved.' : ''}</p>}
              <div className="flex flex-wrap gap-2">
                {(d.current.kind === 'pdf' || d.current.kind === 'text' || d.current.kind === 'image') && (
                  <Button size="sm" variant="outline" asChild><a href={documentFileUrl(d.id, d.current.id)} target="_blank" rel="noopener noreferrer"><Eye /> Preview</a></Button>
                )}
                <Button size="sm" variant="outline" asChild><a href={documentFileUrl(d.id, d.current.id, true)}><Download /> Download</a></Button>
              </div>
            </section>

            <section className="flex flex-wrap gap-2 border-y border-border py-3" aria-label="Actions">
              {d.canEdit && d.status !== 'Archived' && <>
                <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}><Pencil /> Edit details</Button>
                <input ref={replaceInput} type="file" accept={DOCUMENT_ACCEPT} className="sr-only" tabIndex={-1} aria-label="Replacement file"
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) upload.mutate({ file: f, replaceId: d.id }); }} />
                <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => replaceInput.current?.click()}><FileUp /> Replace file</Button>
              </>}
              {d.canEdit && ['Draft', 'Rejected'].includes(d.status) && <Button size="sm" onClick={() => action.mutate({ id: d.id, action: 'submit' })}><Send /> Submit for review</Button>}
              {owner && d.status === 'Pending Review' && <>
                <Button size="sm" onClick={() => action.mutate({ id: d.id, action: 'approve' })}><Check /> Approve</Button>
                <Button size="sm" variant="danger" onClick={() => setPending('reject')}><X /> Reject</Button>
              </>}
              {owner && ['Approved', 'Rejected', 'Draft'].includes(d.status) && <Button size="sm" variant="outline" onClick={() => setPending('archive')}><Archive /> Archive</Button>}
              {owner && d.status === 'Archived' && d.approved && <Button size="sm" variant="outline" onClick={() => setPending('restore')}><ArchiveRestore /> Restore</Button>}
              {d.canEdit && (owner ? d.status !== 'Approved' : !d.approved) && <Button size="sm" variant="ghost" className="text-danger" onClick={() => setPending('delete')}><Trash2 /> {owner ? 'Delete permanently' : 'Delete'}</Button>}
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Version history</h3>
              <ol className="flex flex-col gap-2">
                {(d.versions ?? []).map((v) => (
                  <li key={v.id} className="flex flex-col gap-0.5 rounded-md border border-border p-2 text-[12px]">
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">v{v.versionNo} · {v.fileName}</span>
                      <SpielStatusBadge status={v.status} />
                    </span>
                    <span className="text-muted-foreground">{formatFileSize(v.sizeBytes)} · {v.createdByName} · {formatDateTime(v.createdAt)}{v.reviewedAt && ` · reviewed by ${v.reviewedByName}`}</span>
                    {v.adminFeedback && <span>Feedback: {v.adminFeedback}</span>}
                    <a className="w-fit text-primary hover:underline" href={documentFileUrl(d.id, v.id, true)}>Download this version</a>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        )}
        {d && <DocumentFormDialog open={editOpen} onOpenChange={setEditOpen} spiels={spiels} document={d} />}
        {d && pending && (
          <ConfirmWithReason
            open
            onOpenChange={(v) => !v && setPending(null)}
            title={{ reject: 'Reject this document?', archive: 'Archive this document?', restore: 'Restore this document?', delete: owner ? 'Delete this document permanently?' : 'Delete this document?' }[pending]}
            description={{ reject: 'The uploader sees your explanation and can replace the file and resubmit.', archive: 'It stops being shared and used by the AI. History is kept.', restore: 'The approved version is shared again.', delete: owner ? 'The document and all its file versions are erased. The audit log keeps one line.' : 'Your document is removed.' }[pending]}
            confirmLabel={{ reject: 'Reject', archive: 'Archive', restore: 'Restore', delete: 'Delete' }[pending]}
            danger={pending !== 'restore'}
            placeholder="Explain why. This is written to the audit trail."
            hint="At least 10 characters."
            onConfirm={async (reason) => {
              if (pending === 'delete') { await remove.mutateAsync({ id: d.id, reason }); onClose(); } else await action.mutateAsync({ id: d.id, action: pending, feedback: reason });
              setPending(null);
            }}
          />
        )}
      </DrawerContent>
    </Dialog>
  );
}
