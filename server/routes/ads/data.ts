/** Reading and writing Ads Monitoring rows. Every loader returns the shared
 *  types from src/lib/ads; permissions are decided by the routes. */

import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { execute, query, queryOne } from '../../db/pool';
import { date, isoRequired, iso, text } from '../../repositories/mappers';
import { COUNT_FIELDS, type CountField, type DailyRecord } from '../../../src/lib/ads/metrics';
import { DEFAULT_ALERT_SETTINGS, type AlertSettings, type Campaign, type CampaignStatus, type StatusChange } from '../../../src/lib/ads/campaign';
import type { CurrencyCode } from '../../../src/lib/ads/money';
import type { Objective } from '../../../src/lib/ads/metrics';

export const CHUNK_BYTES = 512 * 1024;

export const COUNT_COLUMNS: Record<CountField, string> = {
  reach: 'reach', impressions: 'impressions', clicksAll: 'clicks_all', linkClicks: 'link_clicks',
  landingPageViews: 'landing_page_views', reactions: 'reactions', comments: 'comments', shares: 'shares', saves: 'saves',
  newFollowers: 'new_followers', appInstalls: 'app_installs', platformPostEngagements: 'platform_post_engagements',
};

export const CAMPAIGN_COLUMNS: Record<string, string> = {
  reference: 'reference', name: 'name', platformId: 'platform_id', brandId: 'brand_id', projectId: 'project_id',
  targetCountryCode: 'target_country_code', socialAccountId: 'social_account_id', assignedStaffId: 'assigned_staff_id',
  objective: 'objective', currency: 'currency', budget: 'budget', startDate: 'start_date', endDate: 'end_date',
  status: 'status', adsUrl: 'ads_url', reportingTimezone: 'reporting_timezone', notes: 'notes',
};

const CAMPAIGN_SELECT = `SELECT c.*, p.name AS platform_name, b.name AS brand_name,
    COALESCE(CONCAT('@', sa.username), '') AS account_label,
    staff.name AS staff_name, creator.name AS creator_name, updater.name AS updater_name
  FROM ads_campaigns c
  JOIN platforms p ON p.id = c.platform_id
  LEFT JOIN brands b ON b.id = c.brand_id
  LEFT JOIN social_accounts sa ON sa.id = c.social_account_id
  LEFT JOIN users staff ON staff.id = c.assigned_staff_id
  JOIN users creator ON creator.id = c.created_by
  LEFT JOIN users updater ON updater.id = c.updated_by`;

export const mapCampaign = (r: RowDataPacket): Campaign => ({
  id: String(r.id),
  reference: text(r.reference),
  name: text(r.name),
  platformId: String(r.platform_id),
  platformName: text(r.platform_name),
  brandId: r.brand_id ? String(r.brand_id) : null,
  brandName: text(r.brand_name),
  projectId: r.project_id ? String(r.project_id) : null,
  targetCountryCode: text(r.target_country_code),
  socialAccountId: r.social_account_id ? String(r.social_account_id) : null,
  socialAccountLabel: text(r.account_label),
  assignedStaffId: r.assigned_staff_id ? String(r.assigned_staff_id) : null,
  assignedStaffName: text(r.staff_name),
  objective: r.objective as Objective,
  currency: r.currency as CurrencyCode,
  budget: r.budget === null ? null : String(r.budget),
  startDate: date(r.start_date)!,
  endDate: date(r.end_date)!,
  status: r.status as CampaignStatus,
  adsUrl: text(r.ads_url),
  reportingTimezone: text(r.reporting_timezone) || 'UTC',
  notes: text(r.notes),
  createdById: String(r.created_by),
  createdByName: text(r.creator_name),
  createdAt: isoRequired(r.created_at),
  updatedById: r.updated_by ? String(r.updated_by) : null,
  updatedByName: text(r.updater_name),
  updatedAt: isoRequired(r.updated_at),
});

