/** Authorised internal search across the registers.
 *
 *  Extracted from the global-search component so the matching rules are testable
 *  on their own — they are easy to get subtly wrong (see the digit-guard below). */

import type { Agent, Brand, CompetitorRecord, DomainRecord, Sim, SocialAccount } from './types';
import { maskPhone, normalizePhone } from './utils';

export interface SearchHit {
  id: string;
  group: 'SIMs' | 'Social accounts' | 'Agents' | 'Domains' | 'Pakistan Competitors' | 'Brands' | 'Pages';
  title: string;
  subtitle: string;
  to: string;
}

export interface SearchCorpus {
  sims: Sim[];
  socialAccounts: SocialAccount[];
  agents: Agent[];
  domains: DomainRecord[];
  pakistanCompetitors: CompetitorRecord[];
  brands: Brand[];
  pages: { to: string; label: string; description: string }[];
}

export interface SearchLookups {
  platformName: (id: string) => string;
}

export const MIN_QUERY_LENGTH = 2;
export const MAX_HITS = 40;

/** A phone match only makes sense once the query has enough digits to be a number.
 *  Without this guard `''.includes` matches every record and floods the results. */
const PHONE_MIN_DIGITS = 4;

function phoneNeedle(query: string): string | null {
  const digits = normalizePhone(query).replace(/^\+/, '');
  return digits.length >= PHONE_MIN_DIGITS ? digits : null;
}

export function searchRecords(
  corpus: SearchCorpus,
  query: string,
  { lookups, showContact = true }: { lookups: SearchLookups; showContact?: boolean },
): SearchHit[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) return [];

  const digits = phoneNeedle(query);
  const out: SearchHit[] = [];
  const hit = (h: SearchHit) => {
    if (out.length < MAX_HITS) out.push(h);
  };
  const has = (value: string | null | undefined) => String(value ?? '').toLowerCase().includes(needle);
  const phoneMatches = (value: string) => digits !== null && value.replace(/^\+/, '').includes(digits);

  corpus.sims.forEach((s) => {
    if (has(s.id) || has(s.phoneNumber) || has(s.provider) || phoneMatches(s.phoneNumber)) {
      hit({
        id: s.id,
        group: 'SIMs',
        title: showContact ? s.phoneNumber : maskPhone(s.phoneNumber),
        subtitle: `${s.id} · ${s.provider} · ${s.operationalStatus}`,
        to: `/sims/${s.id}`,
      });
    }
  });

  corpus.socialAccounts.forEach((a) => {
    if (has(a.id) || has(a.username) || has(a.displayName) || has(a.platformAccountId)) {
      hit({
        id: a.id,
        group: 'Social accounts',
        title: `@${a.username}`,
        subtitle: `${a.id} · ${lookups.platformName(a.platformId)} · ${a.displayName}`,
        to: `/accounts/${a.id}`,
      });
    }
  });

  corpus.agents.forEach((ag) => {
    if (has(ag.id) || has(ag.name) || has(ag.email) || phoneMatches(ag.contactNumber)) {
      hit({
        id: ag.id,
        group: 'Agents',
        title: ag.name,
        subtitle: `${ag.id} · ${ag.agentType} · ${ag.cooperationStatus}`,
        to: `/agents/${ag.id}`,
      });
    }
  });

  corpus.domains.forEach((d) => {
    if (has(d.id) || has(d.domainName)) {
      hit({
        id: d.id,
        group: 'Domains',
        title: d.domainName,
        subtitle: `${d.id} · ${d.targetCountry} · ${d.status}`,
        to: `/domains?search=${encodeURIComponent(d.domainName)}`,
      });
    }
  });

  corpus.pakistanCompetitors.forEach((c) => {
    if (has(c.id) || has(c.linkOrDomain) || has(c.whatsapp) || has(c.telegram)) {
      hit({
        id: c.id,
        group: 'Pakistan Competitors',
        title: c.linkOrDomain,
        subtitle: `${c.id} · ${lookups.platformName(c.platformId)}`,
        to: `/pakistan-competitors?search=${encodeURIComponent(c.linkOrDomain)}`,
      });
    }
  });

  corpus.brands.forEach((b) => {
    if (has(b.name) || has(b.code)) {
      hit({ id: b.id, group: 'Brands', title: b.name, subtitle: `${b.code} · ${b.id}`, to: `/brands/${b.id}` });
    }
  });

  corpus.pages.forEach((p) => {
    if (has(p.label)) {
      hit({ id: p.to, group: 'Pages', title: p.label, subtitle: p.description, to: p.to });
    }
  });

  return out;
}
