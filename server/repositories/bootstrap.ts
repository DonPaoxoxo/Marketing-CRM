/** Assembles the payload the browser app loads on start.
 *
 *  The shape is `Bootstrap` from the shared domain model, so the client cannot
 *  tell whether the mock or this server answered — which is what makes switching
 *  between them a configuration change rather than a rewrite. */

import type { RowDataPacket } from 'mysql2/promise';
import { query } from '../db/pool';
import type { Bootstrap } from '../../src/lib/types';
import { bootstrapFor } from '../../src/lib/access';
import type { PermissionHolder } from '../../src/lib/permissions';
import { loadProofs, mapProof } from '../routes/agent-proofs';
import {
  groupBy, mapAccount, mapAgent, mapAssignment, mapAuditChange, mapAuditEntry, mapBrand,
  mapCompetitor, mapContentPost, mapCountry, mapCredential, mapDomain, mapPlatform, mapProject, mapSim,
  mapSnapshot, mapTeamMember,
} from './mappers';

/** How much history the workspace carries in one payload. The audit trail grows
 *  without bound, so the app loads a recent slice rather than all of it. */
export const AUDIT_PAGE_SIZE = 500;

/** The workspace as `role` may see it: admin-only areas are left out for everyone
 *  else (see bootstrapFor), so a locked page has no data to leak either. */
export async function loadBootstrap(holder: PermissionHolder): Promise<Bootstrap> {
  // Independent reads, so they go out together rather than one after another.
  const [
    countryRows, platformRows, brandRows, brandCountryRows, projectRows, userRows,
    simRows, agentRows, agentBrandRows, agentProjectRows, agentChannelRows,
    accountRows, accountSimRows, credentialRows, assignmentRows, domainRows,
    snapshotRows, postRows, auditRows, auditChangeRows, proofRows, competitorRows,
  ] = await Promise.all([
    query<RowDataPacket>('SELECT * FROM countries ORDER BY name'),
    query<RowDataPacket>('SELECT * FROM platforms ORDER BY name'),
    query<RowDataPacket>('SELECT * FROM brands ORDER BY name'),
    query<RowDataPacket>('SELECT * FROM brand_countries'),
    query<RowDataPacket>('SELECT * FROM projects ORDER BY start_date DESC'),
    query<RowDataPacket>('SELECT id, email, name, title, role, active FROM users ORDER BY name'),
    query<RowDataPacket>('SELECT * FROM sims ORDER BY created_at DESC, id DESC'),
    query<RowDataPacket>('SELECT * FROM agents ORDER BY created_at DESC, id DESC'),
    query<RowDataPacket>('SELECT * FROM agent_brands'),
    query<RowDataPacket>('SELECT * FROM agent_projects'),
    query<RowDataPacket>('SELECT * FROM agent_channels ORDER BY agent_id, position'),
    query<RowDataPacket>('SELECT * FROM social_accounts ORDER BY created_at DESC, id DESC'),
    query<RowDataPacket>('SELECT * FROM account_sims'),
    query<RowDataPacket>('SELECT * FROM credentials ORDER BY id'),
    query<RowDataPacket>('SELECT * FROM assignments ORDER BY start_date DESC, id DESC'),
    query<RowDataPacket>('SELECT * FROM domains ORDER BY expiration_date'),
    query<RowDataPacket>('SELECT * FROM follower_snapshots ORDER BY account_id, snapshot_date'),
    query<RowDataPacket>('SELECT * FROM content_posts ORDER BY published_date DESC, id DESC'),
    query<RowDataPacket>(
      `SELECT * FROM audit_entries ORDER BY occurred_at DESC, id DESC LIMIT ${AUDIT_PAGE_SIZE}`,
    ),
    // Only the changes belonging to the entries above, rather than the whole
    // child table filtered in memory.
    query<RowDataPacket>(
      `SELECT c.* FROM audit_changes c
         JOIN (SELECT id FROM audit_entries ORDER BY occurred_at DESC, id DESC LIMIT ${AUDIT_PAGE_SIZE}) recent
           ON recent.id = c.audit_id
        ORDER BY c.audit_id, c.position`,
    ),
    // Metadata only; each image is fetched on its own when shown.
    loadProofs(),
    query<RowDataPacket>('SELECT * FROM pakistan_competitors ORDER BY created_at DESC, id DESC'),
  ]);

  const brandCountries = groupBy(brandCountryRows, 'brand_id');
  const agentBrands = groupBy(agentBrandRows, 'agent_id');
  const agentProjects = groupBy(agentProjectRows, 'agent_id');
  const agentChannels = groupBy(agentChannelRows, 'agent_id');
  const accountSims = groupBy(accountSimRows, 'account_id');
  const auditChanges = groupBy(auditChangeRows, 'audit_id');
  const column = (map: Map<string, RowDataPacket[]>, key: string, field: string): string[] =>
    (map.get(key) ?? []).map((row) => String(row[field]));

  return bootstrapFor({
    countries: countryRows.map(mapCountry),
    platforms: platformRows.map(mapPlatform),
    brands: brandRows.map((r) => mapBrand(r, column(brandCountries, String(r.id), 'country_code'))),
    projects: projectRows.map(mapProject),
    teamMembers: userRows.map(mapTeamMember),
    sims: simRows.map(mapSim),
    agents: agentRows.map((r) => mapAgent(r, {
      brandIds: column(agentBrands, String(r.id), 'brand_id'),
      projectIds: column(agentProjects, String(r.id), 'project_id'),
      channelUrls: column(agentChannels, String(r.id), 'url'),
    })),
    socialAccounts: accountRows.map((r) => mapAccount(r, {
      simIds: column(accountSims, String(r.id), 'sim_id'),
    })),
    credentials: credentialRows.map(mapCredential),
    assignments: assignmentRows.map(mapAssignment),
    domains: domainRows.map(mapDomain),
    followerSnapshots: snapshotRows.map(mapSnapshot),
    contentPosts: postRows.map(mapContentPost),
    agentProofs: proofRows.map(mapProof),
    pakistanCompetitors: competitorRows.map(mapCompetitor),
    auditEntries: auditRows.map((r) =>
      mapAuditEntry(r, (auditChanges.get(String(r.id)) ?? []).map(mapAuditChange)),
    ),
  }, holder);
}
