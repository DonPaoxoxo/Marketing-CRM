/** Create the marketing team's accounts and their one-time invite links.
 *
 *  No password is ever generated here. Each account is created without one, plus
 *  an invite token whose SHA-256 is all the database keeps. Each person follows
 *  their link and sets their own.
 *
 *  The links are written to a gitignored file, never printed: twelve live invite
 *  links echoed into a terminal is twelve account takeovers waiting in somebody's
 *  scrollback.
 *
 *  Usage:
 *    npm run seed:users                 # reads server/scripts/team.local.ts (git-ignored)
 *    npm run seed:users -- --csv people.csv   # name,title,role,email
 *
 *  Safe to re-run: an existing email is skipped, not duplicated or overwritten.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { closePool, execute, queryOne, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { issueToken } from '../auth/credentials';
import { recordAudit } from '../audit';
import { env } from '../env';
import { ROLES, type RoleName } from '../../src/lib/types';
import { sanitizeText, FIELD_LIMITS } from '../../src/lib/sanitize';
import { loadTeam, type TeamMemberSeed } from './team';

const OUTPUT_FILE = path.resolve('invites.local.txt');

async function loadPeople(): Promise<TeamMemberSeed[]> {
  const csvFlag = process.argv.indexOf('--csv');
  if (csvFlag === -1) return (await loadTeam()).TEAM;

  const file = process.argv[csvFlag + 1];
  if (!file) throw new Error('--csv needs a file path.');

  const text = await readFile(file, 'utf8');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines[0].toLowerCase();
  const rows = header.includes('email') ? lines.slice(1) : lines;

  return rows.map((line, i) => {
    const [name, title, role, email] = line.split(',').map((c) => c.trim());
    if (!ROLES.includes(role as RoleName)) {
      throw new Error(`Row ${i + 1}: "${role}" is not a role. Use one of: ${ROLES.join(', ')}`);
    }
    return { name, title: title ?? '', role: role as RoleName, email: (email ?? '').toLowerCase() };
  });
}

async function main(): Promise<void> {
  const people = await loadPeople();

  const missingEmail = people.filter((p) => !p.email);
  if (missingEmail.length) {
    console.error(`\nNo email address for: ${missingEmail.map((p) => p.name).join(', ')}`);
    console.error('Login and the invite link both key off the address, so nothing was created.');
    console.error('Fill them into server/scripts/team.local.ts, or pass --csv with a name,title,role,email file.\n');
    process.exit(1);
  }

  const duplicates = people
    .map((p) => p.email)
    .filter((e, i, all) => all.indexOf(e) !== i);
  if (duplicates.length) {
    console.error(`\nThe same address appears twice: ${[...new Set(duplicates)].join(', ')}\n`);
    process.exit(1);
  }

  if (!people.some((p) => p.role === 'System Administrator')) {
    console.error('\nNobody in the list is a System Administrator, so no one could manage');
    console.error('credential references, archive records or create further accounts.\n');
    process.exit(1);
  }

  const created: { name: string; email: string; role: RoleName; link: string; expires: Date }[] = [];
  const skipped: string[] = [];

  for (const person of people) {
    const existing = await queryOne<RowDataPacket>('SELECT id FROM users WHERE email = ?', [person.email]);
    if (existing) {
      skipped.push(`${person.name} <${person.email}> — already exists as ${existing.id}`);
      continue;
    }

    const { token, hash } = issueToken();
    const expires = new Date(Date.now() + env.INVITE_TTL_HOURS * 3_600_000);
    const now = new Date();

    const id = await tx(async (conn) => {
      const newId = await nextId('TM', conn);
      await execute(
        `INSERT INTO users (id, email, name, title, role, active, invite_token_hash,
                            invite_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        [
          newId,
          person.email,
          sanitizeText(person.name, FIELD_LIMITS.short),
          sanitizeText(person.title, FIELD_LIMITS.short),
          person.role,
          hash,
          expires,
          now,
          now,
        ],
        conn,
      );
      await recordAudit(conn, {
        // Seeding predates any signed-in administrator, so the actor is the
        // script itself rather than a person who was not there.
        actor: { id: newId, name: 'Account seeding script', role: 'System Administrator' },
        recordType: 'User',
        recordId: newId,
        recordLabel: person.name,
        action: 'create',
        reason: `Seeded as ${person.role} and invited`,
        changes: [{ field: 'role', from: null, to: person.role }],
      });
      return newId;
    });

    created.push({ name: person.name, email: person.email, role: person.role, link: inviteLink(token), expires });
    console.log(`  created ${id}  ${person.name.padEnd(8)} ${person.role}`);
  }

  if (created.length) {
    await writeFile(OUTPUT_FILE, renderInvites(created), { encoding: 'utf8', mode: 0o600 });
  }

  console.log(`\n${created.length} account(s) created, ${skipped.length} skipped.`);
  skipped.forEach((s) => console.log(`  skipped ${s}`));

  const { AWAITING_EMAIL } = process.argv.includes('--csv') ? { AWAITING_EMAIL: [] as { name: string }[] } : await loadTeam();
  if (AWAITING_EMAIL.length) {
    console.log(`\nStill without an address, so not created: ${AWAITING_EMAIL.map((p) => p.name).join(', ')}.`);
    console.log('Add them in the app (Roles and audit → Team and access), or add them to');
    console.log('TEAM in server/scripts/team.local.ts and re-run — the seed skips existing accounts.');
  }

  if (created.length) {
    console.log(`\nInvite links written to ${OUTPUT_FILE}`);
    console.log('They are not printed here on purpose — an invite link is a credential.');
    console.log(`Each expires in ${env.INVITE_TTL_HOURS} hours. Send each person their own,`);
    console.log('then delete the file. A lapsed or lost link can be replaced from');
    console.log('Roles and audit → Team and access.');
  }
}

function inviteLink(token: string): string {
  return `${env.APP_ORIGIN.replace(/\/$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;
}

function renderInvites(rows: { name: string; email: string; role: RoleName; link: string; expires: Date }[]): string {
  const header = [
    'Marketing Resource CRM — one-time invite links',
    `Generated ${new Date().toISOString()}`,
    '',
    'Each link sets that person\'s password and can be used once. Treat them like',
    'passwords: send each person only their own, over a channel you trust, and',
    'delete this file afterwards. They expire on the date shown.',
    '',
    ''.padEnd(72, '-'),
    '',
  ].join('\n');

  const body = rows
    .map((r) => [
      `${r.name}  (${r.role})`,
      `  ${r.email}`,
      `  expires ${r.expires.toISOString()}`,
      `  ${r.link}`,
      '',
    ].join('\n'))
    .join('\n');

  return `${header}${body}`;
}

main()
  .then(closePool)
  .catch(async (error: Error) => {
    console.error(`\nFailed: ${error.message}`);
    await closePool();
    process.exit(1);
  });
