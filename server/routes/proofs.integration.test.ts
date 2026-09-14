/** Proof verdict and payment against a real MariaDB database. Skipped unless ADS_IT=1 and
 *  ADS_IT_CONFIRM_DB repeats DB_NAME (see server/routes/ads/ads.integration.test.ts). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

const RUN = process.env.ADS_IT === '1' && Boolean(process.env.DB_NAME) && process.env.ADS_IT_CONFIRM_DB === process.env.DB_NAME;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString('base64');

describe.skipIf(!RUN)('proof verdict and payment (real database)', () => {
  let server: Server;
  let base = '';
  const cookies: Record<string, string> = {};
  const users = {
    owner: ['TM-9201', 'System Administrator'],
    manager: ['TM-9202', 'Marketing Manager'],
    staff: ['TM-9203', 'Marketing Staff'],
  } as const;
  const AGENT = 'AGT-9201';
  let db: typeof import('../db/pool');

  beforeAll(async () => {
    db = await import('../db/pool');
    const { issueToken } = await import('../auth/credentials');
    const { createApp } = await import('../app');
    await db.execute('DELETE FROM agent_proofs WHERE agent_id = ?', [AGENT]);
    await db.execute('DELETE FROM audit_changes WHERE audit_id IN (SELECT id FROM audit_entries WHERE record_id = ?)', [AGENT]);
    await db.execute('DELETE FROM audit_entries WHERE record_id = ?', [AGENT]);
    await db.execute('DELETE FROM agents WHERE id = ?', [AGENT]);
    // Other suites edit the Marketing Staff role; start from its shipped defaults.
    await db.execute("DELETE FROM role_permissions WHERE role = 'Marketing Staff'");
    for (const p of ['view:contact-details', 'edit:resources', 'import:records', 'request:credential-access', 'archive:records']) {
      await db.execute("INSERT INTO role_permissions (role, permission) VALUES ('Marketing Staff', ?)", [p]);
    }
    for (const [key, [id, role]] of Object.entries(users)) {
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [id]);
      await db.execute('DELETE FROM audit_changes WHERE audit_id IN (SELECT id FROM audit_entries WHERE actor_id = ?)', [id]);
      await db.execute('DELETE FROM audit_entries WHERE actor_id = ?', [id]);
      await db.execute('DELETE FROM users WHERE id = ?', [id]);
      await db.execute('INSERT INTO users (id, email, name, role, active) VALUES (?, ?, ?, ?, 1)', [id, `${key}@proof-it.example`, key, role]);
      const { token, hash } = issueToken();
      await db.execute(
        'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, NOW(), NOW(), ?, ?, ?)',
        [hash, id, new Date(Date.now() + 3_600_000), '127.0.0.1', 'proof-it'],
      );
      cookies[key] = `mrcrm_session=${token}`;
    }
    await db.execute(
      `INSERT INTO agents (id, name, agent_type, preferred_channel, manager_id, cooperation_status, notes, created_at, updated_at)
       VALUES (?, 'Proof IT agent', 'Individual', 'Telegram', ?, 'Active', '', NOW(3), NOW(3))`,
      [AGENT, users.manager[0]],
    );
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

  it('stores verdict and payment, refuses the manager, and audits each change', async () => {
    const up = await call('manager', 'POST', `/agents/${AGENT}/proofs`, { postUrl: 'https://t.me/proofit/1', image: PNG });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ verdict: null, payment: 'Not paid', paidAt: null });
    const id = up.body.id as string;

    expect((await call('manager', 'PATCH', `/agent-proofs/${id}/review`, { payment: 'Paid' })).status).toBe(403);
    expect((await call('owner', 'PATCH', `/agent-proofs/${id}/review`, { verdict: 'Rejected' })).status).toBe(400);

    const rejected = await call('owner', 'PATCH', `/agent-proofs/${id}/review`, { verdict: 'Rejected', reason: 'Screenshot does not match' });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toMatchObject({ verdict: 'Rejected', verdictReason: 'Screenshot does not match', reviewedByName: 'owner' });

    const paid = await call('owner', 'PATCH', `/agent-proofs/${id}/review`, { verdict: 'Accepted', payment: 'Paid' });
    expect(paid.body).toMatchObject({ verdict: 'Accepted', verdictReason: '', payment: 'Paid', paidByName: 'owner' });
    expect(paid.body.paidAt).toMatch(/^\d{4}-/);

    const boot = await call('manager', 'GET', '/bootstrap');
    expect(boot.body.agentProofs.find((p: any) => p.id === id)).toMatchObject({ verdict: 'Accepted', payment: 'Paid' });

    const changes = await db.query<any>(
      `SELECT c.field, c.value_from, c.value_to FROM audit_entries e JOIN audit_changes c ON c.audit_id = e.id
       WHERE e.record_id = ? AND c.field IN ('proofVerdict', 'proofPayment') ORDER BY e.occurred_at, c.field`,
      [AGENT],
    );
    expect(changes).toEqual([
      { field: 'proofVerdict', value_from: null, value_to: 'Rejected' },
      { field: 'proofPayment', value_from: 'Not paid', value_to: 'Paid' },
      { field: 'proofVerdict', value_from: 'Rejected', value_to: 'Accepted' },
    ]);
  });

  it('lets any member who may archive archive and restore an agent they do not manage, but not edit it', async () => {
    expect((await call('staff', 'PATCH', `/agents/${AGENT}`, { notes: 'edited by staff' })).status).toBe(403);
    expect((await call('staff', 'PATCH', `/agents/${AGENT}`, { archived: true, notes: 'sneaky', reason: 'Stopped working with us' })).status).toBe(403);
    expect((await call('staff', 'PATCH', `/agents/${AGENT}`, { archived: true })).status).toBe(400);
    const archived = await call('staff', 'PATCH', `/agents/${AGENT}`, { archived: true, reason: 'Stopped working with us' });
    expect(archived).toMatchObject({ status: 200, body: { archived: true, notes: '' } });
    const [entry] = await db.query<any>("SELECT action, actor_id, reason FROM audit_entries WHERE record_id = ? AND action = 'archive' ORDER BY occurred_at DESC LIMIT 1", [AGENT]);
    expect(entry).toMatchObject({ action: 'archive', actor_id: users.staff[0], reason: 'Stopped working with us' });
    const restored = await call('staff', 'PATCH', `/agents/${AGENT}`, { archived: false, reason: 'Back with us again' });
    expect(restored).toMatchObject({ status: 200, body: { archived: false } });
  });

  it('stores the salary status, set only by the System Administrator, and keeps it out of ordinary edits', async () => {
    expect((await call('manager', 'PATCH', `/agents/${AGENT}/salary`, { status: 'Hold' })).status).toBe(403);
    expect((await call('staff', 'PATCH', `/agents/${AGENT}/salary`, { status: 'Advance' })).status).toBe(403);
    expect((await call('manager', 'PATCH', `/agents/${AGENT}`, { notes: 'manager edit', salaryStatus: 'Advance' })).body.salaryStatus).toBeNull();
    expect((await call('owner', 'PATCH', `/agents/${AGENT}/salary`, { status: 'Customize' })).status).toBe(400);
    const set = await call('owner', 'PATCH', `/agents/${AGENT}/salary`, { status: 'Customize', note: 'Half paid, rest Friday' });
    expect(set.body).toMatchObject({ salaryStatus: 'Customize', salaryNote: 'Half paid, rest Friday', salaryUpdatedByName: 'owner' });
    expect(set.body.salaryUpdatedAt).toMatch(/^\d{4}-/);
    const boot = await call('staff', 'GET', '/bootstrap');
    expect(boot.body.agents.find((a: any) => a.id === AGENT)).toMatchObject({ salaryStatus: 'Customize', salaryNote: 'Half paid, rest Friday' });
    const [entry] = await db.query<any>("SELECT e.reason, c.value_from, c.value_to FROM audit_entries e JOIN audit_changes c ON c.audit_id = e.id WHERE e.record_id = ? AND c.field = 'salaryStatus' ORDER BY e.occurred_at DESC LIMIT 1", [AGENT]);
    expect(entry).toMatchObject({ reason: 'Salary status set to Half paid, rest Friday', value_from: null, value_to: 'Half paid, rest Friday' });
  });
});
