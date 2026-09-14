import { describe, expect, it } from 'vitest';
import * as seed from '@/mocks/fixtures';
import {
  DEFAULT_THRESHOLDS, accountMissingCredential, accountMissingOwner, accountUnderReviewOrRestricted,
  checkAssignmentConflict, domainExpiryBucket, duplicateAccounts, duplicateAgentChannels, duplicateAgentContacts,
  duplicatePhoneNumbers, duplicatePostUrls, previousCustodianFor,
  evaluateReserveReadiness, reserveAccounts, simApproachingRenewal, simFanOutReview,
} from './rules';
import { isForbiddenColumn, parseCSV, toCSV } from './csv';
import { daysUntil, normalizeDomain, normalizePhone } from './utils';

const platformName = (id: string) => seed.platforms.find((p) => p.id === id)?.name ?? id;

describe('dashboard counts agree with the records they drill into', () => {
  it('reserve inventory excludes suspended, restricted and closed accounts', () => {
    const reserves = reserveAccounts(seed.socialAccounts);
    expect(reserves.length).toBeGreaterThan(0);
    for (const a of reserves) {
      expect(a.allocationStatus).toBe('Reserved');
      expect(['Suspended', 'Restricted', 'Closed']).not.toContain(a.operationalStatus);
    }
  });

  it('ready-to-assign is a strict subset of reserves and satisfies every criterion', () => {
    const reserves = reserveAccounts(seed.socialAccounts);
    const ready = reserves.filter((a) => evaluateReserveReadiness(a, seed.assignments).ready);
    expect(ready.length).toBeLessThanOrEqual(reserves.length);
    for (const a of ready) {
      const r = evaluateReserveReadiness(a, seed.assignments);
      expect(r.failed).toHaveLength(0);
      expect(a.responsibleTeamMemberId).not.toBeNull();
      expect(a.credentialId).toBeTruthy();
      expect(a.recoveryMethod).not.toBe('None');
    }
  });

  it('a reserve account with an active primary custodian is never ready', () => {
    const reserve = reserveAccounts(seed.socialAccounts)[0];
    const withCustodian = evaluateReserveReadiness(reserve, [
      ...seed.assignments,
      { ...seed.assignments[0], resourceType: 'Social Account', resourceId: reserve.id, role: 'Primary Custodian', active: true },
    ]);
    expect(withCustodian.ready).toBe(false);
    expect(withCustodian.failed.map((f) => f.key)).toContain('no-assignment');
  });

  it('flag predicates return only records that actually carry the flag', () => {
    for (const a of seed.socialAccounts.filter(accountMissingOwner)) expect(a.responsibleTeamMemberId).toBeNull();
    for (const a of seed.socialAccounts.filter(accountMissingCredential)) expect(a.credentialId).toBeFalsy();
    for (const a of seed.socialAccounts.filter(accountUnderReviewOrRestricted)) {
      expect(['Under Review', 'Restricted']).toContain(a.operationalStatus);
    }
  });

  it('SIM renewal window includes overdue as well as upcoming expiries', () => {
    const due = seed.sims.filter((s) => simApproachingRenewal(s));
    expect(due.length).toBeGreaterThan(0);
    for (const s of due) {
      expect(daysUntil(s.planExpiryDate)!).toBeLessThanOrEqual(DEFAULT_THRESHOLDS.simRenewalWindowDays);
    }
  });
});

