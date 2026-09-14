import * as React from 'react';
import { ChevronDown, ImagePlus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Field, Input } from '@/components/ui/primitives';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { EmptyState, SafeExternalLink, SecurityNotice } from '@/components/common/bits';
import { ConfirmWithReason } from '@/components/common/controls';
import { ApiError, proofImageUrl, useCrmData, useRemoveProof, useReviewProof, useUploadProof } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import { mayEditAgent } from '@/lib/access';
import { postUrlKey } from '@/lib/identity';
import { PROOF_ACCEPT, REJECT_REASON_MIN, checkProofImage, checkProofPostUrl, formatKb, mayReviewProofs } from '@/lib/proofs';
import type { Agent, AgentProof } from '@/lib/types';
import { displayUrl, formatDate } from '@/lib/utils';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

/** Live proofs for an agent, newest first. */
export function useAgentProofs(agentId: string | undefined): AgentProof[] {
  const { data } = useCrmData();
  return React.useMemo(
    () => (data?.agentProofs ?? []).filter((p) => p.agentId === agentId && !p.archived),
    [data, agentId],
  );
}

/** Whether the signed-in person may upload or remove proofs on this agent. */
export function useMayEditAgent(agent: Agent | undefined): boolean {
  const { actorId, role, permissions } = useSession();
  return mayEditAgent({ id: actorId, role, permissions }, agent);
}

