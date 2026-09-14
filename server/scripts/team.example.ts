/** Template for the private team list.
 *
 *  Copy to `team.local.ts` (git-ignored) and replace the placeholders with the real
 *  team. Never commit real names or email addresses: they are login identities. */

import type { TeamList } from './team';

export const TEAM: TeamList['TEAM'] = [
  { name: 'Alex', title: 'Team Lead', role: 'System Administrator', email: 'admin@example.com' },
  { name: 'Sam', title: 'Marketing Manager', role: 'Marketing Manager', email: 'manager@example.com' },
  { name: 'Jordan', title: 'Marketing Agent', role: 'Marketing Staff', email: 'staff@example.com' },
];

/** People to add once their address arrives. */
export const AWAITING_EMAIL: TeamList['AWAITING_EMAIL'] = [];