describe('duplicate detection', () => {
  it('finds SIM records sharing a phone number', () => {
    const groups = duplicatePhoneNumbers(seed.sims);
    expect(groups.length).toBeGreaterThan(0);
    for (const g of groups) expect(g.records.length).toBeGreaterThan(1);
  });

  it('finds accounts sharing a platform ID on the same platform', () => {
    const groups = duplicateAccounts(seed.socialAccounts, platformName);
    expect(groups.some((g) => g.label.includes('platform ID'))).toBe(true);
    for (const g of groups) expect(g.records.length).toBeGreaterThan(1);
  });

  // Copies of one fixture account, each a distinct page unless a test says otherwise.
  const page = (id: string, over: Partial<(typeof seed.socialAccounts)[number]>) => ({
    ...seed.socialAccounts[0], id, platformAccountId: '', profileUrl: `https://www.facebook.com/${id}`, archived: false, ...over,
  });

  it('does not treat a shared handle as a duplicate', () => {
    // Team members manage many pages and reuse a handle or name across them.
    const pages = [page('ACC-A', { username: 'Lenny', platformAccountId: '1001' }), page('ACC-B', { username: 'Lenny', platformAccountId: '1002' })];
    expect(duplicateAccounts(pages, platformName)).toEqual([]);
  });

  it('does not group accounts that simply have no platform ID or URL', () => {
    // Blank says nothing about identity; grouping blanks would flag every ID-less page.
    const pages = [page('ACC-A', { profileUrl: '' }), page('ACC-B', { platformAccountId: '  ', profileUrl: '' })];
    expect(duplicateAccounts(pages, platformName)).toEqual([]);
  });

  it('still catches the same platform ID recorded twice', () => {
    const pages = [
      page('ACC-A', { username: 'one', platformAccountId: '1028015430387756' }),
      page('ACC-B', { username: 'two', platformAccountId: '1028015430387756' }),
    ];
    expect(duplicateAccounts(pages, platformName).map((g) => g.records.map((r) => r.id))).toEqual([['ACC-A', 'ACC-B']]);
  });

  it('catches the same page URL recorded twice, however it was written', () => {
    const pages = [
      page('ACC-A', { profileUrl: 'https://www.facebook.com/xBrightgamers' }),
      page('ACC-B', { profileUrl: 'http://m.facebook.com/xbrightgamers/?mibextid=abc' }),
      page('ACC-C', { profileUrl: 'https://www.facebook.com/BrightGames' }),
    ];
    const groups = duplicateAccounts(pages, platformName);
    expect(groups.map((g) => g.records.map((r) => r.id))).toEqual([['ACC-A', 'ACC-B']]);
    expect(groups[0].label).toContain('profile URL');
  });

  it('finds agents sharing a number or a channel, and posts recorded twice', () => {
    const agent = seed.agents[0];
    const agents = [
      { ...agent, id: 'AGT-A', archived: false, contactNumber: '+639170000001', channelUrls: ['https://t.me/bright'] },
      { ...agent, id: 'AGT-B', archived: false, contactNumber: '+63 917 000 0001', channelUrls: ['http://www.t.me/bright/'] },
      { ...agent, id: 'AGT-C', archived: false, contactNumber: '+639170000009', channelUrls: [] },
    ];
    expect(duplicateAgentContacts(agents).map((g) => g.records.map((r) => r.id))).toEqual([['AGT-A', 'AGT-B']]);
    expect(duplicateAgentChannels(agents).map((g) => g.records.map((r) => r.id))).toEqual([['AGT-A', 'AGT-B']]);

    const post = seed.contentPosts[0];
    const posts = [
      { ...post, id: 'CNT-A', archived: false, url: 'https://youtube.com/shorts/AbC123' },
      { ...post, id: 'CNT-B', archived: false, url: 'https://youtu.be/AbC123?si=x' },
      { ...post, id: 'CNT-C', archived: false, url: 'https://youtu.be/abc123' },
      { ...post, id: 'CNT-D', archived: false, url: '' },
      { ...post, id: 'CNT-E', archived: false, url: '' },
    ];
    expect(duplicatePostUrls(posts).map((g) => g.records.map((r) => r.id))).toEqual([['CNT-A', 'CNT-B']]);
  });

  it('ignores archived records, which keep their numbers and URLs for history', () => {
    const agent = seed.agents[0];
    const agents = [
      { ...agent, id: 'AGT-A', archived: false, contactNumber: '+639170000001', channelUrls: [] },
      { ...agent, id: 'AGT-B', archived: true, contactNumber: '+639170000001', channelUrls: [] },
    ];
    expect(duplicateAgentContacts(agents)).toEqual([]);
  });

  it('flags high SIM fan-out for review without treating every shared number as invalid', () => {
    const flagged = simFanOutReview(seed.socialAccounts);
    expect(flagged.length).toBeGreaterThan(0);
    for (const f of flagged) expect(f.accounts.length).toBeGreaterThan(DEFAULT_THRESHOLDS.simFanOutReviewThreshold);

    const sharedByTwo = seed.socialAccounts.filter((a) => a.simIds.length > 0);
    expect(sharedByTwo.length).toBeGreaterThan(flagged.flatMap((f) => f.accounts).length);
  });
});