export async function loadCampaign(id: string, conn?: PoolConnection): Promise<Campaign | null> {
  const row = await queryOne<RowDataPacket>(`${CAMPAIGN_SELECT} WHERE c.id = ?`, [id], conn);
  return row ? mapCampaign(row) : null;
}

export async function queryCampaigns(where: string, params: unknown[], order: string, limit: string, conn?: PoolConnection): Promise<Campaign[]> {
  const rows = await query<RowDataPacket>(`${CAMPAIGN_SELECT} ${where} ${order} ${limit}`, params, conn);
  return rows.map(mapCampaign);
}

export interface SavedDailyRecord extends DailyRecord {
  id: string;
  campaignId: string;
  notes: string;
  createdById: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

const toCount = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export const mapDaily = (r: RowDataPacket): SavedDailyRecord => ({
  id: String(r.id),
  campaignId: String(r.campaign_id),
  reportDate: date(r.report_date)!,
  amountSpent: r.amount_spent === null ? null : String(r.amount_spent),
  ...Object.fromEntries(COUNT_FIELDS.map((f) => [f, toCount(r[COUNT_COLUMNS[f]])])),
  notes: text(r.notes),
  createdById: String(r.created_by),
  createdByName: text(r.creator_name),
  createdAt: isoRequired(r.created_at),
  updatedAt: isoRequired(r.updated_at),
});

export async function loadRecords(campaignIds: string[], conn?: PoolConnection): Promise<SavedDailyRecord[]> {
  if (!campaignIds.length) return [];
  const rows = await query<RowDataPacket>(
    `SELECT d.*, u.name AS creator_name FROM ads_daily_records d JOIN users u ON u.id = d.created_by
      WHERE d.campaign_id IN (${campaignIds.map(() => '?').join(',')}) ORDER BY d.report_date`,
    campaignIds, conn,
  );
  return rows.map(mapDaily);
}

export async function loadStatusHistory(campaignIds: string[], conn?: PoolConnection): Promise<Map<string, StatusChange[]>> {
  const map = new Map<string, StatusChange[]>();
  if (!campaignIds.length) return map;
  const rows = await query<RowDataPacket>(
    `SELECT campaign_id, status, changed_at FROM ads_campaign_status_log WHERE campaign_id IN (${campaignIds.map(() => '?').join(',')}) ORDER BY changed_at, id`,
    campaignIds, conn,
  );
  for (const r of rows) {
    const list = map.get(String(r.campaign_id)) ?? [];
    list.push({ status: r.status as CampaignStatus, changedAt: isoRequired(r.changed_at) });
    map.set(String(r.campaign_id), list);
  }
  return map;
}

export async function logStatus(conn: PoolConnection, campaignId: string, status: CampaignStatus, userId: string): Promise<void> {
  await execute('INSERT INTO ads_campaign_status_log (campaign_id, status, changed_at, changed_by) VALUES (?, ?, ?, ?)', [campaignId, status, new Date(), userId], conn);
}

export interface CreativeRow {
  id: string; campaignId: string; fileName: string; mimeType: string; width: number; height: number; sizeBytes: number;
  adsUrl: string; usedFrom: string | null; usedTo: string | null; description: string;
  createdById: string; createdByName: string; createdAt: string;
}

export async function loadCreatives(campaignIds: string[], conn?: PoolConnection): Promise<CreativeRow[]> {
  if (!campaignIds.length) return [];
  const rows = await query<RowDataPacket>(
    `SELECT k.*, u.name AS creator_name FROM ads_creatives k JOIN users u ON u.id = k.created_by
      WHERE k.removed_at IS NULL AND k.campaign_id IN (${campaignIds.map(() => '?').join(',')}) ORDER BY k.created_at, k.id`,
    campaignIds, conn,
  );
  return rows.map((r) => ({
    id: String(r.id), campaignId: String(r.campaign_id), fileName: text(r.file_name), mimeType: text(r.mime_type),
    width: Number(r.width), height: Number(r.height), sizeBytes: Number(r.size_bytes), adsUrl: text(r.ads_url),
    usedFrom: date(r.used_from), usedTo: date(r.used_to), description: text(r.description),
    createdById: String(r.created_by), createdByName: text(r.creator_name), createdAt: isoRequired(r.created_at),
  }));
}

export interface ReferenceRow {
  id: string; campaignId: string; dailyRecordId: string | null; fileName: string; mimeType: string; kind: string;
  sizeBytes: number; description: string; createdById: string; createdByName: string; createdAt: string;
}

export async function loadReferences(campaignId: string, conn?: PoolConnection): Promise<ReferenceRow[]> {
  const rows = await query<RowDataPacket>(
    `SELECT f.*, u.name AS creator_name FROM ads_references f JOIN users u ON u.id = f.created_by
      WHERE f.removed_at IS NULL AND f.campaign_id = ? ORDER BY f.created_at, f.id`,
    [campaignId], conn,
  );
  return rows.map((r) => ({
    id: String(r.id), campaignId: String(r.campaign_id), dailyRecordId: r.daily_record_id ? String(r.daily_record_id) : null,
    fileName: text(r.file_name), mimeType: text(r.mime_type), kind: text(r.kind), sizeBytes: Number(r.size_bytes),
    description: text(r.description), createdById: String(r.created_by), createdByName: text(r.creator_name), createdAt: isoRequired(r.created_at),
  }));
}

export interface FollowUp {
  id: string; campaignId: string; note: string; recommendation: string; ownerUserId: string | null; ownerName: string;
  dueDate: string | null; completed: boolean; completedAt: string | null; createdById: string; createdByName: string; createdAt: string;
}

export async function loadFollowUps(campaignIds: string[], conn?: PoolConnection): Promise<FollowUp[]> {
  if (!campaignIds.length) return [];
  const rows = await query<RowDataPacket>(
    `SELECT f.*, o.name AS owner_name, u.name AS creator_name FROM ads_followups f
       LEFT JOIN users o ON o.id = f.owner_user_id JOIN users u ON u.id = f.created_by
      WHERE f.campaign_id IN (${campaignIds.map(() => '?').join(',')}) ORDER BY f.completed, f.due_date IS NULL, f.due_date, f.created_at`,
    campaignIds, conn,
  );
  return rows.map((r) => ({
    id: String(r.id), campaignId: String(r.campaign_id), note: text(r.note), recommendation: text(r.recommendation),
    ownerUserId: r.owner_user_id ? String(r.owner_user_id) : null, ownerName: text(r.owner_name), dueDate: date(r.due_date),
    completed: Boolean(r.completed), completedAt: iso(r.completed_at), createdById: String(r.created_by),
    createdByName: text(r.creator_name), createdAt: isoRequired(r.created_at),
  }));
}

export async function loadSettings(conn?: PoolConnection): Promise<AlertSettings> {
  const r = await queryOne<RowDataPacket>('SELECT * FROM ads_settings WHERE id = 1', [], conn);
  if (!r) return DEFAULT_ALERT_SETTINGS;
  return {
    stablePct: Number(r.stable_pct), budgetWarningPct: Number(r.budget_warning_pct), endingSoonDays: Number(r.ending_soon_days),
    risingCostPct: Number(r.rising_cost_pct), decliningEngagementPct: Number(r.declining_engagement_pct),
  };
}

/** Store file bytes in chunks small enough for any max_allowed_packet. */
export async function writeChunks(conn: PoolConnection, fileId: string, bytes: Uint8Array): Promise<void> {
  for (let seq = 0, offset = 0; offset < bytes.length; seq++, offset += CHUNK_BYTES) {
    await execute('INSERT INTO ads_file_chunks (file_id, seq, data) VALUES (?, ?, ?)', [fileId, seq, Buffer.from(bytes.subarray(offset, offset + CHUNK_BYTES))], conn);
  }
}

export async function readChunks(fileId: string): Promise<Buffer> {
  const rows = await query<RowDataPacket>('SELECT data FROM ads_file_chunks WHERE file_id = ? ORDER BY seq', [fileId]);
  return Buffer.concat(rows.map((r) => r.data as Buffer));
}
