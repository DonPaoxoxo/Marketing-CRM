import { daysSince } from '@/lib/utils';
import type { DomainAccessibilityStatus } from '@/lib/types';

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
