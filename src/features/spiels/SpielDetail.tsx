import * as React from 'react';
import { Archive, ArchiveRestore, Check, MessageSquareWarning, Pencil, Send, Star, Trash2, X } from 'lucide-react';
import { Dialog, DrawerContent, DialogDescription, DialogTitle } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Badge, Label, Skeleton, Textarea } from '@/components/ui/primitives';
import { ConfirmWithReason } from '@/components/common/controls';
import { EmptyState, ErrorState } from '@/components/common/bits';
import { formatDate, formatDateTime } from '@/lib/utils';
import { isSpielOwner, type SpielApproval, type SpielDetail as Detail } from '@/lib/spiels';
import { useSession } from '@/hooks/useSession';
import { documentFileUrl, useComments, useDeleteSpiel, useSpiel, useSpielAction, useSpielPersonal } from './api';
import { CopyButtons, PlatformPreview, SpielLabels, SpielStatusBadge } from './bits';

const APPROVAL_LABEL: Record<SpielApproval['action'], string> = {
  created: 'Created', submitted: 'Submitted for approval', edited: 'Edited', 'new-version': 'New version submitted', approved: 'Approved',
  rejected: 'Rejected', 'changes-requested': 'Changes requested', archived: 'Archived', restored: 'Restored', 'edited-by-owner': 'Edited by the System Administrator',
};

type Pending = { kind: 'reject' | 'request-changes' | 'archive' | 'restore' | 'delete' } | null;

