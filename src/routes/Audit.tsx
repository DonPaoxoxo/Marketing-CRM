import * as React from 'react';
import { ShieldAlert } from 'lucide-react';
import { PageHeader, SectionCard, ErrorState, SecurityNotice } from '@/components/common/bits';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlays';
import { AuditTimeline } from '@/components/common/AuditTimeline';
import { FilterBar, FilterSelect, SearchInput } from '@/components/common/controls';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useCrmData } from '@/hooks/useData';
import { useFilters } from '@/hooks/useFilters';
import { useSession } from '@/hooks/useSession';
import { useAuth } from '@/hooks/useAuth';
import { CONFIG } from '@/lib/config';
import { TeamAccess } from '@/features/team/TeamAccess';
import { ROLES } from '@/lib/types';
import { PermissionsEditor } from '@/features/team/PermissionsEditor';

const DEFAULTS = { search: '', action: 'all', type: 'all', actor: 'all' };

export default function AuditPage() {
  const { data, isLoading, error, refetch } = useCrmData();
  const { values, set, clear, activeCount } = useFilters(DEFAULTS);
  const { role, setRole, can } = useSession();
  const auth = useAuth();
  const signedIn = auth.status === 'authenticated' && auth.user;
  // Account management only exists against the real API, and only for the role
  // the server will let through. The server checks again on every call.
  const manageTeam = Boolean(signedIn) && can('manage:users');

  const entries = data?.auditEntries ?? [];

  const filtered = React.useMemo(() => {
    const needle = values.search.trim().toLowerCase();
    return entries.filter((e) => {
      if (values.action !== 'all' && e.action !== values.action) return false;
      if (values.type !== 'all' && e.recordType !== values.type) return false;
      if (values.actor !== 'all' && e.actorId !== values.actor) return false;
      if (needle) {
        const hay = [e.recordId, e.recordLabel, e.actorName, e.reason, e.recordType, ...e.changes.map((c) => c.field)]
          .join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [entries, values]);

  const recordTypes = React.useMemo(() => Array.from(new Set(entries.map((e) => e.recordType))).sort(), [entries]);
  const actions = React.useMemo(() => Array.from(new Set(entries.map((e) => e.action))).sort(), [entries]);

  if (error) return <ErrorState message={error.message} onRetry={() => refetch()} />;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Roles and audit history"
        description={manageTeam
          ? 'Who can sign in, what each role may do, and the full change history for this workspace.'
          : 'What each role may do, and the full change history for this workspace.'}
      />

      {signedIn ? (
        <SecurityNotice>
          You are signed in as <strong>{auth.user!.name}</strong> ({auth.user!.role}). Every request is checked on the
          server against the matrix below, so what you can do here is what the server allows — hiding a button is not
          what stops anyone.
        </SecurityNotice>
      ) : (
        <SecurityNotice>
          Role switching here is <strong>synthetic</strong>: this is the mock API, with no accounts and no sign-in, and
          it affects only what this browser session offers. The live workspace takes each person’s role from their
          session and enforces it on the server.
        </SecurityNotice>
      )}

      <Tabs defaultValue={manageTeam ? 'team' : 'roles'}>
        <TabsList>
          {manageTeam && <TabsTrigger value="team">Team and access</TabsTrigger>}
          <TabsTrigger value="roles">Roles and permissions</TabsTrigger>
          <TabsTrigger value="audit">Audit history ({entries.length})</TabsTrigger>
        </TabsList>

        {manageTeam && (
          <TabsContent value="team">
            <TeamAccess currentUserId={auth.user!.id} />
          </TabsContent>
        )}

        <TabsContent value="roles" className="flex flex-col gap-4">
          <PermissionsEditor />

          {CONFIG.enableRolePreview && !signedIn && (
            <SectionCard title="Preview as a role" description="Mock preview only: see the workspace as each role's default permissions would.">
              <div className="flex flex-wrap gap-2">
                {ROLES.map((rn) => (
                  rn === role
                    ? <Badge key={rn} tone="accent">{rn} (current)</Badge>
                    : <Button key={rn} size="sm" variant="outline" onClick={() => setRole(rn)}>Preview as {rn}</Button>
                ))}
              </div>
            </SectionCard>
          )}

          <SectionCard title="Destructive actions">
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <p className="text-[13px]">
                Records are <strong>archived, not deleted</strong>. Archiving and restoring require the archive permission and a
                written reason of at least ten characters, which is stored on the audit entry alongside the actor and
                timestamp.
              </p>
            </div>
          </SectionCard>
        </TabsContent>

        <TabsContent value="audit" className="flex flex-col gap-4">
          <FilterBar onClear={clear} activeCount={activeCount}>
            <SearchInput id="audit-search" value={values.search} onChange={(v) => set({ search: v })}
              placeholder="Search record, actor, reason, field…" className="min-w-[16rem] flex-1" />
            <FilterSelect id="audit-action" label="Action" value={values.action} onChange={(v) => set({ action: v })}
              options={[{ value: 'all', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: a.replace('-', ' ') }))]} />
            <FilterSelect id="audit-type" label="Record type" value={values.type} onChange={(v) => set({ type: v })}
              options={[{ value: 'all', label: 'All types' }, ...recordTypes.map((t) => ({ value: t, label: t }))]} />
            <FilterSelect id="audit-actor" label="Actor" value={values.actor} onChange={(v) => set({ actor: v })}
              options={[{ value: 'all', label: 'Anyone' }, ...(data?.teamMembers ?? []).map((m) => ({ value: m.id, label: m.name }))]} />
          </FilterBar>

          <SectionCard
            title={`${filtered.length} audit entr${filtered.length === 1 ? 'y' : 'ies'}`}
            description="Actor, timestamp, record, action, reason and safe field changes. Secret values are replaced with [redacted] before an entry is written."
          >
            {isLoading ? (
              <p className="text-[13px] text-muted-foreground">Loading audit history…</p>
            ) : (
              <AuditTimeline entries={filtered.slice(0, 150)} />
            )}
            {filtered.length > 150 && (
              <p className="mt-3 text-[12px] text-muted-foreground">Showing the 150 most recent of {filtered.length} entries.</p>
            )}
          </SectionCard>
        </TabsContent>
      </Tabs>
    </div>
  );
}
