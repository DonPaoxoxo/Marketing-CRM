/** The API as it behaves on the live site.
 *
 *  Separate from `app.test.ts` because the config module is read once at import:
 *  production-only behaviour — a trimmed health check, the built app served from
 *  the same origin — needs `NODE_ENV=production` before the app is loaded. None of
 *  these requests reach the database. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const saved = { ...process.env };
const dist = mkdtempSync(path.join(tmpdir(), 'mrcrm-dist-'));
let server: Server;
let base = '';

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'production',
    // Nothing listens here, so the health check fails — which is the case whose
    // response most needs to stay quiet.
    DB_HOST: '127.0.0.1', DB_PORT: '1', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test',
    SESSION_SECRET: 'x'.repeat(48),
  });

  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>shell</title>');
  writeFileSync(path.join(dist, 'mockServiceWorker.js'), '// mock');
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'assets', 'app-abc123.js'), 'console.log(1)');

  const { createApp } = await import('./app');
  server = createServer(createApp({ staticDir: dist }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server?.close();
  rmSync(dist, { recursive: true, force: true });
  process.env = saved;
});

const get = (p: string, accept = 'text/html') => fetch(base + p, { headers: { Accept: accept } });

describe('production', () => {
  it('asks crawlers not to index anything, pages and API alike', async () => {
    for (const p of ['/', '/api/bootstrap', '/assets/app-abc123.js']) {
      expect((await get(p)).headers.get('x-robots-tag')).toContain('noindex');
    }
  });

  it('keeps a failing health check from describing the database', async () => {
    const res = await get('/api/health', 'application/json');
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ ok: false, message: 'Database unreachable.' });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|test/);
  });

  it('serves the app shell for a client-side route, uncached', async () => {
    const res = await get('/sims/SIM-0001');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('shell');
    expect(res.headers.get('cache-control')).toBe('no-cache');
  });

  it('caches hashed assets for a long time', async () => {
    const res = await get('/assets/app-abc123.js', '*/*');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('answers a missing asset with 404, not the app shell', async () => {
    // A script tag sends Accept: */*, which would otherwise match the HTML
    // fallback and hand the browser a page to execute as JavaScript.
    const res = await get('/assets/gone-999.js', '*/*');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('shell');
  });

  it('keeps unknown API paths as JSON 404s, never the app shell', async () => {
    const res = await get('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'No such endpoint.' });
  });

  it('does not serve the mock worker', async () => {
    expect((await get('/mockServiceWorker.js', '*/*')).status).toBe(404);
  });

  it('forbids any cache from storing an API response', async () => {
    // Cloudflare sits in front of the live site; a signed-in workspace must never
    // be kept and replayed to someone else.
    for (const p of ['/api/bootstrap', '/api/health', '/api/nope']) {
      expect((await get(p, 'application/json')).headers.get('cache-control')).toBe('no-store');
    }
  });

  it('still requires a session for data', async () => {
    expect((await get('/api/bootstrap', 'application/json')).status).toBe(401);
  });
});