export function SpielDetailDrawer({ id, onClose, onEdit }: { id: string | null; onClose: () => void; onEdit: (s: Detail) => void }) {
  const detail = useSpiel(id);
  const { actorId, role } = useSession();
  const owner = isSpielOwner({ id: actorId, role });
  const action = useSpielAction();
  const del = useDeleteSpiel();
  const personal = useSpielPersonal();
  const comments = useComments();
  const [pending, setPending] = React.useState<Pending>(null);
  const [note, setNote] = React.useState('');
  const [comment, setComment] = React.useState('');
  const s = detail.data;
  React.useEffect(() => { setNote(s?.note ?? ''); }, [s?.id, s?.note]);

  const approvedView = s && !s.canEdit;
  const shown = s ? (approvedView ? s.approved ?? s.current : s.current) : null;
  const act = (a: string, feedback?: string) => action.mutateAsync({ id: s!.id, action: a, feedback });

  return (
    <Dialog open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <DrawerContent className="sm:max-w-2xl">
        {detail.error && <div className="p-5"><ErrorState message={detail.error.message} onRetry={() => detail.refetch()} /></div>}
        {!s && !detail.error && <div className="flex flex-col gap-3 p-5"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-40 w-full" /></div>}
        {s && shown && (
          <div className="flex flex-col gap-4 p-5">
            <header className="flex flex-col gap-1.5 pr-8">
              <DialogTitle className="text-lg font-semibold">{shown.title}</DialogTitle>
              <DialogDescription className="sr-only">Spiel details, versions and history</DialogDescription>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="accent">{shown.categoryName}</Badge>
                <SpielStatusBadge status={s.status} />
                <Badge tone="outline">Version {shown.versionNo}</Badge>
                {s.approved && s.current.id !== s.approved.id && s.canEdit && <Badge tone="warning">Version {s.approved.versionNo} is live while version {s.current.versionNo} is reviewed</Badge>}
              </div>
              <SpielLabels country={shown.targetCountry} language={shown.language} platform={shown.platform} />
              <p className="text-[12px] text-muted-foreground">
                By {s.createdByName} · created {formatDate(s.createdAt.slice(0, 10))} · updated {formatDate(s.updatedAt.slice(0, 10))}
                {s.approvedAt && ` · approved ${formatDate(s.approvedAt.slice(0, 10))} by ${s.approvedByName}`}
                {` · used ${s.usageCount} time${s.usageCount === 1 ? '' : 's'}`}{s.lastUsedAt && `, last ${formatDate(s.lastUsedAt.slice(0, 10))}`}
              </p>
            </header>

            {shown.adminFeedback && s.canEdit && (
              <p role="note" className="flex gap-1.5 rounded-md border border-info/40 bg-info-bg/50 p-2 text-[13px]">
                <MessageSquareWarning className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
                <span><span className="font-medium">Administrator feedback: </span>{shown.adminFeedback}</span>
              </p>
            )}

            <section className="flex flex-col gap-2">
              <PlatformPreview text={shown.content} platform={shown.platform} />
              {shown.situation && <p className="text-[13px]"><span className="font-medium">Intended situation: </span>{shown.situation}</p>}
              {(shown.campaignRef || shown.tags.length > 0) && (
                <p className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
                  {shown.campaignRef && <span>Campaign: {shown.campaignRef}</span>}
                  {shown.tags.map((t) => <Badge key={t} tone="neutral">#{t}</Badge>)}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {s.approved && <CopyButtons text={s.approved.content} platform={s.approved.platform} onCopied={() => personal.use.mutate(s.id)} />}
                {s.approved && (
                  <Button size="sm" variant="ghost" aria-pressed={s.favorite} onClick={() => personal.favorite.mutate({ id: s.id, favorite: !s.favorite })}>
                    <Star className={s.favorite ? 'fill-warning text-warning' : ''} /> {s.favorite ? 'Favorited' : 'Favorite'}
                  </Button>
                )}
              </div>
            </section>

            <section className="flex flex-wrap gap-2 border-y border-border py-3" aria-label="Actions">
              {s.canEdit && s.status !== 'Archived' && <Button size="sm" variant="outline" onClick={() => onEdit(s)}><Pencil /> Edit</Button>}
              {s.canEdit && ['Draft', 'Rejected', 'Changes Requested'].includes(s.status) && <Button size="sm" onClick={() => act('submit')}><Send /> Submit for approval</Button>}
              {owner && s.status === 'Pending Approval' && <>
                <Button size="sm" onClick={() => act('approve')}><Check /> Approve</Button>
                <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'request-changes' })}>Request changes</Button>
                <Button size="sm" variant="danger" onClick={() => setPending({ kind: 'reject' })}><X /> Reject</Button>
              </>}
              {owner && s.status === 'Approved' && <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'archive' })}><Archive /> Archive</Button>}
              {owner && s.status === 'Archived' && <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'restore' })}><ArchiveRestore /> Restore</Button>}
              {s.canEdit && (owner ? !['Approved'].includes(s.status) && !(s.status === 'Pending Approval' && s.approved) : !s.approved) && (
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => setPending({ kind: 'delete' })}><Trash2 /> {owner ? 'Delete permanently' : 'Delete'}</Button>
              )}
              <p className="w-full text-[11px] text-muted-foreground">
                {owner ? 'As System Administrator you can review, edit, archive, restore and delete any spiel.' : s.canEdit ? 'Only you and the System Administrator can change this spiel.' : 'Only the author and the System Administrator can change this spiel.'}
              </p>
            </section>

            {s.approved && (
              <section className="flex flex-col gap-1.5">
                <Label htmlFor="spiel-note">My personal note <span className="font-normal text-muted-foreground">(only you see this)</span></Label>
                <Textarea id="spiel-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button size="sm" variant="outline" className="self-start" disabled={note === s.note} onClick={() => personal.note.mutate({ id: s.id, body: note })}>Save note</Button>
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Versions</h3>
              <ol className="flex flex-col gap-2">
                {s.versions.map((v) => (
                  <li key={v.id} className="rounded-md border border-border p-2 text-[12px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">Version {v.versionNo} · {v.title}</span>
                      <SpielStatusBadge status={v.status} />
                    </div>
                    <p className="text-muted-foreground">
                      Written by {v.createdByName}{v.updatedByName && v.updatedByName !== v.createdByName ? `, last changed by ${v.updatedByName}` : ''} · {formatDateTime(v.updatedAt)}
                      {v.reviewedAt && ` · reviewed by ${v.reviewedByName} ${formatDateTime(v.reviewedAt)}`}
                    </p>
                    {v.adminFeedback && s.canEdit && <p className="mt-1"><span className="font-medium">Feedback: </span>{v.adminFeedback}</p>}
                    <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">Show script</summary><p className="mt-1 whitespace-pre-wrap">{v.content}</p></details>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Approval history</h3>
              {s.approvals.length === 0 ? <p className="text-[12px] text-muted-foreground">No history yet.</p> : (
                <ol className="flex flex-col gap-1 text-[12px]">
                  {s.approvals.map((a) => (
                    <li key={a.id} className="flex flex-col border-l-2 border-border pl-2">
                      <span><span className="font-medium">{APPROVAL_LABEL[a.action]}</span>{a.versionNo !== null && ` · v${a.versionNo}`} · {a.actorName} · {formatDateTime(a.createdAt)}</span>
                      {a.changes && <span className="text-muted-foreground">{a.changes}</span>}
                      {a.feedback && <span>“{a.feedback}”</span>}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            {s.documents.length > 0 && (
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Reference documents</h3>
                <ul className="text-[12px]">
                  {s.documents.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2">
                      <a className="text-primary hover:underline" href={documentFileUrl(d.id, d.current.id)} target="_blank" rel="noopener noreferrer">{d.title}</a>
                      <SpielStatusBadge status={d.status} />
                      {d.outdated && <Badge tone="warning">May be outdated</Badge>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Comments</h3>
              {s.comments.length === 0 ? <EmptyState title="No comments yet" /> : (
                <ul className="flex flex-col gap-2">
                  {s.comments.map((c) => (
                    <li key={c.id} className="rounded-md border border-border p-2 text-[13px]">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>{c.createdByName} · {formatDateTime(c.createdAt)}{c.updatedAt !== c.createdAt ? ' (edited)' : ''}</span>
                        {c.canEdit && <Button size="icon-sm" variant="ghost" aria-label="Delete comment" onClick={() => comments.remove.mutate(c.id)}><Trash2 /></Button>}
                      </div>
                      <p className="whitespace-pre-wrap">{c.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Label htmlFor="spiel-comment" className="sr-only">Add a comment</Label>
              <Textarea id="spiel-comment" rows={2} maxLength={2000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…" />
              <Button size="sm" variant="outline" className="self-start" disabled={!comment.trim() || comments.add.isPending}
                onClick={() => comments.add.mutate({ spielId: s.id, body: comment }, { onSuccess: () => setComment('') })}>Comment</Button>
            </section>
          </div>
        )}

        {s && pending && (
          <ConfirmWithReason
            open
            onOpenChange={(v) => !v && setPending(null)}
            title={{ reject: 'Reject this spiel?', 'request-changes': 'Request changes?', archive: 'Archive this spiel?', restore: 'Restore this spiel?', delete: owner ? 'Delete this spiel permanently?' : 'Delete this spiel?' }[pending.kind]}
            description={{
              reject: 'The author sees your explanation and can edit and resubmit.',
              'request-changes': 'The author sees what to change and can resubmit.',
              archive: 'It leaves the shared library but keeps all versions and history.',
              restore: 'The approved version returns to the shared library.',
              delete: owner ? 'The spiel, its versions, comments and personal notes are erased. The audit log keeps one line.' : 'Your draft is removed.',
            }[pending.kind]}
            confirmLabel={{ reject: 'Reject spiel', 'request-changes': 'Request changes', archive: 'Archive spiel', restore: 'Restore spiel', delete: 'Delete' }[pending.kind]}
            danger={pending.kind !== 'restore' && pending.kind !== 'request-changes'}
            placeholder={pending.kind === 'reject' || pending.kind === 'request-changes' ? 'Explain what needs to change. The author will see this.' : 'Explain why. This is written to the audit trail.'}
            hint="At least 10 characters."
            onConfirm={async (reason) => {
              if (pending.kind === 'delete') { await del.mutateAsync({ id: s.id, reason }); onClose(); } else await act(pending.kind, reason);
              setPending(null);
            }}
          />
        )}
      </DrawerContent>
    </Dialog>
  );
}
