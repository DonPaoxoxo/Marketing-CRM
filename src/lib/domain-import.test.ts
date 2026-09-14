import { describe, expect, it } from 'vitest';
import {
  checkDomainExtras, domainSheetChanges, domainUpdateFields, mapDomainHeaders, readNameservers, validateDomainRow, validateDomainSheet,
} from './domain-import';
import { readSheetDate } from './sheet';

const today = new Date('2026-09-13T12:00:00Z');
const ctx = (over: Partial<Parameters<typeof validateDomainRow>[1]> = {}) => ({
  existing: new Set<string>(), seen: new Set<string>(), today, ...over,
});

/** The team's real header row, from the registrar export. */
const HEADER = ['Domain', 'Country', 'UID', 'Registration Time', 'Expire Date', 'Registrar', 'Status', 'Category', 'Nameservers'];

describe('headers', () => {
  it('recognises the registrar export exactly as it is', () => {
    expect(mapDomainHeaders(HEADER)).toEqual({
      columns: { domain: 0, country: 1, uid: 2, registrationTime: 3, expireDate: 4, registrar: 5, status: 6, category: 7, nameservers: 8 },
      missing: [],
    });
  });

  it('names what is missing', () => {
    expect(mapDomainHeaders(['Domain', 'Registrar']).missing.map((c) => c.header))
      .toEqual(['Country', 'Registration Time', 'Expire Date']);
  });
});

describe('dates with a time, as the export writes them', () => {
  it('keeps the date and drops the time', () => {
    expect(readSheetDate('9/8/2026 14:40', today)).toEqual({ date: '2026-09-08' });
    expect(readSheetDate('9/8/2027 14:40', today, { allowFuture: true })).toEqual({ date: '2027-09-08' });
    expect(readSheetDate('2026-09-08 14:40:00', today)).toEqual({ date: '2026-09-08' });
  });
});

