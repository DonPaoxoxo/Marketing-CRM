/** The marketing team to create accounts for.
 *
 *  The real list is private and never committed: it lives in `team.local.ts`
 *  (git-ignored). Start from `team.example.ts`:
 *
 *    cp server/scripts/team.example.ts server/scripts/team.local.ts
 *
 *  or skip the file entirely with `npm run seed:users -- --csv people.csv`.
 *
 *  Note that "Marketing Agent" is a job title for an employee — these people belong
 *  in the users/team register, NOT in the Agent register, which is for external
 *  agents and agencies and deliberately never grants a login.
 *
 *  Whoever controls one of these inboxes controls the CRM account it belongs to,
 *  since that is where the invite and any future reset link lands. That matters
 *  most for the System Administrator. */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { RoleName } from '../../src/lib/types';

export interface TeamMemberSeed {
  name: string;
  title: string;
  role: RoleName;
  /** Stored lowercase: login and `users.email` are case-insensitive. */
  email: string;
}

export interface TeamList {
  TEAM: TeamMemberSeed[];
  /** People still waiting on an address; the seed reports them and carries on. */
  AWAITING_EMAIL: Omit<TeamMemberSeed, 'email'>[];
}

const LOCAL = new URL('./team.local.ts', import.meta.url);

/** The private team list, or a clear instruction when it has not been created. */
export async function loadTeam(): Promise<TeamList> {
  if (!existsSync(fileURLToPath(LOCAL))) {
    throw new Error(
      'No team list. Copy server/scripts/team.example.ts to server/scripts/team.local.ts and fill in the real names and '
      + 'emails (that file is git-ignored), or run: npm run seed:users -- --csv people.csv',
    );
  }
  // A variable URL keeps the private file out of type-checking and out of CI.
  const mod = (await import(LOCAL.href)) as Partial<TeamList>;
  return { TEAM: mod.TEAM ?? [], AWAITING_EMAIL: mod.AWAITING_EMAIL ?? [] };
}
