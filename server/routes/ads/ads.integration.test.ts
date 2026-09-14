/** Ads Monitoring against a real MariaDB database.
 *
 *  Skipped unless ADS_IT=1, because the ordinary suite has no database. Run it
 *  against a throwaway, migrated database with the configuration seeded:
 *
 *    ADS_IT=1 ADS_IT_CONFIRM_DB=<scratch db> DB_NAME=<scratch db> DB_USER=… DB_PASSWORD=… SESSION_SECRET=… npx vitest run server/routes/ads
 *
 *  Signs people in the way the app does — a session row and its cookie — so every
 *  request goes through the real session check, routes and database constraints. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';

// It deletes every ads_* row first, so it also needs the database name repeated
// in ADS_IT_CONFIRM_DB — a guard against running it with the live .env loaded.
const RUN = process.env.ADS_IT === '1' && Boolean(process.env.DB_NAME) && process.env.ADS_IT_CONFIRM_DB === process.env.DB_NAME;

describe.skipIf(!RUN)('Ads Monitoring (real database)', () => {
  let server: Server;
  let base = '';
  const cookies: Record<string, string> = {};
  const users = {
    owner: { id: 'TM-9001', name: 'Owner Ana', role: 'System Administrator' },
    creator: { id: 'TM-9002', name: 'Creator Gordon', role: 'Marketing Staff' },
    other: { id: 'TM-9003', name: 'Other Bea', role: 'Marketing Staff' },
    manager: { id: 'TM-9004', name: 'Manager Remco', role: 'Marketing Manager' },
  } as const;
  type Who = keyof typeof users | 'nobody';
  let db: typeof import('../../db/pool');

  beforeAll(async () => {
    db = await import('../../db/pool');
    const { issueToken } = await import('../../auth/credentials');
    const { createApp } = await import('../../app');
    for (const table of ['ads_file_chunks', 'ads_import_history', 'ads_followups', 'ads_references', 'ads_creatives', 'ads_daily_records', 'ads_campaign_status_log', 'ads_campaigns']) {
      await db.execute(`DELETE FROM ${table}`);
    }
    await db.getPool().query('DROP TRIGGER IF EXISTS ads_it_fail');
    for (const [key, u] of Object.entries(users)) {
      await db.execute('DELETE FROM sessions WHERE user_id = ?', [u.id]);
      await db.execute('DELETE FROM audit_changes WHERE audit_id IN (SELECT id FROM audit_entries WHERE actor_id = ?)', [u.id]);
      await db.execute('DELETE FROM audit_entries WHERE actor_id = ?', [u.id]);
      await db.execute('DELETE FROM users WHERE id = ?', [u.id]);
      await db.execute('INSERT INTO users (id, email, name, role, active) VALUES (?, ?, ?, ?, 1)', [u.id, `${key}@ads-it.example`, u.name, u.role]);
      const { token, hash } = issueToken();
      const now = new Date();
      await db.execute('INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [hash, u.id, now, now, new Date(Date.now() + 3_600_000), '127.0.0.1', 'ads-it']);
      cookies[key] = `mrcrm_session=${token}`;
    }
    const app = createApp({ staticDir: null });
    await new Promise<void>((resolve) => { server = app.listen(0, '127.0.0.1', () => resolve()); });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/ads`;
  });

  afterAll(async () => {
    server?.close();
    await db?.getPool().query('DROP TRIGGER IF EXISTS ads_it_fail');
    await db?.closePool();
  });

  async function call(who: Who, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const isBytes = body instanceof Uint8Array;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(who === 'nobody' ? {} : { Cookie: cookies[who] }),
        ...(body === undefined ? {} : { 'Content-Type': isBytes ? 'application/octet-stream' : 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : isBytes ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
    });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer()) } as { status: number; headers: Headers; body: any };
  }

  const campaignBody = (reference: string, extra: Record<string, unknown> = {}) => ({
    reference, name: `Campaign ${reference}`, platformId: 'PLT-01', targetCountryCode: 'PH', objective: 'Traffic', currency: 'PHP',
    budget: '30000', startDate: '2026-08-29', endDate: '2026-09-27', status: 'Active', adsUrl: 'https://www.facebook.com/ads/library/?id=1', ...extra,
  });

  const png = (w: number, h: number, size: number) => {
    const b = new Uint8Array(size);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };

  let campaignId = '';

  it('refuses everyone who is not signed in', async () => {
    expect((await call('nobody', 'GET', '/campaigns')).status).toBe(401);
    expect((await call('nobody', 'GET', '/creatives/ADK-0001/file')).status).toBe(401);
  });

  it('records the creator from the session, never from the request', async () => {
    const r = await call('creator', 'POST', '/campaigns', { ...campaignBody('IT-PH-001', { assignedStaffId: users.manager.id }), createdById: users.other.id });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ createdById: users.creator.id, assignedStaffId: users.manager.id, currency: 'PHP' });
    campaignId = r.body.id;
    expect((await call('other', 'POST', '/campaigns', campaignBody('IT-PH-001'))).status).toBe(409);
  });

  it('lets only the creator and the System Owner edit — not other staff, not the assigned manager', async () => {
    expect((await call('other', 'GET', `/campaigns/${campaignId}`)).body).toMatchObject({ canEdit: false });
    expect((await call('other', 'PATCH', `/campaigns/${campaignId}`, { name: 'Hijack' })).status).toBe(403);
    expect((await call('manager', 'PATCH', `/campaigns/${campaignId}`, { name: 'Assigned manager edit' })).status).toBe(403);
    expect((await call('owner', 'PATCH', `/campaigns/${campaignId}`, { name: 'Owner edit' })).status).toBe(200);
    const mine = await call('creator', 'PATCH', `/campaigns/${campaignId}`, { name: 'Creator edit', createdById: users.other.id });
    expect(mine.body).toMatchObject({ name: 'Creator edit', createdById: users.creator.id });
    expect((await call('creator', 'PATCH', `/campaigns/${campaignId}`, { reference: 'NEW-REF' })).status).toBe(400);
  });

  it('keeps one daily record per date, and child ownership separate from the campaign', async () => {
    const day = { reportDate: '2026-08-29', amountSpent: '246.58', reach: 1749, impressions: 2602, linkClicks: 331, landingPageViews: 27 };
    expect((await call('creator', 'POST', `/campaigns/${campaignId}/records`, day)).status).toBe(201);
    expect((await call('creator', 'POST', `/campaigns/${campaignId}/records`, day)).status).toBe(409);
    expect((await call('other', 'POST', `/campaigns/${campaignId}/records`, { ...day, reportDate: '2026-08-30' })).status).toBe(403);
    const ownerRecord = await call('owner', 'POST', `/campaigns/${campaignId}/records`, { ...day, reportDate: '2026-08-30', amountSpent: '1147.64' });
    expect(ownerRecord.status).toBe(201);
    // The campaign's creator cannot change a record the System Owner entered.
    expect((await call('creator', 'PATCH', `/records/${ownerRecord.body.record.id}`, { reach: 1 })).status).toBe(403);
    expect((await call('other', 'DELETE', `/records/${ownerRecord.body.record.id}`, { reason: 'nope' })).status).toBe(403);
    const cleared = await call('owner', 'PATCH', `/records/${ownerRecord.body.record.id}`, { landingPageViews: null });
    expect(cleared.body.record.landingPageViews).toBeNull();
    expect((await call('creator', 'PATCH', `/records/${ownerRecord.body.record.id}`, { reach: 5 })).status).toBe(403);
  });

  it('blocks a currency change once records exist', async () => {
    const r = await call('creator', 'PATCH', `/campaigns/${campaignId}`, { currency: 'USD' });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe('currency');
  });

  it('accepts only exact 1080 × 1350 creatives up to 1,000,000 bytes, and guards the files', async () => {
    const upload = (who: Who, bytes: Uint8Array, name = 'ad.png') =>
      call(who, 'POST', `/campaigns/${campaignId}/creatives`, bytes, { 'X-File-Name': name, 'X-Ads-Url': 'https://www.facebook.com/ads/library/?id=42' });
    const ok = await upload('creator', png(1080, 1350, 1_000_000));
    expect(ok.status).toBe(201);
    const tooBig = await upload('creator', png(1080, 1350, 1_000_001));
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.message).toContain('1,000,001 bytes');
    const wrong = await upload('creator', png(1080, 1080, 5000));
    expect(wrong.status).toBe(400);
    expect(wrong.body.message).toContain('1080 × 1080 pixels');
    expect((await upload('other', png(1080, 1350, 5000))).status).toBe(403);
    expect((await call('creator', 'POST', `/campaigns/${campaignId}/creatives`, png(1080, 1350, 500), { 'X-File-Name': 'a.png', 'X-Ads-Url': 'javascript:alert(1)' })).status).toBe(400);

    const view = await call('other', 'GET', `/creatives/${ok.body.id}/file`);
    expect(view.status).toBe(200);
    expect(view.body.length).toBe(1_000_000);
    expect(view.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect((await call('other', 'DELETE', `/creatives/${ok.body.id}`, { reason: 'mine now' })).status).toBe(403);
    expect((await call('creator', 'GET', '/creatives/ADK-9999/file')).status).toBe(404);

    const pdf = await call('creator', 'POST', `/campaigns/${campaignId}/references`, new TextEncoder().encode('%PDF-1.7 brief'), { 'X-File-Name': 'brief.pdf' });
    expect(pdf.status).toBe(201);
    expect((await call('creator', 'POST', `/campaigns/${campaignId}/references`, new TextEncoder().encode('MZ...'), { 'X-File-Name': 'tool.exe' })).status).toBe(400);
    expect((await call('other', 'POST', `/campaigns/${campaignId}/references`, new TextEncoder().encode('%PDF-1.7'), { 'X-File-Name': 'x.pdf' })).status).toBe(403);
  });

  async function workbook(rows: (string | number | null)[][]) {
    const writeXlsxFile = (await import('write-excel-file/node')).default;
    const { adsTemplateSheets } = await import('../../../src/lib/ads/template');
    const [tracker, ...rest] = adsTemplateSheets([{ name: 'Facebook' }], [{ code: 'PH', name: 'Philippines' }]);
    const { IMPORT_COLUMNS } = await import('../../../src/lib/ads/import');
    const data = [tracker.data[0], tracker.data[1], ...rows.map((r) => IMPORT_COLUMNS.map((_, i) => (r[i] === null || r[i] === undefined || r[i] === '' ? null : { value: r[i] as string | number })))];
    return new Uint8Array(await writeXlsxFile([{ ...tracker, data }, ...rest] as never).toBuffer());
  }
  // Campaign Reference, Name, Platform, Brand, Account, Country, Objective, Currency, Budget, Start, End, Ads URL, Report Date, Spend, Reach, Impressions, Clicks All, Link Clicks, LPV, Reactions, Comments, Shares, Saves, Followers, Installs, Post Eng, Notes
  const row = (ref: string, date: string, spend: string, extra: Partial<Record<number, string | number | null>> = {}) => {
    const r: (string | number | null)[] = [ref, 'Imported RMB campaign', 'Facebook', null, null, 'PH', 'Engagement', 'RMB', 5000, '2026-09-01', '2026-09-30', null, date, spend, 1000, 2000, 60, 50, 20, 10, 2, 1, 1, 3, null, null, null];
    for (const [i, v] of Object.entries(extra)) r[Number(i)] = v as string | number | null;
    return r;
  };
  const preview = (who: Who, file: Uint8Array, mode = 'skip') => call(who, 'POST', `/import/preview?mode=${mode}`, file, { 'X-File-Name': 'tracker.xlsx' });
  const commit = (who: Who, file: Uint8Array, summary: unknown, mode = 'skip') =>
    call(who, 'POST', `/import/commit?mode=${mode}`, file, { 'X-File-Name': 'tracker.xlsx', 'X-Expected-Summary': JSON.stringify(summary) });

  it('round-trips the template: skips the example row, creates the campaign for the importer, and normalises RMB', async () => {
    const file = await workbook([row('IT-CN-IMPORT', '2026-09-01', '100.50'), row('IT-CN-IMPORT', '2026-09-02', '99.50')]);
    const p = await preview('other', file);
    expect(p.status).toBe(200);
    expect(p.body.summary).toEqual({ campaignsToCreate: 1, entriesToCreate: 2, entriesToUpdate: 0, skipped: 1, rejected: 0 });
    expect(p.body.rows[0]).toMatchObject({ action: 'skip', reference: 'EXAMPLE-DO-NOT-IMPORT' });

    const c = await commit('other', file, p.body.summary);
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ campaignsCreated: 1, created: 2, updated: 0 });
    const list = await call('owner', 'GET', '/campaigns?search=IT-CN-IMPORT');
    expect(list.body.items[0]).toMatchObject({ currency: 'CNY', createdById: users.other.id, spend: '200.0000', recordCount: 2 });

    // Importing the same file again duplicates nothing.
    const again = await preview('other', file);
    expect(again.body.summary).toMatchObject({ campaignsToCreate: 0, entriesToCreate: 0, skipped: 3 });
    expect((await commit('other', file, again.body.summary)).body).toMatchObject({ created: 0, updated: 0 });
    expect((await call('owner', 'GET', '/campaigns?search=IT-CN-IMPORT')).body.items[0].recordCount).toBe(2);
  });

  it('never lets an import touch someone else’s campaign, change campaign details, or invent brands', async () => {
    const file = await workbook([
      row('IT-CN-IMPORT', '2026-09-03', '10'),                      // belongs to "other"
      row('IT-PH-001', '2026-09-03', '10', { 7: 'PHP', 6: 'Traffic', 1: 'Campaign IT-PH-001', 8: 30000, 9: '2026-08-29', 10: '2026-09-27', 11: null }), // creator's campaign, but name differs
      row('IT-NEW-BRAND', '2026-09-03', '10', { 3: 'No Such Brand' }),
    ]);
    const p = await preview('creator', file);
    expect(p.body.rows.slice(1).map((r: { action: string }) => r.action)).toEqual(['reject', 'reject', 'reject']);
    expect(p.body.rows[1].errors[0]).toContain('belongs to someone else');
    expect(p.body.rows[2].errors.join(' ')).toContain('Campaign setup differs');
    expect(p.body.rows[3].errors.join(' ')).toContain('never created');
  });

  it('updates existing records only when asked, only for their creator or the System Owner, keeping blank cells', async () => {
    const file = await workbook([row('IT-CN-IMPORT', '2026-09-01', '111', { 14: null })]);
    const byOther = await preview('creator', file, 'update');
    expect(byOther.body.rows[1].action).toBe('reject');
    const byOwner = await preview('owner', file, 'update');
    expect(byOwner.body.summary).toMatchObject({ entriesToUpdate: 1 });
    expect((await commit('owner', file, byOwner.body.summary, 'update')).body).toMatchObject({ updated: 1 });
    const detail = await call('owner', 'GET', `/campaigns/${(await call('owner', 'GET', '/campaigns?search=IT-CN-IMPORT')).body.items[0].id}`);
    const day1 = detail.body.records.find((r: { reportDate: string }) => r.reportDate === '2026-09-01');
    expect(day1).toMatchObject({ amountSpent: '111.0000', reach: 1000, createdById: users.other.id });
  });

  it('writes nothing when the preview no longer matches, and rolls everything back on a failure mid-commit', async () => {
    const file = await workbook([row('IT-ROLLBACK', '2026-09-01', '1'), row('IT-ROLLBACK', '2026-09-02', '2', { 26: 'FAIL-HERE' })]);
    const p = await preview('creator', file);
    expect((await commit('creator', file, { ...p.body.summary, entriesToCreate: 99 })).status).toBe(409);

    await db.getPool().query(`CREATE TRIGGER ads_it_fail BEFORE INSERT ON ads_daily_records FOR EACH ROW
      BEGIN IF NEW.notes = 'FAIL-HERE' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced failure'; END IF; END`);
    const failed = await commit('creator', file, p.body.summary);
    expect(failed.status).toBe(500);
    await db.getPool().query('DROP TRIGGER ads_it_fail');

    const [counts] = await db.query<any>(
      "SELECT (SELECT COUNT(*) FROM ads_campaigns WHERE reference = 'IT-ROLLBACK') AS campaigns, (SELECT COUNT(*) FROM ads_import_history WHERE file_name = 'tracker.xlsx' AND user_id = ?) AS histories",
      [users.creator.id],
    );
    expect(Number(counts.campaigns)).toBe(0);
    expect(Number(counts.histories)).toBe(0);
  });

  it('keeps spend separate by currency in the overview and refuses cross-currency comparison', async () => {
    const o = await call('other', 'GET', '/overview');
    const currencies = o.body.spendByCurrency.map((g: { currency: string }) => g.currency).sort();
    expect(currencies).toEqual(['CNY', 'PHP']);
    const cny = (await call('owner', 'GET', '/campaigns?search=IT-CN-IMPORT')).body.items[0].id;
    const cmp = await call('owner', 'GET', `/compare?ids=${campaignId},${cny}`);
    expect(cmp.status).toBe(400);
  });

  it('records imports in the history with counts and errors', async () => {
    const h = await call('manager', 'GET', '/imports');
    expect(h.body.items.length).toBeGreaterThanOrEqual(3);
    expect(h.body.items.some((i: { created: number; campaignsCreated: number }) => i.created === 2 && i.campaignsCreated === 1)).toBe(true);
  });

  it('lets only the System Owner change alert thresholds', async () => {
    expect((await call('manager', 'PATCH', '/settings', { stablePct: 10 })).status).toBe(403);
    expect((await call('owner', 'PATCH', '/settings', { stablePct: 7.5 })).body).toMatchObject({ stablePct: 7.5 });
  });
});
