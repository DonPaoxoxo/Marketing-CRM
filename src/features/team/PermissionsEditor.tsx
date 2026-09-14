import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Save, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { SectionCard, ErrorState } from '@/components/common/bits';
import { ConfirmWithReason } from '@/components/common/controls';
import { Button } from '@/components/ui/button';
import { Badge, Label, NativeSelect, Skeleton } from '@/components/ui/primitives';
import { ApiError, useActorQuery, useCrmData, withActor } from '@/hooks/useData';
import { useAuth } from '@/hooks/useAuth';
import { useSession } from '@/hooks/useSession';
import { PERMISSION_LABELS, ROLE_DESCRIPTIONS, SYSTEM_ADMIN_ROLE } from '@/lib/permissions';
import type { Permission, RoleName } from '@/lib/types';

interface Snapshot {
  grantable: Permission[];
  locked: Permission[];
  editableRoles: RoleName[];
  roles: Record<string, Permission[]>;
  users: Record<string, Permission[]>;
}

const GROUPS: { title: string; permissions: Permission[] }[] = [
  { title: 'Pages', permissions: ['access:domains', 'access:import', 'access:credential-refs', 'access:roles-audit'] },
  { title: 'Records', permissions: ['edit:resources', 'archive:records', 'assign:resources', 'import:records'] },
  { title: 'Data and credentials', permissions: ['view:contact-details', 'export:data', 'manage:credential-refs', 'request:credential-access'] },
];

export const PERMISSIONS_KEY = ['permissions'] as const;

async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } });
  const payload = await res.json().catch(() => ({ message: res.statusText }));
  if (!res.ok) throw new ApiError(payload.message ?? 'Request failed', res.status, payload.field);
  return payload as T;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Role permissions and individual extras. Editing needs 'manage:users', which
 *  only the System Administrator ever has; everyone who can open Roles & Audit
 *  sees the matrix read-only. The server checks every save again. */