describe('assignment conflicts', () => {
  const base = seed.assignments.find((a) => a.active && a.role === 'Primary Custodian')!;

  it('rejects a second active primary custodian for the same resource', () => {
    const r = checkAssignmentConflict(seed.assignments, {
      resourceType: base.resourceType, resourceId: base.resourceId, role: 'Primary Custodian',
    });
    expect(r.conflict).toBe(true);
    expect(r.existing?.id).toBe(base.id);
  });

  it('allows collaborators alongside a primary custodian', () => {
    const r = checkAssignmentConflict(seed.assignments, {
      resourceType: base.resourceType, resourceId: base.resourceId, role: 'Collaborator',
    });
    expect(r.conflict).toBe(false);
  });

  it('allows a new custodian once the previous assignment is closed', () => {
    const closed = seed.assignments.map((a) => (a.id === base.id ? { ...a, active: false } : a));
    const r = checkAssignmentConflict(closed, {
      resourceType: base.resourceType, resourceId: base.resourceId, role: 'Primary Custodian',
    });
    expect(r.conflict).toBe(false);
  });
});

describe('domain rules', () => {
  it('buckets expiry correctly and covers every bucket in the seed data', () => {
    const buckets = new Set(seed.domains.map(domainExpiryBucket));
    expect(buckets).toContain('expired');
    expect(buckets).toContain('expiring-7');
    expect(buckets).toContain('expiring-30');
    expect(buckets).toContain('healthy');
  });

  it('expiry highlighting is independent of Active/Inactive status', () => {
    const expired = seed.domains.filter((d) => domainExpiryBucket(d) === 'expired');
    expect(expired.some((d) => d.status === 'Active')).toBe(true);
  });

  it('never stores an expiration before registration', () => {
    for (const d of seed.domains) expect(d.expirationDate >= d.registeredDate).toBe(true);
  });

  it('stores unique, normalised domain names', () => {
    const names = seed.domains.map((d) => d.domainName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toBe(n.toLowerCase());
  });

  it('normalises scheme, www and trailing path away', () => {
    expect(normalizeDomain('HTTPS://WWW.Example.CO.IN/path?x=1')).toBe('example.co.in');
    expect(normalizeDomain('  Example.ID.  ')).toBe('example.id');
  });

  it('seeds both India and Indonesia', () => {
    expect(seed.domains.some((d) => d.targetCountry === 'India')).toBe(true);
    expect(seed.domains.some((d) => d.targetCountry === 'Indonesia')).toBe(true);
  });
});

describe('phone normalisation used by search, dedupe and import', () => {
  it('reduces common input shapes to one E.164 form', () => {
    expect(normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(normalizePhone('0091-98765-43210')).toBe('+919876543210');
    expect(normalizePhone('(91) 98765.43210')).toBe('+919876543210');
    expect(normalizePhone('')).toBe('');
  });
});

describe('CSV export excludes credential material', () => {
  it('recognises secret-bearing column names', () => {
    for (const name of ['password', 'Pass Phrase', 'api_key', 'session_cookie', 'recovery-code', 'backup codes', 'OTP', 'private_key']) {
      expect(isForbiddenColumn(name)).toBe(true);
    }
    for (const name of ['username', 'brand', 'last verified', 'vault reference present']) {
      expect(isForbiddenColumn(name)).toBe(false);
    }
  });

  it('drops forbidden columns even if a caller passes them', () => {
    const csv = toCSV([{ a: '1', password: 'hunter2' }], [
      { key: 'a', header: 'A', value: (r) => r.a },
      { key: 'password', header: 'Password', value: (r) => r.password },
    ]);
    expect(csv).toContain('A');
    expect(csv).not.toContain('Password');
    expect(csv).not.toContain('hunter2');
  });

  it('neutralises spreadsheet formula injection', () => {
    const csv = toCSV([{ v: '=SUM(A1:A9)' }], [{ key: 'v', header: 'V', value: (r) => r.v }]);
    expect(csv).toContain("'=SUM(A1:A9)");
  });

  it('round-trips quoted cells containing commas and newlines', () => {
    const csv = toCSV([{ v: 'a,b\nc "quoted"' }], [{ key: 'v', header: 'V', value: (r) => r.v }]);
    expect(parseCSV(csv)[1][0]).toBe('a,b\nc "quoted"');
  });
});

describe('the synthetic dataset is internally consistent', () => {
  it('every credential reference points at an existing account, and vice versa', () => {
    const accountIds = new Set(seed.socialAccounts.map((a) => a.id));
    for (const c of seed.credentials) expect(accountIds.has(c.resourceId)).toBe(true);

    const credIds = new Set(seed.credentials.map((c) => c.id));
    for (const a of seed.socialAccounts) {
      if (a.credentialId) expect(credIds.has(a.credentialId)).toBe(true);
    }
  });

  it('every assignment points at a resource that exists', () => {
    const sims = new Set(seed.sims.map((s) => s.id));
    const accounts = new Set(seed.socialAccounts.map((a) => a.id));
    for (const a of seed.assignments) {
      const pool = a.resourceType === 'SIM' ? sims : accounts;
      expect(pool.has(a.resourceId)).toBe(true);
    }
  });

  it('every account SIM link points at a real SIM', () => {
    const sims = new Set(seed.sims.map((s) => s.id));
    for (const a of seed.socialAccounts) for (const id of a.simIds) expect(sims.has(id)).toBe(true);
  });

  it('follower counts always carry a measurement date when present', () => {
    for (const a of seed.socialAccounts) {
      if (a.followerCount !== null) expect(a.followerCountMeasuredAt).not.toBeNull();
    }
  });

  it('holds no field that looks like a stored secret', () => {
    const blob = JSON.stringify({
      accounts: seed.socialAccounts, credentials: seed.credentials,
      assignments: seed.assignments, audit: seed.auditEntries, sims: seed.sims,
    });
    for (const key of ['"password"', '"token"', '"secret"', '"cookie"', '"recoveryCode"', '"backupCodes"', '"otp"']) {
      expect(blob).not.toContain(key);
    }
  });
});

describe('previous assignee on a new assignment', () => {
  const held = seed.assignments.find(
    (a) => a.active && a.role === 'Primary Custodian' && a.resourceType === 'Social Account',
  )!;

  it('is never set for a collaborator — they replace nobody', () => {
    expect(previousCustodianFor(seed.assignments, 'Social Account', held.resourceId, 'Collaborator')).toBeNull();
  });

  it('is the outgoing custodian when one is taking over', () => {
    const prev = previousCustodianFor(seed.assignments, 'Social Account', held.resourceId, 'Primary Custodian');
    expect(prev?.id).toBe(held.id);
  });

  it('still resolves after the previous assignment has been returned', () => {
    const closed = seed.assignments.map((a) => (a.id === held.id ? { ...a, active: false } : a));
    const prev = previousCustodianFor(closed, 'Social Account', held.resourceId, 'Primary Custodian');
    expect(prev?.id).toBe(held.id);
    expect(prev?.newAssigneeId).toBe(held.newAssigneeId);
  });

  it('is null for a resource nobody has held', () => {
    expect(previousCustodianFor(seed.assignments, 'Social Account', 'ACC-9999', 'Primary Custodian')).toBeNull();
  });

  it('picks the most recent custodian when a resource has changed hands', () => {
    const older = { ...held, id: 'ASG-9001', startDate: '2020-01-01', active: false };
    const newer = { ...held, id: 'ASG-9002', startDate: '2026-01-01', active: false };
    const prev = previousCustodianFor([older, newer], 'Social Account', held.resourceId, 'Primary Custodian');
    expect(prev?.id).toBe('ASG-9002');
  });
});
