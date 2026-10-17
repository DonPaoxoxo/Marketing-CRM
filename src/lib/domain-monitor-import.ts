/** Reading pasted domain URLs for the Bulk Add Domains modal — one rule for
 *  the browser preview and the server commit, the same way lead-import.ts and
 *  domain-import.ts work. Deliberately not a CSV/sheet import: the modal is a
 *  plain "one URL per line" textarea, since there is only one real column —
 *  domain category and notes are chosen once for the whole paste, same
 *  reasoning as Data Leads' Country/Platform/Niche.
 *
 *  Pure: no DOM, no database. */

import { DOMAIN_PATTERN, normalizeDomain } from './utils';

export interface DomainLineResult {
  line: number;
  raw: string;
  domainName: string | null;
  problem: string | null;
}

/** Splits pasted text into domain lines: trims, drops blank lines. Does not
 *  validate — that is validateDomainLines, which needs the existing-register
 *  set too. */
export function splitDomainLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
}

/** Validates one pasted list against the live register and against itself —
 *  a domain repeated in the paste is caught on its second line, the same way
 *  a domain already in the register is refused rather than duplicated. */
export function validateDomainLines(lines: readonly string[], existing: ReadonlySet<string>): DomainLineResult[] {
  const seen = new Set<string>();
  return lines.map((raw, i) => {
    const domainName = normalizeDomain(raw);
    let problem: string | null = null;
    if (!domainName || !DOMAIN_PATTERN.test(domainName)) {
      problem = 'Not a valid domain.';
    } else if (existing.has(domainName)) {
      problem = 'Already in the register.';
    } else if (seen.has(domainName)) {
      problem = 'Duplicated earlier in this list.';
    }
    if (!problem) seen.add(domainName);
    return { line: i + 1, raw, domainName: problem ? null : domainName, problem };
  });
}
