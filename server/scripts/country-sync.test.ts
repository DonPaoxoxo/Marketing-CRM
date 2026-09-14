import { describe, expect, it } from 'vitest';
import { countries } from '../../src/mocks/seed';
import { describeUsage, planCountrySync, type CountryUsage } from './country-sync';

const none: CountryUsage = { sims: 0, brands: 0, accounts: 0 };

describe('the shipped country list', () => {
  it('is exactly India, Indonesia, Pakistan and Philippines', () => {
    expect(countries.map((c) => `${c.code} ${c.dialCode}`).sort()).toEqual(['ID +62', 'IN +91', 'PH +63', 'PK +92']);
  });
});

describe('planCountrySync', () => {
  const live = ['BD', 'IN', 'ID', 'PH', 'AE', 'GB', 'VN'];

  it('adds what is new and removes what is unused', () => {
    const plan = planCountrySync(countries, live, new Map());
    expect(plan.upsert.map((c) => c.code)).toContain('PK');
    expect(plan.remove.sort()).toEqual(['AE', 'BD', 'GB', 'VN']);
    expect(plan.blocked).toEqual([]);
  });

  it('never removes a country a record still uses', () => {
    // An account's target country would otherwise be silently nulled, because
    // that foreign key is ON DELETE SET NULL rather than RESTRICT.
    const usage = new Map<string, CountryUsage>([
      ['VN', { ...none, accounts: 2 }],
      ['AE', { ...none, sims: 1, brands: 1 }],
    ]);
    const plan = planCountrySync(countries, live, usage);
    expect(plan.remove.sort()).toEqual(['BD', 'GB']);
    expect(plan.blocked.map((b) => b.code).sort()).toEqual(['AE', 'VN']);
  });

  it('keeps configured countries even when unused', () => {
    const plan = planCountrySync(countries, ['IN', 'PH'], new Map([['PH', { ...none, sims: 1 }]]));
    expect(plan.remove).toEqual([]);
    expect(plan.blocked).toEqual([]);
  });

  it('says what is blocking a removal in words', () => {
    expect(describeUsage({ sims: 1, brands: 0, accounts: 3 })).toBe('1 SIM, 3 accounts');
  });
});
