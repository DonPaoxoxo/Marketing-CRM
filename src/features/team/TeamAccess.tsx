import * as React from 'react';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, Link2, ShieldCheck, UserMinus, UserPlus, UserRoundCheck } from 'lucide-react';
import { EmptyState, ErrorState, SectionCard } from '@/components/common/bits';
import { ConfirmWithReason } from '@/components/common/controls';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/overlays';
import { Badge, Field, Input, NativeSelect, Skeleton, Textarea } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/hooks/useData';
import { ROLE_DESCRIPTIONS } from '@/lib/permissions';
import { ROLES, type RoleName } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';
import {
  inviteLink, useCreateUser, useReissueInvite, useTeamUsers, useUpdateUser,
  type IssuedInvite, type TeamUser,
} from './api';

/** Who can sign in, and what they may do once they have.
 *
 *  Administrators only. Every action here is checked again by the server; the
 *  guard rails below (no deactivating yourself, no removing the last
 *  administrator) mirror server rules so the button explains itself instead of
 *  failing after a click. */
export function TeamAccess({ currentUserId }: { currentUserId: string }) {
  const users = useTeamUsers();
  const [adding, setAdding] = React.useState(false);
  const [issued, setIssued] = React.useState<{ user: TeamUser; invite: IssuedInvite; kind: LinkKind } | null>(null);
  const [roleFor, setRoleFor] = React.useState<TeamUser | null>(null);
  const [linkFor, setLinkFor] = React.useState<TeamUser | null>(null);
  const [deactivating, setDeactivating] = React.useState<TeamUser | null>(null);
  const [reactivating, setReactivating] = React.useState<TeamUser | null>(null);
  const update = useUpdateUser();

  if (users.error) return <ErrorState message={users.error.message} onRetry={() => users.refetch()} />;

  const list = users.data ?? [];
  const activeAdmins = list.filter((u) => u.active && u.role === 'System Administrator').length;
  const counts = {
    active: list.filter((u) => u.active && u.status === 'active').length,
    invited: list.filter((u) => u.active && u.status === 'invited').length,
    expired: list.filter((u) => u.active && u.status === 'no-access').length,
    deactivated: list.filter((u) => !u.active).length,
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Team and access"
        description="Everyone who can sign in to this workspace. Agents are separate and never get an account."
        actions={<Button size="sm" onClick={() => setAdding(true)}><UserPlus /> Add person</Button>}
      >
        {users.isLoading ? (
          <div className="flex flex-col gap-2" aria-label="Loading team">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : list.length === 0 ? (
          <EmptyState title="No accounts yet" description="Add the first person to send them an invite link." />
        ) : (
          <>
            <p className="mb-3 text-[12px] text-muted-foreground">
              {counts.active} signed up · {counts.invited} invited, waiting · {counts.expired} link expired · {counts.deactivated} deactivated
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[52rem] border-collapse text-sm">
                <thead className="bg-surface-2">
                  <tr>
                    {['Person', 'Role', 'Access', 'Last sign-in', 'Actions'].map((h) => (
                      <th key={h} scope="col" className="border-b border-border px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((u) => {
                    const isSelf = u.id === currentUserId;
                    const lastAdmin = u.active && u.role === 'System Administrator' && activeAdmins <= 1;
                    const deactivateBlock = isSelf
                      ? 'You cannot deactivate your own account.'
                      : lastAdmin ? 'This is the only active administrator. Make someone else an administrator first.' : undefined;
                    return (
                      <tr key={u.id} className={`border-b border-border last:border-0 ${u.active ? '' : 'opacity-60'}`}>
                        <th scope="row" className="px-3 py-2 text-left align-top font-normal">
                          {/* The spaces between these blocks are for screen readers, which
                              otherwise announce the row as "CJcj@example.com". */}
                          <span className="block text-[13px] font-medium">
                            {u.name}{isSelf && <> <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(you)</span></>}
                          </span>{' '}
                          <span className="block text-[12px] text-muted-foreground">{u.email}</span>{' '}
                          {u.title && <span className="block text-[11px] text-muted-foreground">{u.title}</span>}
                        </th>
                        <td className="px-3 py-2 align-top text-[13px]">{u.role}</td>
                        <td className="px-3 py-2 align-top"><AccessBadge user={u} /></td>
                        <td className="px-3 py-2 align-top text-[12px] text-muted-foreground">
                          {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never'}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex flex-wrap gap-1.5">
                            <Button size="sm" variant="outline" onClick={() => setRoleFor(u)} disabled={!u.active}
                              title={u.active ? undefined : 'Reactivate the account to change its role.'}
                              aria-label={`Change role for ${u.name}`}>
                              <ShieldCheck /> Role
                            </Button>
                            {u.active && (
                              <Button size="sm" variant="outline" onClick={() => setLinkFor(u)}
                                aria-label={`${linkKindOf(u) === 'reset' ? 'Password reset link' : 'New invite link'} for ${u.name}`}>
                                {linkKindOf(u) === 'reset' ? <><KeyRound /> Reset link</> : <><Link2 /> Invite link</>}
                              </Button>
                            )}
                            {u.active ? (
                              <Button size="sm" variant="outline" onClick={() => setDeactivating(u)}
                                disabled={Boolean(deactivateBlock)} title={deactivateBlock}
                                aria-label={`Deactivate ${u.name}`}>
                                <UserMinus /> Deactivate
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" onClick={() => setReactivating(u)} aria-label={`Reactivate ${u.name}`}>
                                <UserRoundCheck /> Reactivate
                              </Button>
                            )}
                          </div>
                          {deactivateBlock && u.active && (
                            <p className="mt-1 text-[11px] text-muted-foreground">{deactivateBlock}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionCard>

      <AddPersonDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={(user, invite) => setIssued({ user, invite, kind: 'invite' })}
      />

      <ChangeRoleDialog user={roleFor} onClose={() => setRoleFor(null)} activeAdmins={activeAdmins} currentUserId={currentUserId} />

      <IssueLinkDialog
        user={linkFor}
        onClose={() => setLinkFor(null)}
        onIssued={(user, invite) => setIssued({ user, invite, kind: linkKindOf(user) })}
      />

      <ConfirmWithReason
        open={Boolean(deactivating)}
        onOpenChange={(v) => { if (!v) setDeactivating(null); }}
        title={`Deactivate ${deactivating?.name ?? ''}?`}
        description="They are signed out everywhere immediately and cannot sign in again. Their history, and everything they recorded, stays. You can reactivate the account later."
        confirmLabel="Deactivate account"
        placeholder="Why this person no longer needs access, e.g. left the team on 13 Sep."
        hint="At least 10 characters. Written to the audit history."
        onConfirm={async (reason) => {
          const u = deactivating!;
          try {
            await update.mutateAsync({ id: u.id, active: false, reason });
            toast.success(`${u.name} deactivated and signed out`);
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />

      <ConfirmWithReason
        open={Boolean(reactivating)}
        onOpenChange={(v) => { if (!v) setReactivating(null); }}
        danger={false}
        title={`Reactivate ${reactivating?.name ?? ''}?`}
        description="They can sign in again with their existing password. If they never set one, send a new invite link afterwards."
        confirmLabel="Reactivate account"
        placeholder="Why this person needs access again."
        hint="At least 10 characters. Written to the audit history."
        onConfirm={async (reason) => {
          const u = reactivating!;
          try {
            await update.mutateAsync({ id: u.id, active: true, reason });
            toast.success(`${u.name} reactivated`);
          } catch (e) {
            toast.error((e as Error).message);
            throw e;
          }
        }}
      />

      <LinkShownOnce issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

/* ── Status ───────────────────────────────────────────────────── */

function AccessBadge({ user }: { user: TeamUser }) {
  if (!user.active) return <Badge tone="neutral">Deactivated</Badge>;
  if (user.status === 'active') return <Badge tone="success">Signed up</Badge>;
  if (user.status === 'invited') return <Badge tone="info">Invited, waiting</Badge>;
  return <Badge tone="warning">Link expired</Badge>;
}

/** A link for someone who already has a password replaces that password when
 *  opened. It must never be presented as a harmless re-invite. */
type LinkKind = 'invite' | 'reset';
const linkKindOf = (u: TeamUser): LinkKind => (u.status === 'active' ? 'reset' : 'invite');

/* ── Add ──────────────────────────────────────────────────────── */

function AddPersonDialog({
  open, onOpenChange, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (user: TeamUser, invite: IssuedInvite) => void;
}) {
  const create = useCreateUser();
  const [form, setForm] = React.useState({ name: '', email: '', title: '', role: 'Marketing Staff' as RoleName });
  const [errors, setErrors] = React.useState<Partial<Record<keyof typeof form, string>>>({});

  React.useEffect(() => {
    if (open) {
      setForm({ name: '', email: '', title: '', role: 'Marketing Staff' });
      setErrors({});
    }
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (form.name.trim().length < 2) next.name = 'Enter the person’s name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address.';
    setErrors(next);
    if (Object.keys(next).length) return;

    try {
      const result = await create.mutateAsync({
        name: form.name.trim(), email: form.email.trim(), title: form.title.trim(), role: form.role,
      });
      onOpenChange(false);
      onCreated(result.user, { inviteToken: result.inviteToken, inviteExpiresAt: result.inviteExpiresAt });
    } catch (e) {
      const err = e as ApiError;
      if (err.field === 'email' || err.field === 'name') setErrors({ [err.field]: err.message });
      else toast.error(err.message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add a person</DialogTitle>
            <DialogDescription>
              Creates their account and gives you a one-time invite link to send them. Nobody sets a password for
              them — they choose their own.
            </DialogDescription>
          </DialogHeader>

          <Field label="Name" htmlFor="team-name" required error={errors.name}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </Field>
          <Field label="Email" htmlFor="team-email" required error={errors.email}
            hint="What they will sign in with. It cannot be the same as someone else’s.">
            <Input type="email" autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Job title" htmlFor="team-title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Marketing Editor" />
          </Field>
          <Field label="Role" htmlFor="team-role" hint={ROLE_DESCRIPTIONS[form.role]}>
            <NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as RoleName })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </NativeSelect>
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create and get link'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ── Role ─────────────────────────────────────────────────────── */

function ChangeRoleDialog({
  user, onClose, activeAdmins, currentUserId,
}: { user: TeamUser | null; onClose: () => void; activeAdmins: number; currentUserId: string }) {
  const update = useUpdateUser();
  const [role, setRole] = React.useState<RoleName>('Marketing Staff');
  const [reason, setReason] = React.useState('');

  React.useEffect(() => {
    if (user) {
      setRole(user.role);
      setReason('');
    }
  }, [user]);

  if (!user) return null;
  const demotingLastAdmin = user.role === 'System Administrator' && role !== 'System Administrator' && activeAdmins <= 1;
  const demotingSelf = user.id === currentUserId && user.role === 'System Administrator' && role !== 'System Administrator';
  const unchanged = role === user.role;
  const valid = !unchanged && !demotingLastAdmin && reason.trim().length >= 10;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Change role for {user.name}</DialogTitle>
          <DialogDescription>
            Takes effect immediately. They are signed out and sign in again with the new permissions.
          </DialogDescription>
        </DialogHeader>

        <Field label="Role" htmlFor="role-select" hint={ROLE_DESCRIPTIONS[role]}
          error={demotingLastAdmin ? 'This is the only active administrator. Make someone else an administrator first.' : undefined}>
          <NativeSelect value={role} onChange={(e) => setRole(e.target.value as RoleName)}>
            {ROLES.map((r) => <option key={r} value={r}>{r}{r === user.role ? ' (current)' : ''}</option>)}
          </NativeSelect>
        </Field>

        {demotingSelf && !demotingLastAdmin && (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning-bg/40 px-3 py-2 text-[12px]">
            This is your own account. You will lose administrator access, and this screen, as soon as you save.
          </p>
        )}

        <Field label="Reason" htmlFor="role-reason" required hint="At least 10 characters. Written to the audit history.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why their access is changing." />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!valid || update.isPending}
            onClick={async () => {
              try {
                await update.mutateAsync({ id: user.id, role, reason: reason.trim() });
                toast.success(`${user.name} is now ${role}`);
                onClose();
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {update.isPending ? 'Saving…' : 'Change role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Links ────────────────────────────────────────────────────── */

function IssueLinkDialog({
  user, onClose, onIssued,
}: { user: TeamUser | null; onClose: () => void; onIssued: (user: TeamUser, invite: IssuedInvite) => void }) {
  const reissue = useReissueInvite();
  if (!user) return null;
  const kind = linkKindOf(user);

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{kind === 'reset' ? `Password reset link for ${user.name}` : `New invite link for ${user.name}`}</DialogTitle>
          <DialogDescription>
            {kind === 'reset'
              ? `${user.name} already has a password. Whoever opens this link can replace it and will be signed in as ${user.name}; they are then signed out everywhere else. Only do this when they have asked, and send it to them directly.`
              : 'Any earlier link for this person stops working, and the new one is valid for 72 hours.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant={kind === 'reset' ? 'danger' : 'default'}
            disabled={reissue.isPending}
            onClick={async () => {
              try {
                const invite = await reissue.mutateAsync(user.id);
                onClose();
                onIssued(user, invite);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            {reissue.isPending ? 'Creating…' : kind === 'reset' ? 'Create reset link' : 'Create invite link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The only place a link is ever shown. It is held in component state and gone
 *  once this closes: the server keeps only a hash, so it cannot be shown again. */
function LinkShownOnce({
  issued, onClose,
}: { issued: { user: TeamUser; invite: IssuedInvite; kind: LinkKind } | null; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => setCopied(false), [issued]);
  if (!issued) return null;

  const link = inviteLink(issued.invite.inviteToken);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      toast.error('Could not copy. Select the link and copy it by hand.');
    }
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>
            {issued.kind === 'reset' ? 'Password reset link' : 'Invite link'} for {issued.user.name}
          </DialogTitle>
          <DialogDescription>
            Send this to {issued.user.name} privately — a direct message, not a group chat. Whoever opens it can set
            the password for {issued.user.email}. It works once and expires {formatDateTime(issued.invite.inviteExpiresAt)}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <label htmlFor="issued-link" className="text-[12px] font-medium">Link</label>
          <div className="flex gap-2">
            <Input id="issued-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-[12px]" />
            <Button type="button" variant="outline" onClick={copy} aria-label="Copy link">
              {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
            </Button>
          </div>
        </div>

        <p role="note" className="rounded-md border border-warning/40 bg-warning-bg/40 px-3 py-2 text-[12px]">
          <strong>This is the only time it is shown.</strong> It is not stored anywhere you can come back to. If it is
          lost, create a new one — that cancels this one.
        </p>

        <DialogFooter>
          <Button onClick={onClose}>{copied ? 'Done' : 'I have sent it'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
