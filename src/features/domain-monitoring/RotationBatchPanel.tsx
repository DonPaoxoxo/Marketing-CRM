/** Rotation Management tab: set up rotation groups and their batches, and
 *  assign Invite Domains to a batch — configuration only. A batch becomes
 *  Active, and the group's schedule starts ticking, only once a full rotation
 *  is run (a later build phase); see migration 019 and batches.ts. */

import * as React from 'react';
import { Archive, ArchiveRestore, ArrowRightLeft, CalendarClock, Pencil, Plus, RefreshCw, Users } from 'lucide-react';
import { EmptyState, SectionCard } from '@/components/common/bits';
import { ConfirmWithReason } from '@/components/common/controls';
import { Badge } from '@/components/ui/primitives';
import { Button } from '@/components/ui/button';
import { useCrmData } from '@/hooks/useData';
import { useSession } from '@/hooks/useSession';
import type { RotationBatchRecord, RotationGroupRecord } from '@/lib/types';
import { RotationBatchStatusBadge, RotationScheduleBadge } from './badges';
import { RotationGroupFormDialog } from './RotationGroupFormDialog';
import { RotationBatchFormDialog } from './RotationBatchFormDialog';
import { BatchMembersDialog } from './BatchMembersDialog';
import { RotateBatchWizard } from './RotateBatchWizard';
import { PartialRotationDialog } from './PartialRotationDialog';
import { RotationOverrideDialog } from './RotationOverrideDialog';
import { useUpdateRotationGroup, useUpdateRotationBatch } from './api';

