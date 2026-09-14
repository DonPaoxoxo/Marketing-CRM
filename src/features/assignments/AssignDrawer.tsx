import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, NativeSelect, Textarea } from '@/components/ui/primitives';
import { Dialog, DrawerContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/overlays';
import { SecurityNotice } from '@/components/common/bits';
import { ApiError, useCreate, useCrmData } from '@/hooks/useData';
import { checkAssignmentConflict, previousCustodianFor } from '@/lib/rules';
import { RESOURCE_TYPE, type Assignment, type ResourceType } from '@/lib/types';
import { toISODate } from '@/lib/utils';

const schema = z.object({
  resourceType: z.enum(RESOURCE_TYPE),
  resourceId: z.string().min(1, 'Select a resource.'),
  assigneeKind: z.enum(['Team Member', 'Agent']),
  newAssigneeId: z.string().min(1, 'Select who is receiving this resource.'),
  role: z.enum(['Primary Custodian', 'Collaborator']),
  projectId: z.string(),
  startDate: z.string().min(1, 'A start date is required.'),
  expectedReturnDate: z.string(),
  purpose: z.string().min(3, 'Describe why this resource is being assigned.'),
  handoverStatus: z.enum(['Pending', 'In Progress', 'Acknowledged', 'Completed']),
  credentialAction: z.enum(['None', 'Access Granted', 'Access Revoked', 'Credential Rotated']),
  notes: z.string(),
});

type Values = z.infer<typeof schema>;

export function AssignDrawer({
  open, onOpenChange, resourceType = 'Social Account', resourceId, lockResource = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resourceType?: ResourceType;
  resourceId?: string;
  lockResource?: boolean;
}) {
  const { data, lookups } = useCrmData();
  const create = useCreate<Assignment>('assignments', 'Assignment');

  const defaults: Values = React.useMemo(() => ({
    resourceType,
    resourceId: resourceId ?? '',
    assigneeKind: 'Team Member',
    newAssigneeId: '',
    role: 'Primary Custodian',
    projectId: '',
    startDate: toISODate(new Date()),
    expectedReturnDate: '',
    purpose: '',
    handoverStatus: 'Pending',
    credentialAction: 'None',
    notes: '',
  }), [resourceType, resourceId]);

  const { register, handleSubmit, reset, watch, formState: { errors, isSubmitting } } =
    useForm<Values>({ resolver: zodResolver(schema), defaultValues: defaults });

  React.useEffect(() => { if (open) reset(defaults); }, [open, defaults, reset]);

  const type = watch('resourceType');
  const chosenId = watch('resourceId');
  const role = watch('role');
  const kind = watch('assigneeKind');

  const resourceOptions = React.useMemo(() => {
    if (type === 'SIM') return (data?.sims ?? []).filter((s) => !s.archived).map((s) => ({ id: s.id, label: `${s.id} — ${s.phoneNumber}` }));
    if (type === 'Domain') return (data?.domains ?? []).filter((d) => !d.archived).map((d) => ({ id: d.id, label: `${d.id} — ${d.domainName}` }));
    return (data?.socialAccounts ?? []).filter((a) => !a.archived).map((a) => ({ id: a.id, label: `${a.id} — @${a.username}` }));
  }, [type, data]);

  const people = kind === 'Agent'
    ? (data?.agents ?? []).filter((a) => !a.archived).map((a) => ({ id: a.id, label: `${a.name} (${a.id})` }))
    : (data?.teamMembers ?? []).map((m) => ({ id: m.id, label: `${m.name} — ${m.title}` }));

  // Conflict is surfaced before submit, and re-checked server-side on save.
  const conflict = React.useMemo(() => {
    if (!chosenId || !data) return null;
    return checkAssignmentConflict(data.assignments, { resourceType: type, resourceId: chosenId, role });
  }, [chosenId, data, type, role]);

  const currentHolder = React.useMemo(
    () => data?.assignments.find((a) => a.active && a.role === 'Primary Custodian' && a.resourceType === type && a.resourceId === chosenId),
    [data, type, chosenId],
  );

  /** Who this assignment takes over from. Null for a collaborator — they are added
   *  alongside the custodian and replace nobody. */
  const previousCustodian = React.useMemo(
    () => (data && chosenId ? previousCustodianFor(data.assignments, type, chosenId, role) : null),
    [data, type, chosenId, role],
  );

  const onSubmit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync({
        resourceType: values.resourceType,
        resourceId: values.resourceId,
        previousAssigneeId: previousCustodian?.newAssigneeId ?? null,
        previousAssigneeType: previousCustodian?.newAssigneeType ?? null,
        newAssigneeId: values.newAssigneeId,
        newAssigneeType: values.assigneeKind,
        role: values.role,
        brandId: data?.socialAccounts.find((a) => a.id === values.resourceId)?.brandId
          ?? data?.sims.find((s) => s.id === values.resourceId)?.brandId ?? null,
        projectId: values.projectId || null,
        startDate: values.startDate,
        expectedReturnDate: values.expectedReturnDate || null,
        purpose: values.purpose,
        handoverStatus: values.handoverStatus,
        credentialAction: values.credentialAction,
        notes: values.notes,
        reason: values.purpose,
      });
      onOpenChange(false);
    } catch (e) {
      if (!(e instanceof ApiError)) throw e; // conflict message already surfaced by the toast
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DrawerContent aria-describedby="assign-desc">
        <div className="border-b border-border p-5">
          <DialogHeader>
            <DialogTitle>Assign a resource</DialogTitle>
            <DialogDescription id="assign-desc">
              Records a handover. A resource can have only one active primary custodian; additional people are recorded
              as collaborators.
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={onSubmit} noValidate className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          <Field label="Resource type" htmlFor="asg-type">
            <NativeSelect {...register('resourceType')} disabled={lockResource}>
              {RESOURCE_TYPE.map((t) => <option key={t} value={t}>{t}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Resource" htmlFor="asg-resource" required error={errors.resourceId?.message}>
            <NativeSelect {...register('resourceId')} disabled={lockResource}>
              <option value="">— Select —</option>
              {resourceOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </NativeSelect>
          </Field>

          {conflict?.conflict && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/50 bg-danger-bg/50 px-3 py-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
              <p className="text-[12px]">{conflict.message}</p>
            </div>
          )}

          <Field label="Assignee type" htmlFor="asg-kind">
            <NativeSelect {...register('assigneeKind')}>
              <option value="Team Member">Team member</option>
              <option value="Agent">Agent</option>
            </NativeSelect>
          </Field>

          <Field label="New assignee" htmlFor="asg-assignee" required error={errors.newAssigneeId?.message}
            hint={currentHolder ? `Current custodian: ${lookups.personName(currentHolder.newAssigneeId)}` : undefined}>
            <NativeSelect {...register('newAssigneeId')}>
              <option value="">— Select —</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </NativeSelect>
          </Field>

          <Field label="Role" htmlFor="asg-role"
            hint="Collaborators can be recorded alongside the primary custodian without conflict.">
            <NativeSelect {...register('role')}>
              <option value="Primary Custodian">Primary custodian</option>
              <option value="Collaborator">Collaborator</option>
            </NativeSelect>
          </Field>

          <Field label="Brand or project" htmlFor="asg-project">
            <NativeSelect {...register('projectId')}>
              <option value="">— None —</option>
              {(data?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>{lookups.brandName(p.brandId)} — {p.name}</option>
              ))}
            </NativeSelect>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date" htmlFor="asg-start" required error={errors.startDate?.message}>
              <Input type="date" {...register('startDate')} />
            </Field>
            <Field label="Expected return date" htmlFor="asg-return" hint="Optional.">
              <Input type="date" {...register('expectedReturnDate')} />
            </Field>
          </div>

          <Field label="Assignment purpose" htmlFor="asg-purpose" required error={errors.purpose?.message}>
            <Input {...register('purpose')} placeholder="Campaign execution for Diwali Launch 2026" />
          </Field>

          <Field label="Handover status" htmlFor="asg-status">
            <NativeSelect {...register('handoverStatus')}>
              {['Pending', 'In Progress', 'Acknowledged', 'Completed'].map((s) => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>

          <SecurityNotice>
            Credential handovers record <strong>what happened to access</strong> — granted, revoked or rotated. Secret
            values are never entered or stored in the handover log.
          </SecurityNotice>

          <Field label="Credential action" htmlFor="asg-cred">
            <NativeSelect {...register('credentialAction')}>
              <option value="None">None</option>
              <option value="Access Granted">Access granted</option>
              <option value="Access Revoked">Access revoked</option>
              <option value="Credential Rotated">Credential rotated</option>
            </NativeSelect>
          </Field>

          <Field label="Notes" htmlFor="asg-notes"><Textarea {...register('notes')} /></Field>

          <div className="mt-auto flex justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting || Boolean(conflict?.conflict)}>
              {isSubmitting ? 'Recording…' : 'Record assignment'}
            </Button>
          </div>
        </form>
      </DrawerContent>
    </Dialog>
  );
}
