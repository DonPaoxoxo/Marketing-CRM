/** One-off loader for a Data Leads scrape sheet — the CLI counterpart to the
 *  Data Leads upload window, for a file too large to comfortably drive through
 *  a browser file input, or run before anyone has signed in.
 *
 *  Validates through the exact same rule as the upload (validateLeadRow), so a
 *  row this accepts is a row the upload would have accepted too, and skips —
 *  never overwrites — a channel already in the register for that platform and
 *  country.
 *
 *  Usage:
 *    tsx server/scripts/seed-data-leads.ts <file.csv> --country=IN --platform=YouTube --niche="Casino/Betting"
 *
 *  Defaults match india_casino_creator_leads_youtube_v2.csv at the repo root. */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RowDataPacket } from 'mysql2/promise';
import { closePool, execute, query, tx } from '../db/pool';
import { nextId } from '../db/ids';
import { recordAudit } from '../audit';
import { parseCSV } from '../../src/lib/csv';
import { leadChannelKey, resolvePlatform, validateLeadRow, type LeadImportKey } from '../../src/lib/lead-import';
import { sanitizeText } from '../../src/lib/sanitize';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface Args { file: string; country: string; platform: string; niche: string }

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flags = Object.fromEntries(
    argv.filter((a) => a.startsWith('--')).map((a) => {
      const [k, ...rest] = a.slice(2).split('=');
      return [k, rest.join('=')];
    }),
  );
  return {
    file: positional[0] ? path.resolve(positional[0]) : path.join(REPO_ROOT, 'india_casino_creator_leads_youtube_v2.csv'),
    country: (flags.country ?? 'IN').toUpperCase(),
    platform: flags.platform ?? 'YouTube',
    niche: flags.niche ?? 'Casino/Betting',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Reading ${args.file}…`);
  const text = await readFile(args.file, 'utf8');
  const cells = parseCSV(text);
  if (cells.length < 2) throw new Error('No data rows found in that file.');

  const header = cells[0].map((h) => h.trim());
  const body = cells.slice(1);
  // The sheet's own column order (see lead-import.ts for the matching aliases).
  const indexOf: Record<LeadImportKey, number> = {
    platform: header.findIndex((h) => /^platform$/i.test(h)),
    creator: header.findIndex((h) => /^creator$/i.test(h)),
    channelUrl: header.findIndex((h) => /^channel\s*url$/i.test(h)),
    subscribers: header.findIndex((h) => /^subscribers$/i.test(h)),
    tier: header.findIndex((h) => /^tier$/i.test(h)),
    keyword: header.findIndex((h) => /^keyword$/i.test(h)),
    promoConfidence: header.findIndex((h) => /^promo\s*confidence$/i.test(h)),
    evidenceTitle: header.findIndex((h) => /^evidence\s*video\s*title$/i.test(h)),
    evidenceUrl: header.findIndex((h) => /^evidence\s*video\s*url$/i.test(h)),
    publicEmail: header.findIndex((h) => /^public\s*email$/i.test(h)),
    publicTelegram: header.findIndex((h) => /^public\s*telegram$/i.test(h)),
    publicInstagram: header.findIndex((h) => /^public\s*instagram$/i.test(h)),
    status: header.findIndex((h) => /^status$/i.test(h)),
  };
  if (indexOf.creator === -1 || indexOf.channelUrl === -1) {
    throw new Error('The header row needs at least "Creator" and "ChannelURL" columns.');
  }

  const cell = (row: string[], key: LeadImportKey) => {
    const idx = indexOf[key];
    return idx >= 0 ? (row[idx] ?? '').trim() : '';
  };

  const { created, skipped, problems } = await tx(async (conn) => {
    const [countryRow, platformRows, existingRows] = await Promise.all([
      query<RowDataPacket>('SELECT code FROM countries WHERE code = ?', [args.country], conn),
      query<RowDataPacket>('SELECT id, name, slug FROM platforms', [], conn),
      query<RowDataPacket>('SELECT platform_id, channel_url FROM data_leads WHERE country_code = ?', [args.country], conn),
    ]);
    if (!countryRow.length) throw new Error(`"${args.country}" is not a configured country code.`);
    const platforms = platformRows.map((p) => ({ id: String(p.id), name: String(p.name), slug: String(p.slug) }));
    const defaultPlatform = resolvePlatform(args.platform, platforms);
    if (!defaultPlatform) throw new Error(`"${args.platform}" is not a configured platform.`);

    const niche = sanitizeText(args.niche, 160);
    const existing = new Set(existingRows.map((r) => leadChannelKey(args.country, String(r.platform_id), String(r.channel_url))));
    const seen = new Set<string>();

    let count = 0;
    const skippedRows: { row: number; reason: string }[] = [];

    for (const [i, row] of body.entries()) {
      const rowNumber = i + 2; // +1 for 0-index, +1 for the header row
      if (row.every((c) => !c.trim())) continue;

      const raw: Partial<Record<LeadImportKey, string>> = {
        platform: cell(row, 'platform'),
        creator: cell(row, 'creator'),
        channelUrl: cell(row, 'channelUrl'),
        subscribers: cell(row, 'subscribers'),
        tier: cell(row, 'tier'),
        keyword: cell(row, 'keyword'),
        promoConfidence: cell(row, 'promoConfidence'),
        evidenceTitle: cell(row, 'evidenceTitle'),
        evidenceUrl: cell(row, 'evidenceUrl'),
        publicEmail: cell(row, 'publicEmail'),
        publicTelegram: cell(row, 'publicTelegram'),
        publicInstagram: cell(row, 'publicInstagram'),
        status: cell(row, 'status'),
      };

      const { value, problems: rowProblems } = validateLeadRow(raw, {
        platforms, defaultPlatformId: defaultPlatform.id, countryCode: args.country, existing, seen,
      });
      if (!value) {
        skippedRows.push({ row: rowNumber, reason: rowProblems.map((p) => `${p.column}: ${p.message}`).join(' ') });
        continue;
      }

      const id = await nextId('LED', conn);
      const now = new Date();
      await execute(
        `INSERT INTO data_leads
           (id, country_code, platform_id, niche, creator, channel_url, follower_count, tier, keyword,
            promo_confidence, evidence_title, evidence_url, public_email, public_telegram, public_instagram,
            status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
        [
          id, args.country, value.platformId, niche, value.creator, value.channelUrl, value.followerCount,
          value.tier, value.keyword, value.promoConfidence, value.evidenceTitle, value.evidenceUrl,
          value.publicEmail, value.publicTelegram, value.publicInstagram, value.status, now, now,
        ],
        conn,
      );
      seen.add(leadChannelKey(args.country, value.platformId, value.channelUrl));
      count++;
    }

    await recordAudit(conn, {
      actor: { id: 'system', name: 'Seed script', role: 'System Administrator' },
      recordType: 'Import', recordId: 'data-leads', recordLabel: `Data Leads seed (${path.basename(args.file)})`,
      action: 'import',
      reason: `Command-line seed of ${path.basename(args.file)}`,
      changes: [
        { field: 'rowsCreated', from: null, to: count },
        { field: 'rowsSubmitted', from: null, to: body.length },
      ],
    });

    return { created: count, skipped: skippedRows.length, problems: skippedRows.slice(0, 50) };
  });

  console.log(`\n${created.toLocaleString()} lead(s) created. ${skipped.toLocaleString()} row(s) skipped.`);
  if (problems.length) {
    console.log(`\nFirst ${problems.length} skipped row(s):`);
    for (const p of problems) console.log(`  Row ${p.row}: ${p.reason}`);
  }
}

main()
  .then(closePool)
  .catch(async (error: Error) => {
    console.error(`\nFailed: ${error.message}`);
    await closePool();
    process.exit(1);
  });
