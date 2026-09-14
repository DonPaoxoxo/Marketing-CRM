/** Deciding how the countries table should change to match the configured list.
 *
 *  Pure, so the rule that matters most is testable without a database: a
 *  country still in use is never removed. SIMs would block the delete outright,
 *  but social accounts would *silently lose* their target country (that foreign
 *  key is ON DELETE SET NULL) — so every reference is counted first, and a
 *  country anything points at is reported and kept, never quietly stripped. */

import type { Country } from '../../src/lib/types';

export interface CountryUsage {
  sims: number;
  brands: number;
  accounts: number;
}

export interface CountrySyncPlan {
  /** Configured countries: inserted if missing, name and dial code refreshed if present. */
  upsert: Country[];
  /** No longer configured and referenced by nothing — safe to delete. */
  remove: string[];
  /** No longer configured but still referenced — kept, and reported. */
  blocked: { code: string; usage: CountryUsage }[];
}

const inUse = (u: CountryUsage | undefined) => Boolean(u && (u.sims || u.brands || u.accounts));

export function planCountrySync(
  configured: readonly Country[],
  existingCodes: readonly string[],
  usage: ReadonlyMap<string, CountryUsage>,
): CountrySyncPlan {
  const wanted = new Set(configured.map((c) => c.code));
  const plan: CountrySyncPlan = { upsert: [...configured], remove: [], blocked: [] };

  for (const code of existingCodes) {
    if (wanted.has(code)) continue;
    const u = usage.get(code);
    if (inUse(u)) plan.blocked.push({ code, usage: u! });
    else plan.remove.push(code);
  }
  return plan;
}

export function describeUsage(u: CountryUsage): string {
  const parts = [
    u.sims && `${u.sims} SIM${u.sims === 1 ? '' : 's'}`,
    u.brands && `${u.brands} brand${u.brands === 1 ? '' : 's'}`,
    u.accounts && `${u.accounts} account${u.accounts === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.join(', ');
}
