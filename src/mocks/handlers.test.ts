import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_ORIGIN, handlers } from './handlers';
import { db, loadFixtures } from './db';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
// The shipped workspace is empty; these tests want the synthetic dataset.
beforeEach(() => loadFixtures());
afterEach(() => server.resetHandlers());

const BASE = `${API_ORIGIN}/api`;

/** Acting as the System Administrator (TM-01) unless a test says otherwise. */
const as = (path: string, actorId = 'TM-01') => `${BASE}${path}${path.includes('?') ? '&' : '?'}actorId=${actorId}`;

async function post(path: string, body: unknown, actorId?: string) {
  const res = await fetch(as(path, actorId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function patch(path: string, body: unknown, actorId?: string) {
  const res = await fetch(as(path, actorId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('bootstrap', () => {
  it('returns every collection the UI reads', async () => {
    const res = await fetch(`${BASE}/bootstrap`);
    const data = await res.json();
    for (const key of ['countries', 'platforms', 'brands', 'projects', 'teamMembers', 'sims', 'agents', 'socialAccounts', 'credentials', 'assignments', 'domains', 'auditEntries']) {
      expect(Array.isArray(data[key]), key).toBe(true);
      expect(data[key].length, key).toBeGreaterThan(0);
    }
  });
});

describe('domains', () => {
  it('normalises to lowercase and writes an audit entry', async () => {
    const r = await post('/domains', {
      domainName: 'HTTPS://WWW.NewBrand.CO.IN/', targetCountry: 'India',
      registeredDate: '2026-01-01', expirationDate: '2027-01-01', status: 'Active',
    });
    expect(r.status).toBe(201);
    expect(r.body.domainName).toBe('newbrand.co.in');
    expect(db.auditEntries[0]).toMatchObject({ recordType: 'Domain', action: 'create' });
  });

  it('rejects a duplicate domain name regardless of the casing typed', async () => {
    const existing = db.domains[0].domainName;
    const r = await post('/domains', {
      domainName: existing.toUpperCase(), targetCountry: 'India',
      registeredDate: '2026-01-01', expirationDate: '2027-01-01',
    });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe('domainName');
  });

  it('rejects an expiration that precedes registration, on create and on edit', async () => {
    const create = await post('/domains', {
      domainName: 'backwards.id', targetCountry: 'Indonesia',
      registeredDate: '2026-06-01', expirationDate: '2026-05-31',
    });
    expect(create.status).toBe(400);
    expect(create.body.field).toBe('expirationDate');

    const target = db.domains[0];
    const edit = await patch(`/domains/${target.id}`, { expirationDate: '1999-01-01' });
    expect(edit.status).toBe(400);
  });

  it('keeps the previous rotation date in the audit trail', async () => {
    const target = db.domains.find((d) => d.rotationDate)!;
    const before = target.rotationDate;
    const r = await patch(`/domains/${target.id}`, { rotationDate: '2026-09-12', reason: 'Scheduled rotation' });
    expect(r.status).toBe(200);

    const entry = db.auditEntries[0];
    expect(entry.action).toBe('rotation');
    expect(entry.changes.find((c) => c.field === 'rotationDate')).toEqual({
      field: 'rotationDate', from: before, to: '2026-09-12',
    });
  });

  it('records a status change without touching expiry-driven highlighting', async () => {
    const target = db.domains.find((d) => d.status === 'Active')!;
    const expiration = target.expirationDate;
    await patch(`/domains/${target.id}`, { status: 'Inactive', reason: 'Parked' });
    expect(db.domains.find((d) => d.id === target.id)!.expirationDate).toBe(expiration);
    expect(db.auditEntries[0].action).toBe('status-change');
  });
});

describe('SIMs', () => {
  it('normalises a phone number on create', async () => {
    const r = await post('/sims', { phoneNumber: '+91 90000 00001', countryCode: 'IN', provider: 'Airtel' });
    expect(r.status).toBe(201);
    expect(r.body.phoneNumber).toBe('+919000000001');
  });

  it('rejects a duplicate number however it is formatted', async () => {
    const existing = db.sims[0].phoneNumber; // e.g. +919876543210
    const spaced = `${existing.slice(0, 3)} ${existing.slice(3, 8)} ${existing.slice(8)}`;
    const r = await post('/sims', { phoneNumber: spaced, countryCode: 'IN', provider: 'Jio' });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe('phoneNumber');
  });
});

describe('social accounts', () => {
  it('accepts the same handle on several accounts of one platform', async () => {
    // A team member records their own handle or name on every page they manage.
    const existing = db.socialAccounts[0];
    const again = await post('/social-accounts', { platformId: existing.platformId, username: existing.username, displayName: 'Another page' });
    expect(again.status).toBe(201);
  });

  it('rejects a duplicate platform account ID', async () => {
    const existing = db.socialAccounts.find((a) => a.platformAccountId)!;
    const r = await post('/social-accounts', {
      platformId: existing.platformId, username: 'a-brand-new-handle', platformAccountId: existing.platformAccountId,
    });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe('platformAccountId');
  });
});

describe('SIM sheet fields on a single save', () => {
  it('stores Created For, the email and the Telegram username, normalised', async () => {
    const r = await post('/sims', {
      phoneNumber: '+639175550420', countryCode: 'PH', createdFor: 'email + telegram',
      email: ' SampleA001@Gmail.com ', telegramUsername: '@DemoUser',
    });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ createdFor: 'Email + Telegram', email: 'samplea001@gmail.com', telegramUsername: 'demouser' });
  });

  it('refuses an email or Telegram username another live SIM holds', async () => {
    const [holder, other] = db.sims.filter((s) => !s.archived);
    holder.email = 'owner@example.com';
    holder.telegramUsername = 'ownername';

    const email = await post('/sims', { phoneNumber: '+639175550011', countryCode: 'PH', email: 'Owner@Example.com' });
    expect(email.status).toBe(409);
    expect(email.body.field).toBe('email');

    const tg = await patch(`/sims/${other.id}`, { telegramUsername: '@OwnerName' });
    expect(tg.status).toBe(409);
    expect(tg.body.field).toBe('telegramUsername');
  });

  it('refuses values the sheet would refuse', async () => {
    // Any purpose may be written in (Serper, Twilio, Instagram…), within 80 characters.
    const custom = await post('/sims', { phoneNumber: '+639175550014', countryCode: 'PH', createdFor: 'twilio' });
    expect(custom.body.createdFor).toBe('Twilio');
    const created = await post('/sims', { phoneNumber: '+639175550012', countryCode: 'PH', createdFor: 'x'.repeat(81) });
    expect(created.status).toBe(400);
    expect(created.body.field).toBe('createdFor');
    const tg = await post('/sims', { phoneNumber: '+639175550013', countryCode: 'PH', telegramUsername: '@ab' });
    expect(tg.body.field).toBe('telegramUsername');
  });

  it('lets a SIM be edited without re-checking its own unchanged email', async () => {
    const [a, b] = db.sims.filter((s) => !s.archived);
    a.email = 'shared@example.com';
    b.email = 'shared@example.com'; // an older clash, from before the rule
    const r = await patch(`/sims/${b.id}`, { email: 'shared@example.com', notes: 'fixing something else' });
    expect(r.status).toBe(200);
  });
});

describe('duplicate numbers and URLs do not go through', () => {
  const PAGE = 'https://www.facebook.com/xBrightgamers';

  it('refuses the same page URL on a second account, however it is written', async () => {
    const [first, second] = db.socialAccounts.filter((a) => !a.archived);
    await patch(`/social-accounts/${first.id}`, { profileUrl: PAGE });

    for (const again of [PAGE, 'http://facebook.com/xbrightgamers/', 'https://m.facebook.com/xBrightgamers?mibextid=x']) {
      const r = await post('/social-accounts', { platformId: first.platformId, username: 'Lenny', profileUrl: again });
      expect(r.status).toBe(409);
      expect(r.body.field).toBe('profileUrl');
      expect(r.body.conflictId).toBe(first.id);
    }

    const moved = await patch(`/social-accounts/${second.id}`, { profileUrl: PAGE });
    expect(moved.status).toBe(409);
  });

  it('still lets a record with an older clash be edited, as long as the URL is not changed', async () => {
    const [first, second] = db.socialAccounts.filter((a) => !a.archived);
    // Simulate two records saved before the rule existed.
    first.profileUrl = PAGE;
    second.profileUrl = PAGE;
    const r = await patch(`/social-accounts/${second.id}`, { profileUrl: PAGE, notes: 'fixing other fields' });
    expect(r.status).toBe(200);
  });

  it('refuses an agent contact number another agent already has', async () => {
    const holder = db.agents.find((a) => !a.archived)!;
    holder.contactNumber = '+639170000001';
    const r = await post('/agents', { name: 'Someone else', contactNumber: '+63 917 000 0001' });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe('contactNumber');

    const other = db.agents.find((a) => !a.archived && a.id !== holder.id)!;
    const edit = await patch(`/agents/${other.id}`, { contactNumber: '0063-917-000-0001' });
    expect(edit.status).toBe(409);
  });

  it('refuses a channel URL another agent lists, or one listed twice', async () => {
    const holder = db.agents.find((a) => !a.archived)!;
    holder.channelUrls = [PAGE];
    const clash = await post('/agents', { name: 'Someone else', channelUrls: ['facebook.com/xBrightgamers/'] });
    expect(clash.status).toBe(409);
    expect(clash.body.field).toBe('channelUrls');

    const twice = await post('/agents', { name: 'Another', channelUrls: ['https://t.me/a', 'http://www.t.me/a/'] });
    expect(twice.status).toBe(400);
    expect(twice.body.field).toBe('channelUrls');
  });

  it('refuses a content post URL already recorded, across YouTube’s URL shapes', async () => {
    const existing = db.contentPosts.find((c) => !c.archived)!;
    existing.url = 'https://youtube.com/shorts/AbC123xyz';
    const account = db.socialAccounts.find((a) => a.id === existing.accountId)!;
    const base = { accountId: account.id, title: 'Again', views: 10, likes: 1, comments: 0, shares: 0 };

    const r = await post('/content-posts', { ...base, url: 'https://youtu.be/AbC123xyz?si=share' });
    expect(r.status).toBe(409);
    expect(r.body.field).toBe('url');

    // A different video whose ID differs only in case is a different video.
    const other = await post('/content-posts', { ...base, url: 'https://youtu.be/abc123xyz' });
    expect(other.status).toBe(201);
  });

  it('skips imported accounts whose URL is already registered', async () => {
    const account = db.socialAccounts.find((a) => !a.archived)!;
    account.profileUrl = PAGE;
    const platform = db.platforms.find((p) => p.id === account.platformId)!;
    const before = db.socialAccounts.length;
    const r = await post('/import/social-accounts', {
      rows: [{ platform: platform.name, username: 'Lenny', profileUrl: 'http://facebook.com/xbrightgamers/' }],
    });
    expect(r.body).toMatchObject({ created: 0, skipped: 1 });
    expect(r.body.problems[0].reason).toMatch(/profile URL already exists/);
    expect(db.socialAccounts.length).toBe(before);
  });
});

describe('assignments', () => {
  it('refuses a second active primary custodian and names the blocking record', async () => {
    const held = db.assignments.find((a) => a.active && a.role === 'Primary Custodian' && a.resourceType === 'Social Account')!;
    const r = await post('/assignments', {
      resourceType: 'Social Account', resourceId: held.resourceId,
      newAssigneeId: 'TM-04', newAssigneeType: 'Team Member', role: 'Primary Custodian',
      startDate: '2026-09-12', purpose: 'Test',
    });
    expect(r.status).toBe(409);
    expect(r.body.conflictId).toBe(held.id);
  });

  it('accepts a collaborator on a resource that already has a custodian', async () => {
    const held = db.assignments.find((a) => a.active && a.role === 'Primary Custodian' && a.resourceType === 'Social Account')!;
    const r = await post('/assignments', {
      resourceType: 'Social Account', resourceId: held.resourceId,
      newAssigneeId: 'TM-04', newAssigneeType: 'Team Member', role: 'Collaborator',
      startDate: '2026-09-12', purpose: 'Secondary publishing access',
    });
    expect(r.status).toBe(201);
  });

  it('frees the resource when an assignment is returned, allowing a new custodian', async () => {
    const held = db.assignments.find((a) => a.active && a.role === 'Primary Custodian' && a.resourceType === 'Social Account')!;
    await patch(`/assignments/${held.id}`, { handoverStatus: 'Returned', reason: 'Engagement ended' });

    expect(db.socialAccounts.find((a) => a.id === held.resourceId)!.allocationStatus).toBe('Unassigned');
    const r = await post('/assignments', {
      resourceType: 'Social Account', resourceId: held.resourceId,
      newAssigneeId: 'TM-04', newAssigneeType: 'Team Member', role: 'Primary Custodian',
      startDate: '2026-09-12', purpose: 'New campaign',
    });
    expect(r.status).toBe(201);
    expect(db.socialAccounts.find((a) => a.id === held.resourceId)!.allocationStatus).toBe('Assigned');
  });
});

describe('credential references never accept secrets', () => {
  it('refuses any payload field that looks like secret material', async () => {
    const cred = db.credentials[0];
    for (const field of ['password', 'apiToken', 'sessionCookie', 'recoveryCode', 'otp']) {
      const r = await patch(`/credentials/${cred.id}`, { [field]: 'should-never-be-stored' });
      expect(r.status, field).toBe(422);
    }
    expect(JSON.stringify(db)).not.toContain('should-never-be-stored');
  });

  it('accepts the non-secret lifecycle fields', async () => {
    const cred = db.credentials[0];
    const r = await patch(`/credentials/${cred.id}`, { accessStatus: 'Requested', reason: 'Access requested' });
    expect(r.status).toBe(200);
    expect(r.body.accessStatus).toBe('Requested');
    expect(db.auditEntries[0].action).toBe('credential-request');
  });
});

describe('import', () => {
  it('creates valid rows, skips duplicates, names why, and never overwrites an existing record', async () => {
    const existing = db.sims.find((s) => !s.archived)!;
    const before = db.sims.length;
    const r = await post('/import/sims', {
      fallbackCountryCode: 'PH',
      rows: [
        // The team sheet's own row shape.
        { rowNumber: 2, phoneNumber: '639175550420', createdFor: 'Email + Telegram', email: 'samplea001@gmail.com', telegramUsername: '@demouser', status: 'Active', remarks: 'DEV TG' },
        { rowNumber: 3, phoneNumber: existing.phoneNumber, status: 'Dead / Patay', remarks: 'Overwrite attempt' },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ created: 1, skipped: 1 });
    expect(r.body.problems).toEqual([{ row: 3, reason: expect.stringContaining('already on a SIM in the register') }]);
    expect(db.sims.length).toBe(before + 1);

    const added = db.sims.find((s) => s.phoneNumber === '+639175550420')!;
    expect(added).toMatchObject({
      countryCode: 'PH', createdFor: 'Email + Telegram', email: 'samplea001@gmail.com', telegramUsername: 'demouser', notes: 'DEV TG',
    });
    expect(db.sims.find((s) => s.id === existing.id)!.notes).toBe(existing.notes);
    expect(db.auditEntries[0].action).toBe('import');
  });

  it('refuses an email or Telegram username already on another SIM', async () => {
    const holder = db.sims.find((s) => !s.archived)!;
    holder.email = 'owner@example.com';
    holder.telegramUsername = 'ownername';
    const r = await post('/import/sims', {
      fallbackCountryCode: 'PH',
      rows: [{ rowNumber: 2, phoneNumber: '639175550001', email: 'OWNER@example.com', telegramUsername: '@OwnerName' }],
    });
    expect(r.body.created).toBe(0);
    expect(r.body.problems[0].reason).toMatch(/Email: This email is already on a SIM.*Telegram Username: This Telegram username is already on a SIM/);
  });

  it('adds domains from the registrar export and skips names already registered', async () => {
    const existing = db.domains[0];
    const before = db.domains.length;
    const r = await post('/import/domains', {
      rows: [
        {
          rowNumber: 2, domainName: 'demowiki.com', targetCountry: 'Available', registeredDate: '2026-07-13', expirationDate: '2027-07-13',
          status: 'Active', registrar: 'RealTime', registrarUid: '241089', category: 'Ungrouped', nameservers: 'a5.share-dns.com,b5.share-dns.net',
        },
        { rowNumber: 3, domainName: existing.domainName.toUpperCase(), targetCountry: 'India', registeredDate: '2026-01-01', expirationDate: '2027-01-01', status: 'Active' },
        { rowNumber: 4, domainName: 'sampleofficial.com', targetCountry: 'Pakistan', registeredDate: '2026-08-17', expirationDate: '2027-08-17' },
      ],
    });
    expect(r.body).toMatchObject({ created: 1, skipped: 2 });
    expect(r.body.problems).toEqual([
      { row: 3, reason: expect.stringContaining('already in the register') },
      { row: 4, reason: expect.stringContaining('Country:') },
    ]);
    expect(db.domains.length).toBe(before + 1);
    expect(db.domains.find((d) => d.domainName === 'demowiki.com')).toMatchObject({ targetCountry: 'Available', registrar: 'RealTime' });
    expect(db.domains.find((d) => d.id === existing.id)).toEqual(existing);
  });
});

describe('domain upload with updating chosen', () => {
  it('updates live domains from the sheet, keeps blank cells, and skips archived ones', async () => {
    const [live, retired] = db.domains;
    Object.assign(live, { targetCountry: 'India', status: 'Active', registrar: 'Gname', nameservers: 'a5.share-dns.com', notes: 'keep' });
    retired.archived = true;
    const r = await post('/import/domains', {
      overwrite: true,
      rows: [
        { rowNumber: 2, domain: live.domainName, country: 'Available', registrationTime: live.registeredDate, expireDate: '2030-01-01', status: 'Expired', registrar: '', nameservers: '' },
        { rowNumber: 3, domain: live.domainName, country: 'India', registrationTime: live.registeredDate, expireDate: '2030-01-01' },
        { rowNumber: 4, domain: retired.domainName, country: 'India', registrationTime: retired.registeredDate, expireDate: '2030-01-01' },
      ],
    });
    expect(r.body).toMatchObject({ created: 0, updated: 1, unchanged: 0, skipped: 2 });
    expect(r.body.problems.map((p: { row: number }) => p.row)).toEqual([3, 4]);
    expect(db.domains.find((d) => d.id === live.id)).toMatchObject({
      targetCountry: 'Available', expirationDate: '2030-01-01', status: 'Inactive', registrar: 'Gname', nameservers: 'a5.share-dns.com', notes: 'keep',
    });
    const audit = db.auditEntries.find((a) => a.recordId === live.id)!;
    expect(audit.action).toBe('status-change');
    expect(audit.changes).toContainEqual({ field: 'targetCountry', from: 'India', to: 'Available' });
  });

  it('without updating chosen, an existing domain is still skipped untouched', async () => {
    const live = db.domains[0];
    const snapshot = { ...live };
    const r = await post('/import/domains', {
      rows: [{ rowNumber: 2, domain: live.domainName, country: 'Available', registrationTime: live.registeredDate, expireDate: '2030-01-01' }],
    });
    expect(r.body).toMatchObject({ created: 0, updated: 0, skipped: 1 });
    expect(db.domains[0]).toEqual(snapshot);
  });
});

describe('domain registrar fields on a single save', () => {
  it('normalises nameservers and refuses a country outside India, Indonesia, Available', async () => {
    const ok = await post('/domains', {
      domainName: 'goldsample.site', targetCountry: 'Available', registeredDate: '2026-08-11', expirationDate: '2027-08-11',
      registrar: 'Gname', nameservers: 'CHAD.ns.cloudflare.com, clarissa.ns.cloudflare.com',
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ targetCountry: 'Available', registrar: 'Gname', nameservers: 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com' });

    const badNs = await patch(`/domains/${ok.body.id}`, { nameservers: 'not a host' });
    expect(badNs.status).toBe(400);
    const badCountry = await patch(`/domains/${ok.body.id}`, { targetCountry: 'Pakistan' });
    expect(badCountry.status).toBe(400);
  });
});

describe('daily follower snapshots', () => {
  const today = new Date().toISOString().slice(0, 10);

  /** The fixtures are pinned to a fixed date, so "a date that already has entries"
   *  is derived from the data rather than from the wall clock — otherwise these
   *  tests break every day at midnight. */
  const latestFixtureDate = () => db.followerSnapshots.reduce((max, s) => (s.date > max ? s.date : max), '');
  const trackedOn = (date: string) =>
    db.socialAccounts.find((a) => db.followerSnapshots.some((s) => s.accountId === a.id && s.date === date))!;
  const untracked = () => db.socialAccounts.find((a) => !db.followerSnapshots.some((s) => s.accountId === a.id))!;

  it('records a day of numbers and writes the newest through to the account', async () => {
    const date = latestFixtureDate();
    const fresh = untracked();
    const existing = trackedOn(date);
    const r = await post('/follower-snapshots/bulk', {
      date,
      entries: [{ accountId: fresh.id, followerCount: 4_242 }, { accountId: existing.id, followerCount: 55_555 }],
    });

    expect(r.status).toBe(200);
    // One account had no row for that date, the other already did.
    expect(r.body).toMatchObject({ date, created: 1, corrected: 1 });
    expect(db.socialAccounts.find((x) => x.id === fresh.id)!.followerCount).toBe(4_242);
    expect(db.socialAccounts.find((x) => x.id === fresh.id)!.followerCountMeasuredAt).toBe(date);
    expect(db.socialAccounts.find((x) => x.id === existing.id)!.followerCount).toBe(55_555);
    expect(db.auditEntries[0].recordType).toBe('Follower Snapshot');
  });

  it('leaves an unchanged total alone rather than logging a no-op correction', async () => {
    const date = latestFixtureDate();
    const existing = trackedOn(date);
    const current = db.followerSnapshots.find((s) => s.accountId === existing.id && s.date === date)!.followerCount;
    const r = await post('/follower-snapshots/bulk', { date, entries: [{ accountId: existing.id, followerCount: current }] });
    expect(r.body).toMatchObject({ created: 0, corrected: 0 });
  });

  it('corrects a day in place instead of adding a second row for it', async () => {
    const a = untracked();
    await post('/follower-snapshots/bulk', { date: today, entries: [{ accountId: a.id, followerCount: 100 }] });
    const r = await post('/follower-snapshots/bulk', { date: today, entries: [{ accountId: a.id, followerCount: 120 }] });

    expect(r.body).toMatchObject({ created: 0, corrected: 1 });
    const rows = db.followerSnapshots.filter((s) => s.accountId === a.id && s.date === today);
    expect(rows).toHaveLength(1);
    expect(rows[0].followerCount).toBe(120);
    // The correction itself is auditable, with the previous value retained.
    const correction = db.auditEntries.find((e) => e.recordType === 'Follower Snapshot' && e.changes.some((c) => c.field === 'followerCount'));
    expect(correction!.changes[0]).toMatchObject({ from: '100', to: '120' });
  });

  it('does not let a back-filled older day overwrite a newer total', async () => {
    const a = untracked();
    await post('/follower-snapshots/bulk', { date: today, entries: [{ accountId: a.id, followerCount: 9_000 }] });
    await post('/follower-snapshots/bulk', { date: '2026-01-01', entries: [{ accountId: a.id, followerCount: 10 }] });

    expect(db.socialAccounts.find((x) => x.id === a.id)!.followerCount).toBe(9_000);
    expect(db.socialAccounts.find((x) => x.id === a.id)!.followerCountMeasuredAt).toBe(today);
  });

  it('rejects a future date, a bad total and an unknown account', async () => {
    const a = untracked();
    const future = await post('/follower-snapshots/bulk', {
      date: '2099-01-01', entries: [{ accountId: a.id, followerCount: 1 }],
    });
    expect(future.status).toBe(400);
    expect(future.body.message).toMatch(/future date/i);

    expect((await post('/follower-snapshots/bulk', { date: today, entries: [{ accountId: a.id, followerCount: -5 }] })).status).toBe(400);
    expect((await post('/follower-snapshots/bulk', { date: today, entries: [{ accountId: a.id, followerCount: 1.5 }] })).status).toBe(400);
    expect((await post('/follower-snapshots/bulk', { date: today, entries: [{ accountId: 'ACC-9999', followerCount: 1 }] })).status).toBe(400);
    expect((await post('/follower-snapshots/bulk', { date: 'not-a-date', entries: [{ accountId: a.id, followerCount: 1 }] })).status).toBe(400);
    expect((await post('/follower-snapshots/bulk', { date: today, entries: [] })).status).toBe(400);
  });

  it('writes nothing when the payload is rejected', async () => {
    const before = db.followerSnapshots.length;
    await post('/follower-snapshots/bulk', {
      date: today,
      entries: [{ accountId: untracked().id, followerCount: 10 }, { accountId: 'ACC-9999', followerCount: 1 }],
    });
    expect(db.followerSnapshots.length).toBe(before);
  });
});

describe('content posts', () => {
  it('records a post and copies the platform from its account', async () => {
    const account = db.socialAccounts.find((a) => a.platformId === 'PLT-02')!;
    const r = await post('/content-posts', {
      accountId: account.id, format: 'Reel', title: 'Test reel',
      views: 1000, likes: 80, comments: 15, shares: 5, followerGain: 12,
      publishedDate: '2026-09-01', metricsMeasuredAt: '2026-09-12',
    });
    expect(r.status).toBe(201);
    expect(r.body.platformId).toBe('PLT-02');
    expect(db.auditEntries[0].recordType).toBe('Content Post');
  });

  it('refuses numbers that cannot be true', async () => {
    const account = db.socialAccounts[0];
    const impossible = await post('/content-posts', {
      accountId: account.id, title: 'More likes than views', views: 10, likes: 50, comments: 0, shares: 0,
    });
    expect(impossible.status).toBe(400);
    expect(impossible.body.message).toMatch(/cannot exceed views/i);

    const negative = await post('/content-posts', {
      accountId: account.id, title: 'Negative', views: -1, likes: 0, comments: 0, shares: 0,
    });
    expect(negative.status).toBe(400);
  });

  it('requires a real account and a title', async () => {
    expect((await post('/content-posts', { accountId: 'ACC-9999', title: 'x', views: 1, likes: 0, comments: 0, shares: 0 })).status).toBe(400);
    expect((await post('/content-posts', { accountId: db.socialAccounts[0].id, title: '  ', views: 1, likes: 0, comments: 0, shares: 0 })).status).toBe(400);
  });

  it('keeps the engagements-vs-views rule on edit too', async () => {
    const existing = db.contentPosts[0];
    const r = await patch(`/content-posts/${existing.id}`, { views: 1 });
    expect(r.status).toBe(400);

    const ok = await patch(`/content-posts/${existing.id}`, { likes: existing.likes + 1, reason: 'Recount' });
    expect(ok.status).toBe(200);
    expect(db.auditEntries[0].recordType).toBe('Content Post');
  });
});

describe('the API sanitises what it stores, not just what the forms send', () => {
  it('refuses to store a javascript: profile URL', async () => {
    const r = await post('/social-accounts', {
      platformId: 'PLT-05', username: 'evil-link', displayName: 'Evil',
      profileUrl: 'javascript:alert(document.cookie)',
    });
    expect(r.status).toBe(201);
    // Dropped rather than stored, so it can never reach an href.
    expect(r.body.profileUrl).toBe('');
    expect(JSON.stringify(db.socialAccounts)).not.toContain('javascript:');
  });

  it('strips zero-width and bidi characters from a handle', async () => {
    const r = await post('/social-accounts', {
      platformId: 'PLT-05', username: 'aurora​shop‮', displayName: 'Spoof',
    });
    expect(r.status).toBe(201);
    expect(r.body.username).toBe('aurorashop');
  });

  it('caps an oversized note instead of storing it whole', async () => {
    const r = await post('/social-accounts', {
      platformId: 'PLT-05', username: 'long-note-account', notes: 'x'.repeat(50_000),
    });
    expect(r.body.notes.length).toBeLessThanOrEqual(4000);
  });

  it('sanitises on edit as well as on create', async () => {
    const existing = db.socialAccounts[0];
    const r = await patch(`/social-accounts/${existing.id}`, { profileUrl: 'data:text/html,<script>' });
    expect(r.status).toBe(200);
    expect(r.body.profileUrl).toBe('');
  });

  it('sanitises rows arriving through CSV import', async () => {
    const r = await post('/import/social-accounts', {
      rows: [{
        platform: 'X', username: 'imported​handle', displayName: 'Imported',
        profileUrl: 'javascript:alert(1)', notes: 'y'.repeat(20_000),
      }],
    });
    expect(r.body.created).toBe(1);
    const created = db.socialAccounts.find((a) => a.username === 'importedhandle');
    expect(created).toBeTruthy();
    expect(created!.profileUrl).toBe('');
    expect(created!.notes.length).toBeLessThanOrEqual(4000);
  });

  it('keeps a legitimate https URL intact', async () => {
    const r = await post('/social-accounts', {
      platformId: 'PLT-05', username: 'good-link', profileUrl: 'https://x.com/good-link',
    });
    expect(r.body.profileUrl).toBe('https://x.com/good-link');
  });
});

describe('System Administrator only areas', () => {
  const staff = 'TM-04';
  const manager = 'TM-02';

  it('refuses domains, credential references and imports to everyone else', async () => {
    const domain = db.domains[0];
    expect((await post('/domains', { domainName: 'staff.example', targetCountry: 'India', registeredDate: '2026-01-01', expirationDate: '2027-01-01' }, staff)).status).toBe(403);
    expect((await patch(`/domains/${domain.id}`, { notes: 'x' }, manager)).status).toBe(403);
    expect((await patch(`/credentials/${db.credentials[0].id}`, { accessStatus: 'Requested' }, staff)).status).toBe(403);
    expect((await post('/import/agents', { rows: [{ name: 'Someone' }] }, manager)).status).toBe(403);
    expect((await post('/import/domains', { rows: [{ domain: 'a.example' }] }, staff)).status).toBe(403);
  });

  it('still lets staff bulk upload SIMs from the SIMs page', async () => {
    const r = await post('/import/sims', { fallbackCountryCode: 'PH', rows: [{ rowNumber: 2, phoneNumber: '639175550099' }] }, staff);
    expect(r.status).toBe(200);
    expect(r.body.created).toBe(1);
  });
});

describe('agent edit lock', () => {
  const agentManagedBy = (managerId: string | null) => {
    const agent = db.agents.find((a) => !a.archived)!;
    agent.managerId = managerId;
    return agent;
  };

  it('lets the assigned manager and the System Administrator edit, and no one else', async () => {
    const agent = agentManagedBy('TM-04');
    expect((await patch(`/agents/${agent.id}`, { notes: 'by manager' }, 'TM-04')).status).toBe(200);
    expect((await patch(`/agents/${agent.id}`, { notes: 'by admin' }, 'TM-01')).status).toBe(200);
    const other = await patch(`/agents/${agent.id}`, { notes: 'by another staff' }, 'TM-05');
    expect(other.status).toBe(403);
    expect(other.body.message).toBe('Only Rohit Menon (the assigned manager) or the System Administrator can edit this agent.');
    expect((await patch(`/agents/${agent.id}`, { notes: 'by a marketing manager' }, 'TM-02')).status).toBe(403);
    expect(agent.notes).toBe('by admin');
  });

  it('keeps an agent with no manager to the System Administrator', async () => {
    const agent = agentManagedBy(null);
    expect((await patch(`/agents/${agent.id}`, { notes: 'x' }, 'TM-04')).status).toBe(403);
    expect((await patch(`/agents/${agent.id}`, { managerId: 'TM-04' }, 'TM-01')).status).toBe(200);
    expect((await patch(`/agents/${agent.id}`, { notes: 'now mine' }, 'TM-04')).status).toBe(200);
  });

  it('refuses a UID another live agent already has', async () => {
    const [a, b] = db.agents.filter((x) => !x.archived);
    a.externalUid = '81000037';
    b.managerId = 'TM-01';
    const created = await post('/agents', { name: 'New Agent', externalUid: ' 81000037 ' });
    expect(created.status).toBe(409);
    expect(created.body.field).toBe('externalUid');
    expect((await patch(`/agents/${b.id}`, { externalUid: '81000037' })).status).toBe(409);
    expect((await post('/agents', { name: 'Another Agent', externalUid: '99887766' })).body.externalUid).toBe('99887766');
  });
});

describe('recovery detail on social accounts', () => {
  it('stores the recovery route for the method and refuses codes', async () => {
    const ok = await post('/social-accounts', { username: 'recoverytest', recoveryMethod: 'Recovery Email', recoveryRef: 'Inbox@Example.com' });
    expect(ok.status).toBe(201);
    expect(ok.body.recoveryRef).toBe('inbox@example.com');
    const codes = await patch(`/social-accounts/${ok.body.id}`, { recoveryMethod: 'Backup Codes', recoveryRef: '8391 2274 5520 1187' });
    expect(codes.status).toBe(400);
    expect(codes.body.field).toBe('recoveryRef');
    const audit = db.auditEntries.find((e) => e.recordId === ok.body.id);
    expect(JSON.stringify(audit)).not.toContain('inbox@example.com');
  });
});

describe('agent proofs', () => {
  const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13));
  const managed = () => {
    const agent = db.agents.find((a) => !a.archived)!;
    agent.managerId = 'TM-04';
    return agent;
  };

  it('uploads a proof for the manager, serves the image, and blocks a repeated Post URL', async () => {
    const agent = managed();
    const url = 'https://www.facebook.com/xBrightgamers/posts/1001';
    const r = await post(`/agents/${agent.id}/proofs`, { postUrl: url, image: `data:image/png;base64,${PNG}` }, 'TM-04');
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ agentId: agent.id, postUrl: url, mimeType: 'image/png', sizeBytes: 12, uploadedById: 'TM-04' });

    const image = await fetch(as(`/agent-proofs/${r.body.id}/image`));
    expect(image.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())[1]).toBe(0x50);

    const again = await post(`/agents/${agent.id}/proofs`, { postUrl: url, image: PNG }, 'TM-01');
    expect(again.status).toBe(409);
    expect(again.body.field).toBe('postUrl');
  });

  it('refuses other staff, non-images and anything over 500 KB', async () => {
    const agent = managed();
    const url = 'https://www.facebook.com/xBrightgamers/posts/1002';
    expect((await post(`/agents/${agent.id}/proofs`, { postUrl: url, image: PNG }, 'TM-05')).status).toBe(403);
    const svg = await post(`/agents/${agent.id}/proofs`, { postUrl: url, image: btoa('<svg onload=alert(1)>') }, 'TM-04');
    expect(svg.body.field).toBe('image');
    const bigBytes = new Uint8Array(500 * 1024 + 1);
    bigBytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    let binary = '';
    for (let i = 0; i < bigBytes.length; i += 0x8000) binary += String.fromCharCode(...bigBytes.subarray(i, i + 0x8000));
    const big = await post(`/agents/${agent.id}/proofs`, { postUrl: url, image: btoa(binary) }, 'TM-04');
    expect(big.status).toBe(400);
    expect(big.body.message).toContain('500 KB');
    expect(db.agentProofs).toHaveLength(0);
  });

  it('removes a proof only with a written reason, and records it', async () => {
    const agent = managed();
    const r = await post(`/agents/${agent.id}/proofs`, { postUrl: 'https://tiktok.com/@x/video/1', image: PNG }, 'TM-01');
    expect((await patch(`/agent-proofs/${r.body.id}`, { archived: true }, 'TM-01')).status).toBe(400);
    expect((await patch(`/agent-proofs/${r.body.id}`, { archived: true, reason: 'Wrong screenshot uploaded' }, 'TM-01')).body.archived).toBe(true);
    expect(db.auditEntries[0]).toMatchObject({ recordId: agent.id, action: 'archive', reason: 'Wrong screenshot uploaded' });
  });

  it('starts Not reviewed and Not paid; only the System Administrator sets verdict and payment', async () => {
    const agent = managed();
    const r = await post(`/agents/${agent.id}/proofs`, { postUrl: 'https://t.me/SAMPLECHANNEL6/61', image: PNG }, 'TM-04');
    const id = r.body.id as string;
    expect(r.body).toMatchObject({ verdict: null, payment: 'Not paid' });

    // The assigned manager and other staff are refused, however they ask.
    expect((await patch(`/agent-proofs/${id}/review`, { verdict: 'Accepted' }, 'TM-04')).status).toBe(403);
    expect((await patch(`/agent-proofs/${id}/review`, { payment: 'Paid' }, 'TM-05')).status).toBe(403);

    // A rejection needs a reason.
    const noReason = await patch(`/agent-proofs/${id}/review`, { verdict: 'Rejected', reason: 'bad' }, 'TM-01');
    expect(noReason.status).toBe(400);
    expect(noReason.body.field).toBe('reason');
    expect((await patch(`/agent-proofs/${id}/review`, { verdict: 'Maybe' }, 'TM-01')).status).toBe(400);

    const rejected = await patch(`/agent-proofs/${id}/review`, { verdict: 'Rejected', reason: 'Post was deleted from the channel' }, 'TM-01');
    expect(rejected.body).toMatchObject({ verdict: 'Rejected', verdictReason: 'Post was deleted from the channel', payment: 'Not paid' });
    expect(db.auditEntries[0]).toMatchObject({ recordId: agent.id, action: 'status-change', reason: 'Post was deleted from the channel' });

    const accepted = await patch(`/agent-proofs/${id}/review`, { verdict: 'Accepted' }, 'TM-01');
    expect(accepted.body).toMatchObject({ verdict: 'Accepted', verdictReason: '' });
    const paid = await patch(`/agent-proofs/${id}/review`, { payment: 'Paid' }, 'TM-01');
    expect(paid.body).toMatchObject({ payment: 'Paid', paidByName: expect.any(String) });
    expect(db.auditEntries[0].changes).toEqual([{ field: 'proofPayment', from: 'Not paid', to: 'Paid' }]);
    expect((await patch(`/agent-proofs/${id}/review`, { payment: 'Not paid' }, 'TM-01')).body.payment).toBe('Not paid');
  });
});

describe('team reports', () => {
  const gordon = 'TM-04'; // Rohit Menon, Marketing Staff
  const bea = 'TM-05';    // Siti Nurhaliza, Marketing Staff
  const owner = 'TM-01';
  const today = new Date().toISOString().slice(0, 10);

  beforeEach(async () => { (await import('./team-reports')).resetTeamReports(); });

  async function upload(id: string, name: string, bytes: Uint8Array, actorId: string) {
    const res = await fetch(as(`/team-reports/${id}/files`, actorId), {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name) }, body: bytes as BodyInit,
    });
    return { status: res.status, body: await res.json() };
  }
  const list = async (actorId: string) => (await (await fetch(as('/team-reports?period=daily', actorId))).json()).reports as { id: string; authorId: string }[];

  it('files one report per person per day, shown to its author and the owner only', async () => {
    const r = await post('/team-reports', { period: 'daily', date: today, workDone: 'Posted 3 reels', recommendation: 'Boost the Sunday post' }, gordon);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ authorId: gordon, status: 'Submitted', periodStart: today });
    expect((await post('/team-reports', { period: 'daily', date: today, workDone: 'again' }, gordon)).status).toBe(409);

    expect((await list(gordon)).map((x) => x.id)).toEqual([r.body.id]);
    expect(await list(bea)).toEqual([]);
    expect((await list(owner)).map((x) => x.id)).toEqual([r.body.id]);
    expect((await post(`/team-reports/${r.body.id}/replies`, { body: 'nosy' }, bea)).status).toBe(404);
  });

  it('keeps a thread between the owner and the author', async () => {
    const r = await post('/team-reports', { period: 'weekly', date: today, workDone: 'Week of work' }, gordon);
    await post(`/team-reports/${r.body.id}/replies`, { body: 'Good work — try TikTok next week.' }, owner);
    const answered = await post(`/team-reports/${r.body.id}/replies`, { body: 'Will do.' }, gordon);
    expect(answered.body.replies.map((x: { authorName: string; body: string }) => `${x.authorName}: ${x.body}`)).toEqual([
      'Priya Raghunathan: Good work — try TikTok next week.', 'Rohit Menon: Will do.',
    ]);
  });

  it('holds images under 1 MB, documents to 5 MB, and five files per report', async () => {
    const r = await post('/team-reports', { period: 'daily', date: today, workDone: 'x' }, gordon);
    const png = (size: number) => { const b = new Uint8Array(size); b.set([0x89, 0x50, 0x4e, 0x47]); return b; };
    const pdf = new TextEncoder().encode('%PDF-1.7 report');
    expect((await upload(r.body.id, 'big.png', png(1024 * 1024 + 10), gordon)).body.message).toContain('under 1 MB');
    expect((await upload(r.body.id, 'shot.png', png(900 * 1024), gordon)).status).toBe(201);
    expect((await upload(r.body.id, 'shot.png', png(10), bea)).status).toBe(404);
    for (let i = 0; i < 4; i++) expect((await upload(r.body.id, `doc${i}.pdf`, pdf, gordon)).status).toBe(201);
    const sixth = await upload(r.body.id, 'doc5.pdf', pdf, gordon);
    expect(sixth.status).toBe(400);
    expect(sixth.body.message).toContain('up to 5 files');

    const file = (await list(owner))[0] as unknown as { files: { id: string }[] };
    const got = await fetch(as(`/team-reports/files/${file.files[0].id}`, owner));
    expect(got.headers.get('content-type')).toBe('image/png');
    expect((await fetch(as(`/team-reports/files/${file.files[0].id}`, bea))).status).toBe(404);
  });

  it('locks a reviewed report, and reopens one marked Needs changes when the author edits it', async () => {
    const r = await post('/team-reports', { period: 'monthly', date: today, workDone: 'Month' }, gordon);
    expect((await patch(`/team-reports/${r.body.id}`, { status: 'Needs changes' }, gordon)).status).toBe(403);
    await patch(`/team-reports/${r.body.id}`, { status: 'Needs changes' }, owner);
    const fixed = await patch(`/team-reports/${r.body.id}`, { results: '+420 followers' }, gordon);
    expect(fixed.body).toMatchObject({ status: 'Submitted', results: '+420 followers' });
    await patch(`/team-reports/${r.body.id}`, { status: 'Reviewed' }, owner);
    expect((await patch(`/team-reports/${r.body.id}`, { results: 'changed after review' }, gordon)).status).toBe(403);
  });

  it('lets only the owner delete a report — permanently, with a reason, leaving one line of history', async () => {
    const r = await post('/team-reports', { period: 'daily', date: today, workDone: 'Secret-ish plan details', recommendation: 'Private idea' }, gordon);
    await upload(r.body.id, 'notes.csv', new TextEncoder().encode('a,b'), gordon);
    const del = async (body: unknown, actorId: string) => {
      const res = await fetch(as(`/team-reports/${r.body.id}`, actorId), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: await res.json() };
    };
    expect((await del({ reason: 'I want it gone' }, gordon)).status).toBe(403);
    expect((await del({}, owner)).status).toBe(400);
    expect((await del({ reason: 'Duplicate of the weekly report' }, owner)).body).toEqual({ deleted: r.body.id });

    const { teamReportStore } = await import('./team-reports');
    expect(teamReportStore.reports).toEqual([]);
    expect(Object.keys(teamReportStore.files)).toEqual([]);
    const line = db.auditEntries[0];
    expect(line).toMatchObject({ recordType: 'Team Report', action: 'delete', reason: 'Duplicate of the weekly report', recordLabel: expect.stringContaining("Rohit Menon's daily report") });
    expect(JSON.stringify(db.auditEntries)).not.toContain('Secret-ish plan details');
  });
});

