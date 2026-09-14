/** What the API does before it reaches the database.
 *
 *  Every request here arrives without a session cookie, and `readSession`
 *  answers on the cookie alone — so none of these touch MySQL. That is what
 *  makes it worth testing here: the guard has to hold for a caller who never
 *  gets as far as a query. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

let app: Express;
const saved = { ...process.env };

beforeAll(async () => {
  // The config module validates at import and exits the process if a key is
  // missing, so these are set before the app is loaded. Values are placeholders:
  // nothing in this file opens a connection.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_NAME: 'test',
    DB_USER: 'test',
    DB_PASSWORD: 'test',
    SESSION_SECRET: 'x'.repeat(48),
  });
  app = (await import('./app')).createApp();
});

afterAll(() => {
  process.env = saved;
});

/** A request against the app without binding a port. */
async function call(method: string, path: string): Promise<{ status: number; body: unknown }> {
  const { createServer } = await import('node:http');
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

/** Every route the browser app calls. If one is not mounted it answers 404
 *  here, which is how this catches a router that was written but never wired. */
const ROUTES: [string, string][] = [
  ['GET', '/api/bootstrap'],
  ['POST', '/api/sims'],
  ['PATCH', '/api/sims/SIM-0001'],
  ['POST', '/api/agents'],
  ['PATCH', '/api/agents/AGT-001'],
  ['POST', '/api/social-accounts'],
  ['PATCH', '/api/social-accounts/ACC-0001'],
  ['POST', '/api/domains'],
  ['PATCH', '/api/domains/DOM-0001'],
  ['POST', '/api/assignments'],
  ['PATCH', '/api/assignments/ASG-0001'],
  ['PATCH', '/api/credentials/CRD-0001'],
  ['POST', '/api/follower-snapshots/bulk'],
  ['POST', '/api/content-posts'],
  ['PATCH', '/api/content-posts/CNT-0001'],
  ['POST', '/api/import/sims'],
  ['POST', '/api/audit'],
  ['GET', '/api/users'],
];

describe('the API without a session', () => {
  it.each(ROUTES)('%s %s answers 401, not 404', async (method, path) => {
    const { status, body } = await call(method, path);
    expect(status).toBe(401);
    expect(body).toMatchObject({ message: expect.any(String) });
  });

  it('answers 404 for an endpoint that does not exist', async () => {
    const { status } = await call('GET', '/api/nope');
    expect(status).toBe(404);
  });

  it('never says whether the record exists', async () => {
    // A 404 here would tell an unauthenticated caller which ids are real.
    const { status } = await call('PATCH', '/api/sims/definitely-not-a-record');
    expect(status).toBe(401);
  });
});
