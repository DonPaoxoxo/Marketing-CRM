import { describe, expect, it } from 'vitest';
import { countries } from '../mocks/seed';
import {
  addTaken, cellText, mapSimHeaders, noneTaken, readSheetDate, readSimNumber, validateSimRow, validateSimSheet,
} from './sim-import';

const PH = countries.find((c) => c.code === 'PH')!;
const IN = countries.find((c) => c.code === 'IN')!;
const ctx = (over: Partial<Parameters<typeof validateSimRow>[1]> = {}) => ({
  countries, fallbackCountryCode: 'PH', existing: noneTaken(), seen: noneTaken(), ...over,
});

/** The team's real header row. */
const HEADER = ['No.', 'SIM Number', 'Created For', 'Email', 'Telegram Username', 'Status', 'Date Checked', 'Others', 'Remarks'];

describe('headers', () => {
  it('recognises the team sheet exactly as it is', () => {
    const { columns, missing } = mapSimHeaders(HEADER);
    expect(missing).toEqual([]);
    expect(columns).toEqual({
      no: 0, phoneNumber: 1, createdFor: 2, email: 3, telegramUsername: 4, status: 5, dateChecked: 6, others: 7, remarks: 8,
    });
  });

  it('needs only the SIM Number column', () => {
    expect(mapSimHeaders(['No.', 'Remarks']).missing.map((c) => c.header)).toEqual(['SIM Number']);
    expect(mapSimHeaders(['SIM Number']).missing).toEqual([]);
  });
});

describe('SIM numbers', () => {
  it.each([
    '639175550420',   // the sheet's form
    '+639175550420', '00639175550420', '+63 917 555 0420',
    '09175550420',    // local
    '9175550420',     // Excel dropped the leading 0 (the first version of the sheet)
  ])('%s is +639175550420 in the Philippines', (raw) => {
    expect(readSimNumber(raw, countries, PH)).toEqual({ e164: '+639175550420', country: PH });
  });

  it('works out the country from the number, whatever the fallback', () => {
    expect(readSimNumber('639175550420', countries, IN)).toEqual({ e164: '+639175550420', country: PH });
    expect(readSimNumber('923001234567', countries, PH)).toMatchObject({ e164: '+923001234567', country: { code: 'PK' } });
  });

  it('does not mistake an Indian local number beginning 91 for a country code', () => {
    expect(readSimNumber('9112345678', countries, IN)).toEqual({ e164: '+919112345678', country: IN });
  });

  it('refuses rather than guesses', () => {
    expect(readSimNumber('12345', countries, PH)).toHaveProperty('error');
    expect(readSimNumber('9175550420', countries, null)).toHaveProperty('error');
    expect(readSimNumber('+84912345678', countries, PH)).toEqual({ error: expect.stringContaining('not one of this workspace') });
    expect(readSimNumber('0964-ABC', countries, PH)).toHaveProperty('error');
  });

  it('keeps a long number whole, as Excel returns it', () => {
    expect(cellText(639175550420)).toBe('639175550420');
  });
});

describe('dates', () => {
  const today = new Date('2026-09-13T12:00:00Z');
  it('reads date cells and the two typed forms', () => {
    expect(readSheetDate('2026-09-13', today)).toEqual({ date: '2026-09-13' });
    expect(readSheetDate('9/13/2026', today)).toEqual({ date: '2026-09-13' });
    expect(readSheetDate('', today)).toEqual({ date: null });
  });
  it('refuses the ambiguous, the impossible and the future', () => {
    expect(readSheetDate('13-09-2026', today)).toHaveProperty('error');
    expect(readSheetDate('2/30/2026', today)).toHaveProperty('error');
    expect(readSheetDate('9/14/2026', today)).toHaveProperty('error');
  });
});