describe('restoring an archived agent', () => {
  it('needs the archive permission and a reason, and refuses a number now on a live agent', async () => {
    const [archived, live] = db.agents.filter((a) => !a.archived);
    archived.managerId = 'TM-04';
    await patch(`/agents/${archived.id}`, { archived: true, reason: 'Stopped working with us' }, 'TM-01');
    expect(archived.archived).toBe(true);

    // Restoring needs a reason from anyone.
    expect((await patch(`/agents/${archived.id}`, { archived: false }, 'TM-01')).status).toBe(400);

    live.contactNumber = archived.contactNumber;
    const clash = await patch(`/agents/${archived.id}`, { archived: false, reason: 'Working with us again' }, 'TM-01');
    expect(clash.status).toBe(409);
    expect(clash.body.field).toBe('contactNumber');

    live.contactNumber = '+639000000001';
    const restored = await patch(`/agents/${archived.id}`, { archived: false, reason: 'Working with us again' }, 'TM-01');
    expect(restored.status).toBe(200);
    expect(archived.archived).toBe(false);
    expect(db.auditEntries[0]).toMatchObject({ recordId: archived.id, action: 'status-change', reason: 'Working with us again' });
  });
});

describe('archiving agents is open to every member who may archive', () => {
  it('lets staff archive and restore agents they do not manage, but not edit them', async () => {
    const agent = db.agents.find((a) => !a.archived)!;
    agent.managerId = 'TM-04';
    const staff = db.teamMembers.find((t) => t.role === 'Marketing Staff' && t.id !== 'TM-04')!;
    const reviewer = db.teamMembers.find((t) => t.role === 'Read-only Reviewer');

    // Editing details is still the assigned manager's or the System Administrator's.
    expect((await patch(`/agents/${agent.id}`, { notes: 'Changed by someone else' }, staff.id)).status).toBe(403);
    // Archive together with an edit is an edit, so it is locked too.
    expect((await patch(`/agents/${agent.id}`, { archived: true, notes: 'sneaky', reason: 'Stopped working with us' }, staff.id)).status).toBe(403);
    expect(agent.archived).toBe(false);

    expect((await patch(`/agents/${agent.id}`, { archived: true }, staff.id)).status).toBe(400);
    const archived = await patch(`/agents/${agent.id}`, { archived: true, reason: 'Stopped working with us' }, staff.id);
    expect(archived.status).toBe(200);
    expect(agent.archived).toBe(true);
    expect(db.auditEntries[0]).toMatchObject({ recordId: agent.id, action: 'archive', actorId: staff.id, reason: 'Stopped working with us' });

    if (reviewer) expect((await patch(`/agents/${agent.id}`, { archived: false, reason: 'Back with us again' }, reviewer.id)).status).toBe(403);
    const restored = await patch(`/agents/${agent.id}`, { archived: false, reason: 'Back with us again' }, staff.id);
    expect(restored.status).toBe(200);
    expect(agent.archived).toBe(false);
  });
});

