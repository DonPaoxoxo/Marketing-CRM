import { Badge } from '@/components/ui/primitives';
import { daysSince } from '@/lib/utils';
import { ROTATION_SCHEDULE_LABELS, rotationScheduleBucket } from '@/lib/rules';
import type { DomainAccessibilityStatus, DomainActivationStatus, RotationBatchStatus } from '@/lib/types';

const ACCESSIBILITY_TONE: Record<DomainAccessibilityStatus, 'success' | 'danger' | 'warning' | 'neutral'> = {
  Accessible: 'success', Inaccessible: 'danger', Intermittent: 'warning', 'Not Checked': 'neutral',
};

export function AccessibilityBadge({ value }: { value: DomainAccessibilityStatus }) {
  return <Badge tone={ACCESSIBILITY_TONE[value]}>{value}</Badge>;
}

const ACTIVATION_TONE: Record<DomainActivationStatus, 'success' | 'info' | 'neutral' | 'danger'> = {
  Active: 'success', Standby: 'info', Disabled: 'neutral', Archived: 'danger',
};

export function ActivationStatusBadge({ value }: { value: DomainActivationStatus | null }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return <Badge tone={ACTIVATION_TONE[value]}>{value}</Badge>;
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

const DAILY_CHECK_LABEL: Record<DailyCheckBucket, string> = {
  'checked-today': 'Checked Today', 'pending-today': 'Pending Today', overdue: 'Overdue',
};
const DAILY_CHECK_TONE: Record<DailyCheckBucket, 'success' | 'warning' | 'danger'> = {
  'checked-today': 'success', 'pending-today': 'warning', overdue: 'danger',
};

export function DailyCheckBadge({ lastCheckedDate }: { lastCheckedDate: string | null }) {
  const bucket = dailyCheckBucket(lastCheckedDate);
  return <Badge tone={DAILY_CHECK_TONE[bucket]}>{DAILY_CHECK_LABEL[bucket]}</Badge>;
}