export function RotationBatchPanel() {
  const { data, isLoading } = useCrmData();
  const { can } = useSession();
  const updateGroup = useUpdateRotationGroup();
  const updateBatch = useUpdateRotationBatch();

  const [groupFormOpen, setGroupFormOpen] = React.useState(false);
  const [editingGroup, setEditingGroup] = React.useState<RotationGroupRecord | undefined>();
  const [archivingGroup, setArchivingGroup] = React.useState<RotationGroupRecord | undefined>();
  const [restoringGroup, setRestoringGroup] = React.useState<RotationGroupRecord | undefined>();

  const [batchDialog, setBatchDialog] = React.useState<{ group: RotationGroupRecord; batch?: RotationBatchRecord } | undefined>();
  const [archivingBatch, setArchivingBatch] = React.useState<RotationBatchRecord | undefined>();
  const [restoringBatch, setRestoringBatch] = React.useState<RotationBatchRecord | undefined>();
  const [membersFor, setMembersFor] = React.useState<RotationBatchRecord | undefined>();
  const [rotatingGroup, setRotatingGroup] = React.useState<RotationGroupRecord | undefined>();
  const [partialGroup, setPartialGroup] = React.useState<RotationGroupRecord | undefined>();
  const [overrideGroup, setOverrideGroup] = React.useState<RotationGroupRecord | undefined>();

  const groups = data?.rotationGroups ?? [];
  const batches = data?.rotationBatches ?? [];
  const members = data?.rotationBatchMembers ?? [];
  const memberCount = (batchId: string) => members.filter((m) => m.rotationBatchId === batchId).length;

  const mayManage = can('manage:rotation-batches');
  const mayRotateFull = can('execute:full-rotation');
  const mayRotatePartial = can('execute:partial-rotation');
  const mayOverride = can('override:rotation-schedule');

  if (!isLoading && groups.length === 0) {
    return (
      <>
        <EmptyState
          title="No rotation groups yet"
          description="Create a rotation group, then add two or more batches of Invite Domains to it. Running a full rotation lands in a later update."
          action={mayManage ? <Button size="sm" onClick={() => { setEditingGroup(undefined); setGroupFormOpen(true); }}><Plus /> New rotation group</Button> : undefined}
        />
        <RotationGroupFormDialog open={groupFormOpen} onOpenChange={setGroupFormOpen} group={editingGroup} />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setEditingGroup(undefined); setGroupFormOpen(true); }} disabled={!mayManage}>
          <Plus /> New rotation group
        </Button>
      </div>

      {groups.map((group) => {
        const groupBatches = batches.filter((b) => b.rotationGroupId === group.id);
        return (
          <SectionCard
            key={group.id}
            title={group.archived ? `${group.name} (Archived)` : group.name}
            description={`${group.rotationIntervalDays}-day rotation · next due: ${group.nextRotationDueAt ? new Date(group.nextRotationDueAt).toLocaleString() : 'not started'}`}
            actions={
              <div className="flex items-center gap-1">
                {!group.archived && <RotationScheduleBadge nextRotationDueAt={group.nextRotationDueAt} />}
                {!group.archived && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setRotatingGroup(group)} disabled={!mayRotateFull}>
                      <RefreshCw /> Run rotation
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPartialGroup(group)} disabled={!mayRotatePartial}>
                      <ArrowRightLeft /> Partial rotation
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setOverrideGroup(group)} disabled={!mayOverride}>
                      <CalendarClock /> Override
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setBatchDialog({ group })} disabled={!mayManage}>
                      <Plus /> New batch
                    </Button>
                  </>
                )}
                <Button size="icon-sm" variant="ghost" aria-label={`Edit ${group.name}`} disabled={!mayManage} onClick={() => { setEditingGroup(group); setGroupFormOpen(true); }}>
                  <Pencil />
                </Button>
                {group.archived ? (
                  <Button size="icon-sm" variant="ghost" aria-label={`Restore ${group.name}`} disabled={!can('archive:records')} onClick={() => setRestoringGroup(group)}>
                    <ArchiveRestore />
                  </Button>
                ) : (
                  <Button size="icon-sm" variant="ghost" aria-label={`Archive ${group.name}`} disabled={!can('archive:records')} onClick={() => setArchivingGroup(group)}>
                    <Archive />
                  </Button>
                )}
              </div>
            }
          >
            {group.notes && <p className="mb-3 text-[13px] text-muted-foreground">{group.notes}</p>}
            {groupBatches.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No batches yet — add at least two to run a rotation.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {groupBatches.map((batch) => (
                  <div key={batch.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-2 text-[13px] font-medium">
                        {batch.name}
                        <RotationBatchStatusBadge value={batch.status} />
                        {batch.archived && <Badge tone="neutral">Archived</Badge>}
                      </span>
                      <span className="text-[12px] text-muted-foreground">{memberCount(batch.id)} domain{memberCount(batch.id) === 1 ? '' : 's'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {!batch.archived && (
                        <Button size="icon-sm" variant="ghost" aria-label={`Manage members of ${batch.name}`} disabled={!mayManage} onClick={() => setMembersFor(batch)} title="Manage members">
                          <Users />
                        </Button>
                      )}
                      <Button size="icon-sm" variant="ghost" aria-label={`Edit ${batch.name}`} disabled={!mayManage} onClick={() => setBatchDialog({ group, batch })}>
                        <Pencil />
                      </Button>
                      {batch.archived ? (
                        <Button size="icon-sm" variant="ghost" aria-label={`Restore ${batch.name}`} disabled={!can('archive:records')} onClick={() => setRestoringBatch(batch)}>
                          <ArchiveRestore />
                        </Button>
                      ) : (
                        <Button size="icon-sm" variant="ghost" aria-label={`Archive ${batch.name}`} disabled={!can('archive:records') || batch.status === 'Active'} title={batch.status === 'Active' ? 'Rotate this batch out before archiving it.' : undefined} onClick={() => setArchivingBatch(batch)}>
                          <Archive />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        );
      })}

      <RotationGroupFormDialog open={groupFormOpen} onOpenChange={(v) => { setGroupFormOpen(v); if (!v) setEditingGroup(undefined); }} group={editingGroup} />
      {batchDialog && (
        <RotationBatchFormDialog
          open
          onOpenChange={(v) => { if (!v) setBatchDialog(undefined); }}
          group={batchDialog.group}
          batch={batchDialog.batch}
        />
      )}
      <BatchMembersDialog open={Boolean(membersFor)} onOpenChange={(v) => !v && setMembersFor(undefined)} batch={membersFor} />
      <RotateBatchWizard open={Boolean(rotatingGroup)} onOpenChange={(v) => !v && setRotatingGroup(undefined)} group={rotatingGroup} />
      <PartialRotationDialog open={Boolean(partialGroup)} onOpenChange={(v) => !v && setPartialGroup(undefined)} group={partialGroup} />
      <RotationOverrideDialog open={Boolean(overrideGroup)} onOpenChange={(v) => !v && setOverrideGroup(undefined)} group={overrideGroup} />

      <ConfirmWithReason
        open={Boolean(archivingGroup)}
        onOpenChange={(v) => !v && setArchivingGroup(undefined)}
        title={`Archive ${archivingGroup?.name ?? ''}?`}
        description="Its batches stay as they are. The group is kept and can be restored."
        onConfirm={(reason) => updateGroup.mutateAsync({ id: archivingGroup!.id, archived: true, reason })}
      />
      <ConfirmWithReason
        open={Boolean(restoringGroup)}
        onOpenChange={(v) => !v && setRestoringGroup(undefined)}
        title={`Restore ${restoringGroup?.name ?? ''}?`}
        description="The group returns to the active list."
        confirmLabel="Restore group"
        danger={false}
        placeholder="Why is this being restored? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={(reason) => updateGroup.mutateAsync({ id: restoringGroup!.id, archived: false, reason })}
      />
      <ConfirmWithReason
        open={Boolean(archivingBatch)}
        onOpenChange={(v) => !v && setArchivingBatch(undefined)}
        title={`Archive ${archivingBatch?.name ?? ''}?`}
        description="Its members keep their batch assignment. The batch is kept and can be restored."
        onConfirm={(reason) => updateBatch.mutateAsync({ id: archivingBatch!.id, archived: true, reason })}
      />
      <ConfirmWithReason
        open={Boolean(restoringBatch)}
        onOpenChange={(v) => !v && setRestoringBatch(undefined)}
        title={`Restore ${restoringBatch?.name ?? ''}?`}
        description="The batch returns to the active list."
        confirmLabel="Restore batch"
        danger={false}
        placeholder="Why is this being restored? This is written to the audit trail."
        hint="At least 10 characters."
        onConfirm={(reason) => updateBatch.mutateAsync({ id: restoringBatch!.id, archived: false, reason })}
      />
    </div>
  );
}