export function PermissionsEditor() {
  const { can } = useSession();
  const { data: crm } = useCrmData();
  const auth = useAuth();
  const actor = useActorQuery();
  const qc = useQueryClient();
  const canEdit = can('manage:users');

  const snapshot = useQuery({ queryKey: [...PERMISSIONS_KEY, actor], queryFn: () => call<Snapshot>(withActor('/api/permissions', actor)) });
  const [draft, setDraft] = React.useState<Record<string, Permission[]>>({});
  const [confirmRoles, setConfirmRoles] = React.useState(false);
  const [personId, setPersonId] = React.useState('');
  const [personDraft, setPersonDraft] = React.useState<Permission[] | null>(null);
  const [confirmPerson, setConfirmPerson] = React.useState(false);

  React.useEffect(() => { if (snapshot.data) setDraft(snapshot.data.roles); }, [snapshot.data]);
  React.useEffect(() => { setPersonDraft(null); }, [personId]);

  const afterSave = async () => {
    await qc.invalidateQueries({ queryKey: PERMISSIONS_KEY });
    // Your own screens follow at once; everyone else's on their next page load.
    await auth.refresh();
  };

  const saveRoles = useMutation({
    mutationFn: async (reason: string) => {
      const changed = snapshot.data!.editableRoles.filter((r) => !sameSet(draft[r] ?? [], snapshot.data!.roles[r] ?? []));
      for (const role of changed) {
        await call(withActor(`/api/permissions/roles/${encodeURIComponent(role)}`, actor), { method: 'PUT', body: JSON.stringify({ permissions: draft[role], reason }) });
      }
      return changed;
    },
    onSuccess: async (changed) => { await afterSave(); toast.success(`Saved permissions for ${changed.join(', ')}`); },
    onError: (e: ApiError) => toast.error(e.message),
  });

  const savePerson = useMutation({
    mutationFn: (reason: string) => call(withActor(`/api/permissions/users/${encodeURIComponent(personId)}`, actor), { method: 'PUT', body: JSON.stringify({ permissions: personDraft, reason }) }),
    onSuccess: async () => { await afterSave(); setPersonDraft(null); toast.success('Individual permissions saved'); },
    onError: (e: ApiError) => toast.error(e.message),
  });

  if (snapshot.error) return <ErrorState message={snapshot.error.message} onRetry={() => snapshot.refetch()} />;
  if (!snapshot.data) return <Skeleton className="h-64 w-full" />;
  const s = snapshot.data;
  const dirtyRoles = s.editableRoles.filter((r) => !sameSet(draft[r] ?? [], s.roles[r] ?? []));
  const toggle = (role: RoleName, p: Permission) => setDraft((d) => {
    const list = d[role] ?? [];
    return { ...d, [role]: list.includes(p) ? list.filter((x) => x !== p) : [...list, p] };
  });

  const people = (crm?.teamMembers ?? []).filter((m) => m.active && m.role !== SYSTEM_ADMIN_ROLE);
  const person = people.find((m) => m.id === personId);
  const roleList = person ? s.roles[person.role] ?? [] : [];
  const extras = personDraft ?? (person ? s.users[person.id] ?? [] : []);
  const personDirty = person && personDraft !== null && !sameSet(personDraft, s.users[person.id] ?? []);

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Role permissions"
        description={canEdit
          ? 'Tick what each role may do. Changes take effect on the server immediately; people see their new menu on their next page load.'
          : 'What each role may do. Only the System Administrator can change this.'}
        actions={canEdit ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!dirtyRoles.length} onClick={() => setDraft(s.roles)}><Undo2 /> Discard</Button>
            <Button size="sm" disabled={!dirtyRoles.length || saveRoles.isPending} onClick={() => setConfirmRoles(true)}><Save /> Save changes{dirtyRoles.length ? ` (${dirtyRoles.length})` : ''}</Button>
          </div>
        ) : undefined}
      >
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[48rem] border-collapse text-[13px]">
            <caption className="sr-only">Role permissions</caption>
            <thead className="bg-surface-2">
              <tr>
                <th scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Permission</th>
                <th scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">System Administrator</th>
                {s.editableRoles.map((r) => (
                  <th key={r} scope="col" className="border-b border-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {r}{dirtyRoles.includes(r) && <Badge tone="warning" className="ml-1">unsaved</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {GROUPS.map((g) => (
                <React.Fragment key={g.title}>
                  <tr><th colSpan={2 + s.editableRoles.length} scope="colgroup" className="bg-muted/40 px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</th></tr>
                  {g.permissions.map((p) => (
                    <tr key={p} className="border-t border-border">
                      <th scope="row" className="px-3 py-2 text-left font-medium">{PERMISSION_LABELS[p]}</th>
                      <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Always</span></td>
                      {s.editableRoles.map((r) => {
                        const on = (draft[r] ?? []).includes(p);
                        return (
                          <td key={r} className="px-3 py-2">
                            <label className="inline-flex items-center gap-2">
                              <input type="checkbox" checked={on} disabled={!canEdit} onChange={() => toggle(r, p)} aria-label={`${PERMISSION_LABELS[p]} for ${r}`} />
                              <span className={on ? '' : 'text-muted-foreground'}>{on ? 'Allowed' : 'Not allowed'}</span>
                            </label>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
              {s.locked.map((p) => (
                <tr key={p} className="border-t border-border bg-muted/20">
                  <th scope="row" className="px-3 py-2 text-left font-medium">{PERMISSION_LABELS[p]}</th>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1 text-success"><Check className="h-3.5 w-3.5" aria-hidden="true" /> Always</span></td>
                  <td colSpan={s.editableRoles.length} className="px-3 py-2 text-muted-foreground"><span className="inline-flex items-center gap-1"><Lock className="h-3.5 w-3.5" aria-hidden="true" /> System Administrator only — cannot be given to anyone else, so no one can be locked out.</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-3 grid gap-2 text-[12px] text-muted-foreground sm:grid-cols-2">
          {s.editableRoles.map((r) => <li key={r}><strong className="text-foreground">{r}:</strong> {ROLE_DESCRIPTIONS[r]}</li>)}
          <li className="sm:col-span-2">Some checks stay with the record itself: an agent is edited only by its manager, an ads record only by its creator, whatever the role allows. Reviewing and deleting Team Reports and Ads alert thresholds remain the System Administrator's.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Individual access" description="Give one person something extra on top of their role — for example, let only Gordon open Domains. Extras never remove what the role already gives.">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="perm-person">Person</Label>
              <NativeSelect id="perm-person" className="w-72" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">Choose a person…</option>
                {people.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.role}{m.email ? ` · ${m.email}` : ''}{(s.users[m.id]?.length ?? 0) > 0 ? ` (+${s.users[m.id].length} extra)` : ''}</option>)}
              </NativeSelect>
            </div>
            {person && canEdit && (
              <>
                <Button size="sm" variant="outline" disabled={!personDirty} onClick={() => setPersonDraft(null)}><Undo2 /> Discard</Button>
                <Button size="sm" disabled={!personDirty || savePerson.isPending} onClick={() => setConfirmPerson(true)}><Save /> Save for {person.name}</Button>
              </>
            )}
          </div>
          {person ? (
            <div className="grid gap-3 md:grid-cols-3">
              {GROUPS.map((g) => (
                <fieldset key={g.title} className="rounded-md border border-border p-3">
                  <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</legend>
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {g.permissions.map((p) => {
                      const fromRole = roleList.includes(p);
                      const on = fromRole || extras.includes(p);
                      return (
                        <li key={p}>
                          <label className="inline-flex items-center gap-2">
                            <input type="checkbox" checked={on} disabled={!canEdit || fromRole}
                              onChange={() => setPersonDraft((d) => { const list = d ?? s.users[person.id] ?? []; return list.includes(p) ? list.filter((x) => x !== p) : [...list, p]; })}
                              aria-label={`${PERMISSION_LABELS[p]} for ${person.name}`} />
                            {PERMISSION_LABELS[p]}
                            {fromRole ? <Badge tone="outline">from role</Badge> : extras.includes(p) ? <Badge tone="accent">extra</Badge> : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              ))}
            </div>
          ) : <p className="text-[13px] text-muted-foreground">Choose a person to see their access.</p>}
        </div>
      </SectionCard>

      <ConfirmWithReason
        open={confirmRoles}
        onOpenChange={setConfirmRoles}
        title={`Save permissions for ${dirtyRoles.join(', ')}?`}
        description="Everyone in these roles gets the new permissions immediately. The change and your reason are written to the audit history."
        confirmLabel="Save permissions"
        danger={false}
        placeholder="Why are these permissions changing?"
        hint="At least 10 characters."
        onConfirm={(reason) => saveRoles.mutateAsync(reason)}
      />
      <ConfirmWithReason
        open={confirmPerson}
        onOpenChange={setConfirmPerson}
        title={`Save individual access for ${person?.name ?? ''}?`}
        description="This person's extra permissions change immediately. The change and your reason are written to the audit history."
        confirmLabel="Save access"
        danger={false}
        placeholder="Why does this person need different access?"
        hint="At least 10 characters."
        onConfirm={(reason) => savePerson.mutateAsync(reason)}
      />
    </div>
  );
}
