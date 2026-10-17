import { Badge } from '@/components/ui/primitives';
import { daysSince } from '@/lib/utils';
import { ROTATION_SCHEDULE_LABELS, rotationScheduleBucket } from '@/lib/rules';
import type { DomainAccessibilityStatus, RotationBatchStatus } from '@/lib/types';

/** Border/text colour for the inline Accessibility select on the domain
 *  monitoring tables — a glance at the row's colour, not just its text. */
const ACCESSIBILITY_SELECT_TONE: Record<DomainAccessibilityStatus, string> = {
  Accessible: 'border-success/40 text-success',
  Inaccessible: 'border-danger/40 text-danger',
  Intermittent: 'border-warning/40 text-warning',
  'Not Checked': '',
};

export function accessibilitySelectClass(value: DomainAccessibilityStatus): string {
  return ACCESSIBILITY_SELECT_TONE[value];
}

const BATCH_STATUS_TONE: Record<RotationBatchStatus, 'success' | 'info'> = { Active: 'success', Standby: 'info' };

export function RotationBatchStatusBadge({ value }: { value: RotationBatchStatus }) {
  return <Badge tone={BATCH_STATUS_TONE[value]}>{value}</Badge>;
}

const ROTATION_SCHEDULE_TONE: Record<ReturnType<typeof rotationScheduleBucket>, 'neutral' | 'warning' | 'danger'> = {
  'on-schedule': 'neutral', 'due-soon': 'warning', overdue: 'danger',
};

export function RotationScheduleBadge({ nextRotationDueAt }: { nextRotationDueAt: string | null }) {
  const bucket = rotationScheduleBucket(nextRotationDueAt);
  return <Badge tone={ROTATION_SCHEDULE_TONE[bucket]}>{ROTATION_SCHEDULE_LABELS[bucket]}</Badge>;
}

export type DailyCheckBucket = 'checked-today' | 'pending-today' | 'overdue';

/** Checked yesterday (one day since) is "due, not yet overdue" — Pending
 *  Today. Never checked, or missed two or more days, is Overdue. A check
 *  recorded today is never erased at midnight; this is computed fresh from
 *  `lastCheckedDate`, never a stored flag. */
export function dailyCheckBucket(lastCheckedDate: string | null): DailyCheckBucket {
  const since = daysSince(lastCheckedDate);
  if (since === 0) return 'checked-today';
  if (since === null || since >= 2) return 'overdue';
  return 'pending-today';
}