describe('nameservers', () => {
  it('normalises the export’s comma list', () => {
    expect(readNameservers('chad.ns.cloudflare.com,clarissa.ns.cloudflare.com'))
      .toEqual({ value: 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com' });
    expect(readNameservers(' A5.Share-DNS.com. ; b5.share-dns.net, a5.share-dns.com ')).toEqual({ value: 'a5.share-dns.com,b5.share-dns.net' });
    expect(readNameservers('')).toEqual({ value: '' });
    expect(readNameservers('not a host')).toHaveProperty('error');
  });
});

describe('validateDomainRow — the team’s own rows', () => {
  it('row 1: samplegamehub.com, India', () => {
    expect(validateDomainRow({
      domain: 'samplegamehub.com', country: 'India', uid: '241089', registrationTime: '9/8/2026 14:40', expireDate: '9/8/2027 14:40',
      registrar: 'RealTime', status: 'OK', category: 'Ungrouped', nameservers: 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com',
    }, ctx())).toEqual({
      value: {
        domainName: 'samplegamehub.com', targetCountry: 'India', registeredDate: '2026-09-08', expirationDate: '2027-09-08',
        status: 'Active', registrar: 'RealTime', registrarUid: '241089', category: 'Ungrouped',
        nameservers: 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com',
      },
      problems: [],
    });
  });

  it('accepts Available and the two-letter codes', () => {
    for (const [text, country] of [['Available', 'Available'], ['available', 'Available'], ['ID', 'Indonesia'], ['in', 'India']]) {
      const r = validateDomainRow({ domain: 'goldsample.site', country: text, registrationTime: '8/11/2026', expireDate: '8/11/2027' }, ctx());
      expect(r.value?.targetCountry).toBe(country);
    }
  });

  it('requires a country, as the team fills every one in', () => {
    const r = validateDomainRow({ domain: 'goldsample.site', country: '', registrationTime: '8/11/2026', expireDate: '8/11/2027' }, ctx());
    expect(r.problems).toEqual([{ column: 'Country', message: expect.stringContaining('India, Indonesia, Available') }]);
    expect(validateDomainRow({ domain: 'sampleofficial.com', country: 'Pakistan', registrationTime: '8/17/2026', expireDate: '8/17/2027' }, ctx()).value).toBeNull();
  });

  it('maps registrar states onto Active and Inactive', () => {
    const base = { domain: 'dhangame.site', country: 'Available', registrationTime: '7/21/2026', expireDate: '7/21/2027' };
    expect(validateDomainRow({ ...base, status: 'clientTransferProhibited' }, ctx()).value?.status).toBe('Active');
    expect(validateDomainRow({ ...base, status: 'ClientHold' }, ctx()).value?.status).toBe('Inactive');
    expect(validateDomainRow({ ...base, status: 'Pending Delete' }, ctx()).value?.status).toBe('Inactive');
    expect(validateDomainRow({ ...base, status: 'Sleeping' }, ctx()).problems[0].column).toBe('Status');
  });

  it('refuses a domain already registered, however it is written', () => {
    const r = validateDomainRow({ domain: 'https://www.SampleCards.site/', country: 'Indonesia', registrationTime: '8/25/2026', expireDate: '8/25/2027' },
      ctx({ existing: new Set(['samplecards.site']) }));
    expect(r.problems[0].message).toContain('already in the register');
  });

  it('reports every problem in a row at once', () => {
    const r = validateDomainRow({ domain: 'not a domain', country: 'Mars', registrationTime: '9/14/2026', expireDate: '13/40/2026', status: 'weird', nameservers: 'bad host' }, ctx());
    expect(r.problems.map((p) => p.column)).toEqual(['Domain', 'Country', 'Registration Time', 'Expire Date', 'Status', 'Nameservers']);
  });

  it('refuses an expiry before the registration', () => {
    const r = validateDomainRow({ domain: 'demolink.com', country: 'India', registrationTime: '6/15/2026', expireDate: '6/15/2025' }, ctx());
    expect(r.problems).toEqual([{ column: 'Expire Date', message: 'Cannot be before the registration date.' }]);
  });
});

describe('updating domains already in the register', () => {
  const row = { domain: 'samplecards.site', country: 'Indonesia', registrationTime: '8/25/2026', expireDate: '8/25/2027', status: 'ClientHold', registrar: '', nameservers: '' };

  it('accepts an existing name only when updating was chosen, and never an archived one', () => {
    const existing = new Set(['samplecards.site']);
    expect(validateDomainRow(row, ctx({ existing })).problems[0].message).toContain('already in the register');
    expect(validateDomainRow(row, ctx({ existing, overwrite: true })).problems).toEqual([]);
    expect(validateDomainRow(row, ctx({ existing, overwrite: true, archived: existing })).problems[0].message).toContain('archived');
  });

  it('replaces filled cells, keeps the current value for blank ones, and lists only real changes', () => {
    const { value } = validateDomainRow(row, ctx({ existing: new Set(['samplecards.site']), overwrite: true }));
    const fields = domainUpdateFields(row, value!);
    expect(fields).toEqual({ targetCountry: 'Indonesia', registeredDate: '2026-08-25', expirationDate: '2027-08-25', status: 'Inactive' });
    const before = { targetCountry: 'India', registeredDate: '2026-08-25', expirationDate: '2026-12-01', status: 'Active', registrar: 'Gname', nameservers: 'a.ns.com' };
    expect(domainSheetChanges(before, fields)).toEqual([
      { field: 'targetCountry', from: 'India', to: 'Indonesia' },
      { field: 'expirationDate', from: '2026-12-01', to: '2027-08-25' },
      { field: 'status', from: 'Active', to: 'Inactive' },
    ]);
  });
});

describe('validateDomainSheet — the registrar export', () => {
  it('reads the real layout with Excel date cells and numeric UIDs, and catches repeats', () => {
    const sheet = [
      HEADER,
      ['samplegamehub.com', 'India', 241089, new Date('2026-09-08T14:40:00Z'), new Date('2027-09-08T14:40:00Z'), 'RealTime', 'OK', 'Ungrouped', 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com'],
      ['samplecards.site', 'Indonesia', 241089, '8/25/2026 12:46', '8/25/2027 12:46', 'Gname', 'OK', 'Ungrouped', 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com'],
      [null, null, null, null, null, null, null, null, null],
      ['demowiki.com', 'Available', 241089, '7/13/2026 22:07', '7/13/2027 22:07', 'RealTime', 'OK', 'Ungrouped', 'a5.share-dns.com,b5.share-dns.net'],
      ['SampleCards.site', 'India', 241089, '8/25/2026 12:46', '8/25/2027 12:46', 'Gname', 'OK', 'Ungrouped', ''],
    ];
    const { rows, missingColumns } = validateDomainSheet(sheet, { existing: new Set(), today });
    expect(missingColumns).toEqual([]);
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3, 5, 6]);
    expect(rows[0].result.value).toMatchObject({ registeredDate: '2026-09-08', registrarUid: '241089' });
    expect(rows[2].result.value).toMatchObject({ targetCountry: 'Available', nameservers: 'a5.share-dns.com,b5.share-dns.net' });
    expect(rows[3].result.problems[0].message).toContain('earlier in this file');
  });
});

describe('checkDomainExtras', () => {
  it('normalises nameservers on a single save and refuses a bad one', () => {
    expect(checkDomainExtras({ nameservers: 'CHAD.ns.cloudflare.com, clarissa.ns.cloudflare.com' }))
      .toEqual({ value: { nameservers: 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com' } });
    expect(checkDomainExtras({ nameservers: 'oops' })).toEqual({ field: 'nameservers', message: expect.any(String) });
    expect(checkDomainExtras({ registrarUid: 241089 })).toEqual({ value: { registrarUid: '241089' } });
  });

  it('holds a single save to the allowed countries', () => {
    expect(checkDomainExtras({ targetCountry: 'Available' })).toEqual({ value: { targetCountry: 'Available' } });
    expect(checkDomainExtras({ targetCountry: 'Pakistan' })).toEqual({ field: 'targetCountry', message: expect.stringContaining('Available') });
  });
});
