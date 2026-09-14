/** Salary status on an agent: Hold, Advance, or Customize with a typed-in status.
 *  One rule for the browser, the mock API and the server. Only the System
 *  Administrator sets it; everyone who can see the agent can read it. */

import { isAdmin } from './access';
import { sanitizeText } from './sanitize';
import type { Agent, RoleName } from './types';

export const SALARY_STATUSES = ['Hold', 'Advance', 'Customize'] as const;
export type SalaryStatus = (typeof SALARY_STATUSES)[number];
export const SALARY_NOTE_MAX = 80;

export const maySetSalaryStatus = (role: RoleName | undefined | null) => isAdmin(role);

/** What to show: the chosen status, or the typed-in text for Customize. */
export function salaryLabel(agent: Pick<Agent, 'salaryStatus' | 'salaryNote'>): string {
  if (!agent.salaryStatus) return 'Not set';
  return agent.salaryStatus === 'Customize' ? agent.salaryNote || 'Customize' : agent.salaryStatus;
}

/** A request to set (or clear, with `status: null`) the salary status. */
export function checkSalaryStatus(raw: { status?: unknown; note?: unknown }):
  { status: SalaryStatus | null; note: string } | { error: string; field: 'status' | 'note' } {
  if (raw.status === null || raw.status === '') return { status: null, note: '' };
  if (!SALARY_STATUSES.includes(raw.status as SalaryStatus)) return { error: 'Choose Hold, Advance or Customize.', field: 'status' };
  const status = raw.status as SalaryStatus;
  if (status !== 'Customize') return { status, note: '' };
  if (typeof raw.note === 'string' && raw.note.trim().length > SALARY_NOTE_MAX) {
    return { error: `Keep the custom status under ${SALARY_NOTE_MAX} characters.`, field: 'note' };
  }
  const note = sanitizeText(raw.note, SALARY_NOTE_MAX);
  if (note.length < 2) return { error: 'Type the custom salary status (for example "50% paid, rest on Friday").', field: 'note' };
  return { status, note };
}
