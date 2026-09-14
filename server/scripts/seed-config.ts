/** Make the database's configuration — countries and platforms — match the shipped list.
 *
 *  Reads it straight from `src/mocks/seed.ts`, the same module the browser app
 *  ships with, so there is exactly one definition of each list. Idempotent: safe
 *  to re-run after any change to that file.
 *
 *  Countries are *synced*: one removed from the list is removed from the database
 *  too, but only if nothing uses it. A country a SIM, brand or account still
 *  points at is kept and reported, so the records can be moved first. Platforms
 *  are only added or updated — an account's platform is its identity, and
 *  removing one is not something a configuration file should do. */

import type { RowDataPacket } from 'mysql2/promise';
import { closePool, execute, query, tx } from '../db/pool';
import { countries, platforms } from '../../src/mocks/seed';
import { describeUsage, planCountrySync, type CountryUsage } from './country-sync';

async function main(): Promise<void> {
  const result = await tx(async (conn) => {
    // Read and decide inside the transaction, with the rows locked, so a SIM
    // saved in the same moment cannot land on a country being removed.
    const existing = await query<RowDataPacket>('SELECT code, name FROM countries FOR UPDATE', [], conn);
    const counts = await query<RowDataPacket>(
      `SELECT c.code,
              (SELECT COUNT(*) FROM sims s WHERE s.country_code = c.code) AS sims,
              (SELECT COUNT(*) FROM brand_countries b WHERE b.country_code = c.code) AS brands,
              (SELECT COUNT(*) FROM social_accounts a WHERE a.target_country_code = c.code) AS accounts
         FROM countries c`,
      [],
      conn,
    );
    const usage = new Map<string, CountryUsage>(counts.map((r) => [
      String(r.code),
      { sims: Number(r.sims), brands: Number(r.brands), accounts: Number(r.accounts) },
    ]));
    const names = new Map(existing.map((r) => [String(r.code), String(r.name)]));

    const plan = planCountrySync(countries, [...names.keys()], usage);

    for (const country of plan.upsert) {
      await execute(
        `INSERT INTO countries (code, name, dial_code) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), dial_code = VALUES(dial_code)`,
        [country.code, country.name, country.dialCode],
        conn,
      );
    }
    for (const code of plan.remove) {
      await execute('DELETE FROM countries WHERE code = ?', [code], conn);
    }

    let platformCount = 0;
    for (const platform of platforms) {
      await execute(
        `INSERT INTO platforms (id, name, slug, supports_asset_types, built_in) VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), slug = VALUES(slug),
                                 supports_asset_types = VALUES(supports_asset_types),
                                 built_in = VALUES(built_in)`,
        [platform.id, platform.name, platform.slug, JSON.stringify(platform.supportsAssetTypes), platform.builtIn ? 1 : 0],
        conn,
      );
      platformCount++;
    }

    return { plan, names, platformCount };
  });

  const { plan, names, platformCount } = result;
  console.log(`Countries: ${plan.upsert.map((c) => c.name).join(', ')}.`);
  if (plan.remove.length) {
    console.log(`  removed, unused: ${plan.remove.map((c) => names.get(c) ?? c).join(', ')}`);
  }
  console.log(`Platforms: ${platformCount}.`);

  if (plan.blocked.length) {
    console.error('\nNot removed, because records still use them:');
    for (const { code, usage } of plan.blocked) {
      console.error(`  ${names.get(code) ?? code} (${code}): ${describeUsage(usage)}`);
    }
    console.error('\nChange those records to one of the configured countries, then run this again.');
    process.exitCode = 1;
  }
}

main()
  .then(closePool)
  .catch(async (error: Error) => {
    console.error(`Failed: ${error.message}`);
    await closePool();
    process.exit(1);
  });
