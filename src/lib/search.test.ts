import { describe, expect, it } from 'vitest';
import * as seed from '@/mocks/fixtures';
import { searchRecords, type SearchCorpus } from './search';

const corpus: SearchCorpus = {
  sims: seed.sims,
  socialAccounts: seed.socialAccounts,
  agents: seed.agents,
  domains: seed.domains,
  brands: seed.brands,
  pages: [{ to: '/domains', label: 'Domains', description: 'Domain register' }],
};

const lookups = { platformName: (id: string) => seed.platforms.find((p) => p.id === id)?.name ?? id };
const run = (q: string, showContact = true) => searchRecords(corpus, q, { lookups, showContact });

describe('a text query never matches records through the phone field', () => {
  it('returns only the agents whose name actually matches', () => {
    const hits = run('ananya').filter((h) => h.group === 'Agents');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThan(seed.agents.length);
    expect(hits.every((h) => h.title.toLowerCase().includes('ananya'))).toBe(true);
  });

  it('does not pull in every agent for an unrelated word', () => {
    // Regression: an empty digit-needle made `contactNumber.includes('')` true for all agents.
    const hits = run('telegram').filter((h) => h.group === 'Agents');
    expect(hits).toHaveLength(0);
  });

  it('ignores a query with too few digits to be a number', () => {
    const hits = run('7');
    expect(hits).toHaveLength(0); // below the 2-character minimum anyway
    const short = run('91').filter((h) => h.group === 'Agents' || h.group === 'SIMs');
    // "91" is only 2 digits — below the phone threshold, so no phone-based matches.
    expect(short.every((h) => h.title.includes('91') || h.subtitle.includes('91'))).toBe(true);
  });
});

describe('phone search still works once the query looks like a number', () => {
  it('finds a SIM by its full number', () => {
    const target = seed.sims[0];
    const hits = run(target.phoneNumber).filter((h) => h.group === 'SIMs');
    expect(hits.some((h) => h.subtitle.startsWith(target.id))).toBe(true);
  });

  it('finds a SIM from a spaced, human-typed number', () => {
    const target = seed.sims[1];
    const spaced = `${target.phoneNumber.slice(0, 3)} ${target.phoneNumber.slice(3, 8)} ${target.phoneNumber.slice(8)}`;
    const hits = run(spaced).filter((h) => h.group === 'SIMs');
    expect(hits.some((h) => h.subtitle.startsWith(target.id))).toBe(true);
  });

  it('finds an agent by their contact number', () => {
    const target = seed.agents.find((a) => a.contactNumber.length > 8)!;
    const hits = run(target.contactNumber).filter((h) => h.group === 'Agents');
    expect(hits.some((h) => h.title === target.name)).toBe(true);
  });
});

describe('search respects the contact-detail permission', () => {
  it('masks SIM numbers for a role that may not see them', () => {
    const target = seed.sims[0];
    const masked = run(target.id, false).find((h) => h.group === 'SIMs');
    expect(masked?.title).not.toBe(target.phoneNumber);
    expect(masked?.title).toContain('•');
  });
});

describe('query floor and result cap', () => {
  it('returns nothing below the minimum query length', () => {
    expect(run('')).toHaveLength(0);
    expect(run('a')).toHaveLength(0);
  });

  it('caps the number of hits', () => {
    expect(run('a').length).toBeLessThanOrEqual(40);
    expect(run('e').length).toBeLessThanOrEqual(40);
  });
});

describe('other registers match on their own fields', () => {
  it('finds domains by name and brands by code', () => {
    const domain = seed.domains[0];
    expect(run(domain.domainName).some((h) => h.group === 'Domains')).toBe(true);
    expect(run('AUR').some((h) => h.group === 'Brands')).toBe(true);
  });

  it('finds accounts by handle', () => {
    const acc = seed.socialAccounts[0];
    expect(run(acc.username).some((h) => h.group === 'Social accounts')).toBe(true);
  });
});