describe('validateSimRow — the team’s own rows', () => {
  it('row 1: Email + Telegram, active', () => {
    const r = validateSimRow({
      no: '1', phoneNumber: '639175550420', createdFor: 'Email + Telegram', email: 'samplea001@gmail.com',
      telegramUsername: '@demouser', status: 'Active', remarks: 'DEV TG',
    }, ctx());
    expect(r).toEqual({
      value: {
        phoneNumber: '+639175550420', countryCode: 'PH', provider: '', form: 'Physical SIM',
        createdFor: 'Email + Telegram', email: 'samplea001@gmail.com', telegramUsername: 'demouser',
        operationalStatus: 'Active', allocationStatus: 'Available', lastVerifiedDate: null, notes: 'DEV TG',
      },
      problems: [],
    });
  });

  it('row 4: Dead / Patay is saved as Inactive', () => {
    const r = validateSimRow({ phoneNumber: '639175553878', createdFor: 'Email', email: 'sampleperson0002@gmail.com', status: 'Dead / Patay', remarks: 'dead' }, ctx());
    expect(r.value).toMatchObject({ operationalStatus: 'Inactive', createdFor: 'Email', telegramUsername: '' });
  });

  it('a row with only a number is fine; blanks take the defaults', () => {
    const r = validateSimRow({ phoneNumber: '639175554627' }, ctx());
    expect(r.value).toMatchObject({ createdFor: '', email: '', telegramUsername: '', operationalStatus: 'Active', notes: '' });
  });

  it('keeps Others alongside Remarks in the notes', () => {
    const r = validateSimRow({ phoneNumber: '639175556422', createdFor: 'Other', others: 'Facebook page', remarks: 'Timon FB' }, ctx());
    expect(r.value?.notes).toBe('Timon FB\nOthers: Facebook page');
  });

  it('refuses a number, email or Telegram username already on a SIM', () => {
    const existing = noneTaken();
    addTaken(existing, { phoneNumber: '+639175550420', email: 'samplea001@gmail.com', telegramUsername: 'demouser' });
    const r = validateSimRow({ phoneNumber: '9175550420', email: 'SampleA001@Gmail.com', telegramUsername: '@DemoUser' }, ctx({ existing }));
    expect(r.problems.map((p) => p.column)).toEqual(['SIM Number', 'Email', 'Telegram Username']);
    expect(r.problems[0].message).toContain('never overwritten');
  });

  it('reports every problem in a row at once, by the sheet’s column names', () => {
    const r = validateSimRow({
      phoneNumber: '123', createdFor: 'x'.repeat(81), email: 'not-an-email', telegramUsername: '@ab', status: 'Sleeping', dateChecked: '31/02/2026',
    }, ctx());
    expect(r.value).toBeNull();
    expect(r.problems.map((p) => p.column)).toEqual(['SIM Number', 'Created For', 'Email', 'Telegram Username', 'Status', 'Date Checked']);
  });
});

describe('validateSimSheet — the team sheet', () => {
  it('reads the real layout, skips rows holding only a No., and catches repeats', () => {
    const sheet = [
      HEADER,
      [1, '639175550420', 'Email + Telegram', 'samplea001@gmail.com', '@demouser', 'Active', null, null, 'DEV TG'],
      [2, 639175551386, 'Email + Telegram', 'sampleperson418@gmail.com', '@demo_user_418', 'Active', null, null, 'DEV TG'],
      [3, null, null, null, null, null, null, null, null],
      [4, '639175553878', 'Email', 'sampleperson0002@gmail.com', null, 'Dead / Patay', null, null, 'dead'],
      [5, '639175550420', 'Telegram', null, '@demouser', 'Active', null, null, 'repeat'],
    ];
    const { rows, missingColumns } = validateSimSheet(sheet, { countries, fallbackCountryCode: 'PH', existing: noneTaken() });
    expect(missingColumns).toEqual([]);
    expect(rows.map((r) => r.rowNumber)).toEqual([2, 3, 5, 6]);
    expect(rows[1].result.value?.phoneNumber).toBe('+639175551386');
    expect(rows[2].result.value?.operationalStatus).toBe('Inactive');
    expect(rows[3].result.problems.map((p) => p.column)).toEqual(['SIM Number', 'Telegram Username']);
  });

  it('stops at the row limit rather than reading an enormous sheet', () => {
    const sheet = [['SIM Number'], ...Array.from({ length: 5001 }, (_, i) => [`6396486${String(i).padStart(5, '0')}`])];
    expect(validateSimSheet(sheet, { countries, fallbackCountryCode: 'PH', existing: noneTaken() }).tooManyRows).toBe(true);
  });
});

describe('Created For with a custom purpose', () => {
  it('keeps the presets however they are spelled, and takes any other purpose as written', async () => {
    const { readCreatedFor } = await import('./sim-import');
    expect(readCreatedFor('email + telegram')).toEqual({ value: 'Email + Telegram' });
    expect(readCreatedFor('TG')).toEqual({ value: 'Telegram' });
    expect(readCreatedFor('Serper')).toEqual({ value: 'Serper' });
    expect(readCreatedFor(' twilio ')).toEqual({ value: 'Twilio' });
    expect(readCreatedFor('Discord')).toEqual({ value: 'Discord' });
    expect(readCreatedFor('Other')).toEqual({ value: 'Other' });
    expect(readCreatedFor('')).toEqual({ value: '' });
    expect(readCreatedFor('x'.repeat(81))).toHaveProperty('error');
  });

  it('accepts a custom purpose in a sheet row', () => {
    const r = validateSimRow({ phoneNumber: '639175556499', createdFor: 'Serper' }, ctx());
    expect(r.value?.createdFor).toBe('Serper');
  });
});