export function ProofUploadDialog({ agent, open, onOpenChange }: { agent: Agent; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data } = useCrmData();
  const upload = useUploadProof();
  const [file, setFile] = React.useState<{ name: string; bytes: Uint8Array; previewUrl: string } | null>(null);
  const [fileError, setFileError] = React.useState<string>();
  const [postUrl, setPostUrl] = React.useState('');
  const [urlError, setUrlError] = React.useState<string>();
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!open) return;
    setFile(null); setFileError(undefined); setPostUrl(''); setUrlError(undefined);
  }, [open]);
  React.useEffect(() => () => { if (file) URL.revokeObjectURL(file.previewUrl); }, [file]);

  const chooseFile = async (chosen: File) => {
    const bytes = new Uint8Array(await chosen.arrayBuffer());
    const checked = checkProofImage(bytes);
    if ('error' in checked) { setFile(null); setFileError(checked.error); return; }
    setFileError(undefined);
    setFile({ name: chosen.name, bytes, previewUrl: URL.createObjectURL(new Blob([bytes as BlobPart], { type: checked.mime })) });
  };

  const typedKey = postUrlKey(postUrl);
  const holder = typedKey ? (data?.agentProofs ?? []).find((p) => !p.archived && postUrlKey(p.postUrl) === typedKey) : undefined;
  const duplicate = holder ? `This Post URL is already on a proof for ${holder.agentId}.` : undefined;

  const submit = async () => {
    const url = checkProofPostUrl(postUrl);
    if ('error' in url) { setUrlError(url.error); return; }
    if (duplicate) { setUrlError(duplicate); return; }
    if (!file) { setFileError('Choose an image.'); return; }
    try {
      await upload.mutateAsync({ agentId: agent.id, postUrl: url.value, image: toBase64(file.bytes) });
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.field === 'postUrl') setUrlError(e.message);
      if (e instanceof ApiError && e.field === 'image') setFileError(e.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Upload proof for {agent.name}</DialogTitle>
          <DialogDescription>A screenshot of the post and its Post URL. PNG, JPEG or WebP, 500 KB at most.</DialogDescription>
        </DialogHeader>
        <SecurityNotice>Post screenshots only. Never upload ID cards, passports or other identity documents.</SecurityNotice>
        <div className="flex flex-col gap-4">
          <Field label="Post URL" htmlFor="proof-url" required error={urlError ?? duplicate}>
            <Input id="proof-url" value={postUrl} onChange={(e) => { setPostUrl(e.target.value); setUrlError(undefined); }}
              placeholder="https://www.facebook.com/…/posts/…" autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Proof image" htmlFor="proof-file" required error={fileError}
            hint={file ? `${file.name} · ${formatKb(file.bytes.length)}` : 'Up to 500 KB.'}>
            <div className="flex flex-col gap-2">
              <input
                ref={input} id="proof-file" type="file" accept={PROOF_ACCEPT} className="sr-only" tabIndex={-1}
                aria-label="Proof image file"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void chooseFile(f); }}
              />
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => input.current?.click()}>
                <ImagePlus /> {file ? 'Choose a different image' : 'Choose image'}
              </Button>
              {file && <img src={file.previewUrl} alt="Selected proof preview" className="max-h-56 w-fit max-w-full rounded-md border border-border object-contain" />}
            </div>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={upload.isPending || !file || !postUrl.trim()}>
            {upload.isPending ? 'Uploading…' : 'Upload proof'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The Agents table cell: the latest proof, how many there are, and upload. */
export function ProofCell({ agent }: { agent: Agent }) {
  const proofs = useAgentProofs(agent.id);
  const mayEdit = useMayEditAgent(agent);
  const [open, setOpen] = React.useState(false);
  const latest = proofs[0];
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      {latest ? (
        <a href={proofImageUrl(latest.id)} target="_blank" rel="noopener noreferrer" title={`Open proof · ${latest.postUrl}`} className="shrink-0">
          <img src={proofImageUrl(latest.id)} alt={`Latest proof for ${agent.name}`} loading="lazy" className="h-8 w-8 rounded border border-border object-cover" />
        </a>
      ) : null}
      <span className="flex min-w-0 flex-col text-[12px]">
        {latest ? (
          <>
            <SafeExternalLink href={latest.postUrl} className="max-w-[10rem] truncate">{displayUrl(latest.postUrl)}</SafeExternalLink>
            <span className="text-muted-foreground">{proofs.length} proof{proofs.length === 1 ? '' : 's'}</span>
          </>
        ) : <span className="text-muted-foreground">No proof</span>}
      </span>
      {mayEdit && !agent.archived && (
        <Button size="icon-sm" variant="ghost" aria-label={`Upload proof for ${agent.name}`} onClick={() => setOpen(true)}>
          <ImagePlus />
        </Button>
      )}
      {open && <ProofUploadDialog agent={agent} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

/** Every live proof on the agent page. */
export function ProofGallery({ agent }: { agent: Agent }) {
  const proofs = useAgentProofs(agent.id);
  const mayEdit = useMayEditAgent(agent);
  const { can } = useSession();
  const remove = useRemoveProof();
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<AgentProof>();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground">Screenshots proving this agent’s posts, newest first.</p>
        {mayEdit && !agent.archived && (
          <Button size="sm" onClick={() => setUploadOpen(true)}><ImagePlus /> Upload proof</Button>
        )}
      </div>
      {proofs.length === 0 ? (
        <EmptyState title="No proofs yet" description={mayEdit ? 'Upload a screenshot of a post with its Post URL.' : 'The assigned manager can upload proofs.'} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {proofs.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-border p-2">
              <a href={proofImageUrl(p.id)} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-md bg-muted">
                <img src={proofImageUrl(p.id)} alt={`Proof for ${p.postUrl}`} loading="lazy" className="h-44 w-full object-contain" />
              </a>
              <SafeExternalLink href={p.postUrl} className="truncate text-[12px]">{displayUrl(p.postUrl)}</SafeExternalLink>
              <div className="flex flex-wrap items-start gap-3 text-[11px]">
                <span className="flex flex-col gap-0.5"><span className="text-muted-foreground">Verdict</span><ProofVerdict proof={p} /></span>
                <span className="flex flex-col gap-0.5"><span className="text-muted-foreground">Payment</span><ProofPayment proof={p} /></span>
              </div>
              <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{formatDate(p.createdAt.slice(0, 10))} · {p.uploadedByName || '—'} · {formatKb(p.sizeBytes)}</span>
                {mayEdit && can('archive:records') && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove proof ${p.id}`} onClick={() => setRemoving(p)}><Trash2 /></Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {uploadOpen && <ProofUploadDialog agent={agent} open={uploadOpen} onOpenChange={setUploadOpen} />}
      <ConfirmWithReason
        open={Boolean(removing)}
        onOpenChange={(v) => !v && setRemoving(undefined)}
        title="Remove this proof?"
        description="It is hidden from the agent and kept in the audit history."
        confirmLabel="Remove proof"
        placeholder="Explain why this proof is being removed. This is written to the audit trail."
        onConfirm={(reason) => remove.mutateAsync({ id: removing!.id, reason })}
      />
    </div>
  );
}

/* ── Verdict and payment (System Administrator only) ─────────────────────── */

const VERDICT_TONE = { Accepted: 'success', Rejected: 'danger' } as const;

function useMayReviewProofs() {
  const { role } = useSession();
  return mayReviewProofs(role);
}

/** The latest live proof on an agent, for the table columns. */
export function useLatestProof(agentId: string): AgentProof | undefined {
  return useAgentProofs(agentId)[0];
}

/** Verdict badge; the System Administrator gets a menu, and Rejected asks for a reason. */
export function ProofVerdict({ proof }: { proof: AgentProof }) {
  const mayReview = useMayReviewProofs();
  const review = useReviewProof();
  const [rejecting, setRejecting] = React.useState(false);
  const badge = (
    <Badge tone={proof.verdict ? VERDICT_TONE[proof.verdict] : 'neutral'}>{proof.verdict ?? 'Not reviewed'}</Badge>
  );
  const detail = proof.verdict ? `${proof.verdict} by ${proof.reviewedByName || '—'}${proof.reviewedAt ? ` on ${formatDate(proof.reviewedAt.slice(0, 10))}` : ''}` : undefined;
  return (
    <span className="flex min-w-0 flex-col gap-0.5" title={detail}>
      {mayReview ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Verdict for proof ${proof.id}: ${proof.verdict ?? 'Not reviewed'}`} className="inline-flex w-fit items-center gap-0.5 rounded-full focus-visible:outline-2 focus-visible:outline-ring">
              {badge}<ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem disabled={proof.verdict === 'Accepted'} onSelect={() => review.mutate({ id: proof.id, verdict: 'Accepted' })}>Accepted</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setRejecting(true)}>Rejected…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : badge}
      {proof.verdict === 'Rejected' && proof.verdictReason && (
        <span className="max-w-[12rem] truncate text-[11px] text-danger" title={proof.verdictReason}>{proof.verdictReason}</span>
      )}
      {rejecting && (
        <ConfirmWithReason
          open={rejecting}
          onOpenChange={setRejecting}
          title="Reject this proof?"
          description={`${displayUrl(proof.postUrl)} — the reason is shown beside the proof and kept in the audit trail.`}
          confirmLabel="Reject proof"
          placeholder="Why is this proof rejected? For example: the post was deleted, or the screenshot does not match the URL."
          hint={`At least ${REJECT_REASON_MIN} characters.`}
          onConfirm={(reason) => review.mutateAsync({ id: proof.id, verdict: 'Rejected', reason })}
        />
      )}
    </span>
  );
}

/** Payment badge; Not paid by default, and only the System Administrator can change it. */
export function ProofPayment({ proof }: { proof: AgentProof }) {
  const mayReview = useMayReviewProofs();
  const review = useReviewProof();
  const paid = proof.payment === 'Paid';
  const badge = <Badge tone={paid ? 'success' : 'neutral'}>{proof.payment}</Badge>;
  const detail = paid ? `Marked paid by ${proof.paidByName || '—'}${proof.paidAt ? ` on ${formatDate(proof.paidAt.slice(0, 10))}` : ''}` : undefined;
  if (!mayReview) return <span title={detail}>{badge}</span>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={detail} aria-label={`Payment for proof ${proof.id}: ${proof.payment}`} className="inline-flex w-fit items-center gap-0.5 rounded-full focus-visible:outline-2 focus-visible:outline-ring">
          {badge}<ChevronDown className="size-3 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled={paid} onSelect={() => review.mutate({ id: proof.id, payment: 'Paid' })}>Paid</DropdownMenuItem>
        <DropdownMenuItem disabled={!paid} onSelect={() => review.mutate({ id: proof.id, payment: 'Not paid' })}>Not paid</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Table cells: the latest proof's verdict or payment, or a dash when there is no proof. */
export function ProofVerdictCell({ agent }: { agent: Agent }) {
  const latest = useLatestProof(agent.id);
  return <div onClick={(e) => e.stopPropagation()}>{latest ? <ProofVerdict proof={latest} /> : <span className="text-muted-foreground">—</span>}</div>;
}

export function ProofPaymentCell({ agent }: { agent: Agent }) {
  const latest = useLatestProof(agent.id);
  return <div onClick={(e) => e.stopPropagation()}>{latest ? <ProofPayment proof={latest} /> : <span className="text-muted-foreground">—</span>}</div>;
}