describe('archiving and restoring a domain', () => {
  it('needs a written reason both ways and records each step', async () => {
    const domain = db.domains.find((d) => !d.archived)!;
    expect((await patch(`/domains/${domain.id}`, { archived: true }, 'TM-01')).status).toBe(400);
    expect((await patch(`/domains/${domain.id}`, { archived: true, reason: 'Registration lapsed' }, 'TM-01')).status).toBe(200);
    expect(domain.archived).toBe(true);
    expect(db.auditEntries[0]).toMatchObject({ recordId: domain.id, action: 'archive', reason: 'Registration lapsed' });

    // Staff do not have the Domains page by default.
    expect((await patch(`/domains/${domain.id}`, { archived: false, reason: 'Renewed again' }, 'TM-05')).status).toBe(403);
    expect((await patch(`/domains/${domain.id}`, { archived: false }, 'TM-01')).status).toBe(400);
    expect((await patch(`/domains/${domain.id}`, { archived: false, reason: 'Renewed again' }, 'TM-01')).status).toBe(200);
    expect(domain.archived).toBe(false);
    expect(db.auditEntries[0]).toMatchObject({ recordId: domain.id, action: 'status-change', reason: 'Renewed again' });
  });
});

describe('permission editor', () => {
  const put =async (path: string, body: unknown, actorId: string) => {
    const res = await fetch(as(path, actorId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it('lets only the System Administrator change role and individual permissions', async () => {
    expect((await put('/permissions/roles/Marketing%20Staff', { permissions: ['edit:resources'] }, 'TM-02')).status).toBe(403);
    const saved = await put('/permissions/roles/Marketing%20Staff', { permissions: ['edit:resources', 'access:domains', 'manage:users'] }, 'TM-01');
    expect(saved.body.roles['Marketing Staff']).toEqual(['edit:resources', 'access:domains']);
    expect((await put('/permissions/roles/System%20Administrator', { permissions: [] }, 'TM-01')).status).toBe(400);
    const person = await put('/permissions/users/TM-04', { permissions: ['export:data', 'edit:resources'] }, 'TM-01');
    // edit:resources already comes from the role, so only the extra is kept.
    expect(person.body.users['TM-04']).toEqual(['export:data']);
  });
});

describe('agent salary status', () => {
  it('is set only by the System Administrator, with custom text for Customize, and is audited', async () => {
    const agent = db.agents.find((a) => !a.archived)!;
    agent.managerId = 'TM-04';
    expect(agent.salaryStatus).toBeNull();

    // Neither the assigned manager nor other roles can set it, nor sneak it into an edit.
    expect((await patch(`/agents/${agent.id}/salary`, { status: 'Hold' }, 'TM-04')).status).toBe(403);
    expect((await patch(`/agents/${agent.id}/salary`, { status: 'Advance' }, 'TM-02')).status).toBe(403);
    await patch(`/agents/${agent.id}`, { notes: 'edited', salaryStatus: 'Advance' }, 'TM-01');
    expect(agent.salaryStatus).toBeNull();

    expect((await patch(`/agents/${agent.id}/salary`, { status: 'Paid' }, 'TM-01')).body.field).toBe('status');
    const hold = await patch(`/agents/${agent.id}/salary`, { status: 'Hold' }, 'TM-01');
    expect(hold.body).toMatchObject({ salaryStatus: 'Hold', salaryNote: '' });
    expect(db.auditEntries[0]).toMatchObject({ recordId: agent.id, action: 'status-change', reason: 'Salary status set to Hold' });

    expect((await patch(`/agents/${agent.id}/salary`, { status: 'Customize', note: '' }, 'TM-01')).body.field).toBe('note');
    expect((await patch(`/agents/${agent.id}/salary`, { status: 'Customize', note: 'x'.repeat(81) }, 'TM-01')).status).toBe(400);
    const custom = await patch(`/agents/${agent.id}/salary`, { status: 'Customize', note: '50% paid, rest on Friday' }, 'TM-01');
    expect(custom.body).toMatchObject({ salaryStatus: 'Customize', salaryNote: '50% paid, rest on Friday', salaryUpdatedByName: expect.any(String) });
    expect(db.auditEntries[0].changes).toEqual([{ field: 'salaryStatus', from: 'Hold', to: '50% paid, rest on Friday' }]);

    // Choosing Hold or Advance drops the custom text; clearing resets it.
    expect((await patch(`/agents/${agent.id}/salary`, { status: 'Advance', note: 'ignored' }, 'TM-01')).body).toMatchObject({ salaryStatus: 'Advance', salaryNote: '' });
    expect((await patch(`/agents/${agent.id}/salary`, { status: null }, 'TM-01')).body).toMatchObject({ salaryStatus: null, salaryNote: '' });
  });
});
