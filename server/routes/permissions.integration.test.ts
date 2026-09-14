/** Live permissions against a real MariaDB database. Skipped unless ADS_IT=1 and
 *  ADS_IT_CONFIRM_DB repeats DB_NAME (see server/routes/ads/ads.integration.test.ts). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

const RUN = process.env.ADS_IT === '1' && Boolean(process.env.DB_NAME) && process.env.ADS_IT_CONFIRM_DB === process.env.DB_NAME;

describe.skipIf(!RUN)('editable permissions (real database)', () => {
  let server: Server;
  let base = '';
  const cookies: Record<string, string> = {};
  const users = {
    owner: ['TM-9101', 'System Administrator'],
    staff: ['TM-9102', 'Marketing Staff'],
    manager: ['TM-9103', 'Marketing Manager'],
  } as const;
  let db: typeof import('../db/pool');

  beforeAll(async () => {
    db = await import('../db/pool');
    const { issueToken } = await import('../auth/credentials');
    const { createApp } = await import('../app');
    await db.execute("DELETE FROM user_permissions WHERE user_id LIKE 'TM-91%'");
    await db.execute("DELETE FROM role_permissions WHERE role = 'Marketing Staff'");
    for (const p of ['view:contact-details', 'edit:resources', 'import:records', 'request:credential-access', 'archive:records']) {
      await db.execute("INSERT INTO role_permissions (role, permission) VALUES ('Marketing Staff', ?)", [p]);
    }
    for (const [key, [id, role]] of Object.entries(users)) {
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
      await db.execute('DELETE FROM audit_changes WHERE audit_id IN (SELECT id FROM audit_entries WHERE actor_id = ?)', [id]);
      await db.execute('DELETE FROM audit_entries WHERE actor_id = ?', [id]);
      await db.execute('DELETE FROM users WHERE id = ?', [id]);
      await db.execute('INSERT INTO users (id, email, name, role, active) VALUES (?, ?, ?, ?, 1)', [id, `${key}@perm-it.example`, key, role]);
      const { token, hash } = issueToken();
      await db.execute(
        'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, NOW(), NOW(), ?, ?, ?)',
        [hash, id, new Date(Date.now() + 3_600_000), '127.0.0.1', 'perm-it'],
      );
      cookies[key] = `mrcrm_session=${token}`;
    }
    const app = createApp({ staticDir: null });
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;
  });

  afterAll(async () => {
    server?.close();
    await db?.closePool();
  });

  const call = async (who: keyof typeof users, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Cookie: cookies[who], 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) } as { status: number; body: any };
  };

  it('sends each person their live permissions, with staff archiving by default', async () => {
    const me = await call('staff', 'GET', '/auth/me');
    expect(me.body.user.permissions).toContain('archive:records');
    expect(me.body.user.permissions).not.toContain('access:domains');
    expect((await call('owner', 'GET', '/auth/me')).body.user.permissions).toContain('manage:users');
  });

  it('opens and closes a page for a role immediately, and only the System Administrator can change it', async () => {
    expect((await call('staff', 'POST', '/domains', {})).status).toBe(403);
    expect((await call('manager', 'PUT', '/permissions/roles/Marketing%20Staff', { permissions: ['access:domains'] })).status).toBe(403);

    const grant = await call('owner', 'PUT', '/permissions/roles/Marketing%20Staff', {
      permissions: ['view:contact-details', 'edit:resources', 'archive:records', 'access:domains', 'manage:users'],
      reason: 'Staff now manage domains',
    });
    expect(grant.status).toBe(200);
    expect(grant.body.roles['Marketing Staff']).not.toContain('manage:users');
    // Past the permission gate: the domain route's own validation answers now.
    expect((await call('staff', 'POST', '/domains', {})).status).toBe(400);

    await call('owner', 'PUT', '/permissions/roles/Marketing%20Staff', { permissions: ['edit:resources'], reason: 'Back to basics for staff' });
    expect((await call('staff', 'POST', '/domains', {})).status).toBe(403);
    expect((await call('staff', 'GET', '/auth/me')).body.user.permissions).toEqual(['edit:resources']);
  });

  it('grants one person an extra permission without changing their role, and audits it', async () => {
    expect((await call('manager', 'POST', '/domains', {})).status).toBe(403);
    const r = await call('owner', 'PUT', `/permissions/users/${users.manager[0]}`, { permissions: ['access:domains'], reason: 'Remco covers domains this month' });
    expect(r.body.users[users.manager[0]]).toEqual(['access:domains']);
    expect((await call('manager', 'POST', '/domains', {})).status).toBe(400);
    expect((await call('staff', 'POST', '/domains', {})).status).toBe(403);
    const [audit] = await db.query<any>(
      'SELECT e.record_type, e.reason, c.field, c.value_to FROM audit_entries e JOIN audit_changes c ON c.audit_id = e.id WHERE e.record_id = ? ORDER BY e.occurred_at DESC LIMIT 1',
      [users.manager[0]],
    );
    expect(audit).toMatchObject({ record_type: 'User', reason: 'Remco covers domains this month', field: 'access:domains', value_to: 'granted' });
    expect((await call('owner', 'PUT', `/permissions/users/${users.owner[0]}`, { permissions: ['export:data'] })).status).toBe(400);
  });
});
