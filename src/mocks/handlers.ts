/** MSW request handlers.
 *  The app talks to these exactly as it would talk to a real API, so swapping in
 *  a server later is a base-URL change plus auth headers. */

import { HttpResponse, http, delay } from 'msw';
import { db, diffRecords, nextId, recordAudit } from './db';
import { ROLES } from '@/lib/types';
import {
  SOCIAL_POST_PLATFORM, SOCIAL_POST_PURPOSE,
  DATA_LEAD_ASSIGNEE, DOMAIN_ACCESSIBILITY_STATUS,
  type AgentProof, type Agent, type Assignment, type AuditEntry, type CompetitorRecord, type ContentPost,
  type CredentialRef, type DataLeadRecord, type DomainAccessibilityStatus, type DomainMonitorRecord,
  type DomainRecord, type FollowerSnapshot, type RoleName, type RotationBatchRecord, type RotationEventRecord, type RotationGroupRecord, type Sim,
  type SocialAccount, type SocialMediaPost, type SocialPostScreenshot, type TeamMember,
} from '@/lib/types';
import { checkAssignmentConflict } from '@/lib/rules';
import { teamReportHandlers } from './team-reports';
import { ROLE_PERMISSIONS, cleanPermissionList, EDITABLE_ROLES, GRANTABLE_PERMISSIONS, LOCKED_PERMISSIONS, SYSTEM_ADMIN_ROLE, hasPermission } from '@/lib/permissions';
import { agentLockReason, isArchiveOnlyChange, mayArchiveAgent, mayEditAgent } from '@/lib/access';
import { checkRecoveryDetail } from '@/lib/recovery';
import { checkSalaryStatus, maySetSalaryStatus, salaryLabel } from '@/lib/salary';
import { checkProofImage, checkProofPostUrl, checkProofReview, decodeBase64Image, mayReviewProofs } from '@/lib/proofs';
import { firstRepeat, pageUrlKey, phoneKey, postUrlKey, urlKeys } from '@/lib/identity';
import {
  checkDomainExtras, domainRawFromRecord, domainSheetChanges, domainUpdateFields, validateDomainRow,
} from '@/lib/domain-import';
import { checkSimExtras, simRawFromRecord, takenBySims, validateSimRow, noneTaken, addTaken } from '@/lib/sim-import';
import { leadChannelKey, validateLeadRow, type LeadImportKey } from '@/lib/lead-import';
import { validateDomainLines } from '@/lib/domain-monitor-import';
import { emailKey, telegramKey, TELEGRAM_USERNAME_PATTERN } from '@/lib/identity';
import { paymentTermFitsType } from '@/lib/agents';
import { normalizeDomain, normalizePhone } from '@/lib/utils';
import {
  ACCOUNT_FIELDS, AGENT_FIELDS, ASSIGNMENT_FIELDS, COMPETITOR_FIELDS, CONTENT_POST_FIELDS, CREDENTIAL_FIELDS,
  DATA_LEAD_FIELDS, DOMAIN_FIELDS, DOMAIN_MONITOR_FIELDS, ROTATION_FIELDS, SIM_FIELDS, SNAPSHOT_FIELDS, SOCIAL_POST_FIELDS,
  sanitizeFields, sanitizeText, sanitizeUrl,
} from '@/lib/sanitize';

/** Absolute base so the same handlers match in the browser (against the page's
 *  own origin) and under Node, where relative paths have nothing to resolve against. */
export const API_ORIGIN = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
const API = `${API_ORIGIN}/api`;
const LATENCY = () => delay(120 + Math.random() * 220);

/** Who to attribute a write to.
 *
 *  The team register starts empty, so there may be no matching record. Rather than
 *  leave an action unattributable, fall back to the identity the client claims —
 *  marked unverified, because it is: a request cannot be trusted to say who sent
 *  it. Production must resolve the caller from an authenticated session on the
 *  server and ignore anything the client asserts here. */
function actor(req: Request): TeamMember {
  const params = new URL(req.url).searchParams;
  const id = params.get('actorId') ?? req.headers.get('x-actor-id') ?? '';
  const known = db.teamMembers.find((t) => t.id === id);
  if (known) return known;

  const claimedName = params.get('actorName')?.trim();
  const claimedRole = params.get('actorRole')?.trim() as RoleName | undefined;
  return {
    id: id || 'unknown',
    name: claimedName ? `${claimedName} (unverified)` : 'Unverified operator',
    email: '',
    role: claimedRole && ROLES.includes(claimedRole) ? claimedRole : 'Marketing Staff',
    title: '',
    active: true,
  };
}

function bad(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return HttpResponse.json({ message, ...extra }, { status });
}

/** Mirrors requirePermission('access:…') on the real server. The mock has no stored
 *  permissions for its actors, so role defaults apply. */
const noAccess = () => bad('You do not have access to this area.', 403);
const may = (request: Request, permission: Parameters<typeof hasPermission>[1]) => hasPermission(actor(request), permission);

/** Role and individual permissions for the preview, in memory only. */
const mockPermissions: { roles: Record<string, string[]>; users: Record<string, string[]> } = { roles: {}, users: {} };
const permissionSnapshot = () => ({
  grantable: GRANTABLE_PERMISSIONS, locked: LOCKED_PERMISSIONS, editableRoles: EDITABLE_ROLES,
  roles: Object.fromEntries(EDITABLE_ROLES.map((r) => [r, mockPermissions.roles[r] ?? ROLE_PERMISSIONS[r]])),
  users: mockPermissions.users,
});

/** Mirrors the agent edit lock in server/routes/agents.ts. */
function agentLocked(request: Request, agent: Agent) {
  const who = actor(request);
  if (mayEditAgent(who, agent)) return null;
  const manager = db.teamMembers.find((t) => t.id === agent.managerId);
  return bad(agentLockReason(who, agent, manager?.name ?? 'the assigned manager') ?? 'Not allowed.', 403);
}

/** Mirrors applyRecovery in server/routes/social-accounts.ts. */
function recoveryProblem(body: Partial<SocialAccount>, before?: SocialAccount) {
  if (body.recoveryMethod === undefined && body.recoveryRef === undefined) return null;
  const checked = checkRecoveryDetail(body.recoveryMethod ?? before?.recoveryMethod ?? 'None', body.recoveryRef ?? before?.recoveryRef ?? '');
  if ('error' in checked) return bad(checked.error, 400, { field: 'recoveryRef' });
  body.recoveryRef = checked.value;
  return null;
}

const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

/** Upserts one domain's check for today and updates the monitor's own
 *  denormalised cache — mirrors writeCheck in server/routes/domain-monitoring/checks.ts. */
function writeCheckLog(rec: DomainMonitorRecord, status: DomainAccessibilityStatus, notes: string, checkedById: string): void {
  const checkDate = today();
  const existing = db.domainCheckLogs.find((l) => l.domainMonitorId === rec.id && l.checkDate === checkDate);
  if (existing) {
    Object.assign(existing, { accessibilityStatus: status, checkedById, notes, updatedAt: now() });
  } else {
    db.domainCheckLogs.unshift({
      id: nextId('DCL', db.domainCheckLogs, 6),
      domainMonitorId: rec.id,
      checkDate,
      accessibilityStatus: status,
      checkedById,
      notes,
      createdAt: now(),
      updatedAt: now(),
    });
  }
  Object.assign(rec, { lastAccessibilityStatus: status, lastCheckedDate: checkDate, lastCheckedById: checkedById, updatedAt: now() });
}

/** Created For, Email and Telegram username on a single SIM save, mirroring
 *  applySimExtras in server/routes/sims.ts. Returns a response to send, or null. */
function simExtrasProblem(body: Partial<Sim>, before?: Sim) {
  const checked = checkSimExtras(body);
  if ('field' in checked) return bad(checked.message, 400, { field: checked.field });
  Object.assign(body, checked.value);
  const live = db.sims.filter((s) => !s.archived && s.id !== before?.id);
  if (changed(emailKey, before?.email, body.email)) {
    const holder = live.find((s) => emailKey(s.email) === body.email);
    if (holder) return taken('email', holder.id, holder.id, 'email');
  }
  if (changed(telegramKey, before?.telegramUsername, body.telegramUsername)) {
    const holder = live.find((s) => telegramKey(s.telegramUsername) === body.telegramUsername);
    if (holder) return taken('Telegram username', holder.id, holder.id, 'telegramUsername');
  }
  return null;
}

/* Duplicate rules, mirroring server/routes/duplicates.ts: compared by key, live
   records only, and on an edit only when the value actually changed. */
const changed = (key: (v: string) => string, before: string | undefined, after: string | undefined) =>
  after !== undefined && key(after) !== '' && key(after) !== key(before ?? '');
const taken = (what: string, id: string, label: string, field: string) =>
  bad(`This ${what} is already registered on ${id} (${label}).`, 409, { field, conflictId: id });
function agentChannelClash(urls: string[], exceptId?: string) {
  for (const url of urls) {
    const key = pageUrlKey(url);
    if (!key) continue;
    const holder = db.agents.find((a) => a.id !== exceptId && !a.archived && urlKeys(a.channelUrls).includes(key));
    if (holder) return { url, holder };
  }
  return null;
}

/** Mirrors agentChannelClash, but for individual post links (keyed by
 *  postUrlKey — a post link names one post, not a page). */
function agentPostLinkClash(urls: string[], exceptId?: string) {
  for (const url of urls) {
    const key = postUrlKey(url);
    if (!key) continue;
    const holder = db.agents.find((a) => a.id !== exceptId && !a.archived && urlKeys(a.postLinks, { caseSensitivePath: true }).includes(key));
    if (holder) return { url, holder };
  }
  return null;
}

/** Mirrors checkAgentTelegram in server/routes/agents.ts. */
function checkAgentTelegramMock(raw: string): { value: string } | { error: string } {
  const key = telegramKey(raw);
  if (!key) return { value: '' };
  if (!TELEGRAM_USERNAME_PATTERN.test(key)) {
    return { error: 'A Telegram username is 5–32 letters, digits or underscores, starting with a letter.' };
  }
  return { value: key };
}

/** Purpose/platform plus their matching custom text — mirrors
 *  applyPurposeAndPlatform in server/routes/social-media-posts.ts. Only runs
 *  when the request actually touches one of these four fields, so an
 *  archive/restore patch (just `status` + a reason) is untouched by it. */
function applySocialPostExtras(body: Partial<SocialMediaPost> & { reason?: string }, before?: SocialMediaPost) {
  if (body.purpose !== undefined || body.customPurpose !== undefined) {
    const purpose = body.purpose ?? before?.purpose;
    if (!purpose || !SOCIAL_POST_PURPOSE.includes(purpose)) return bad('Select a valid purpose.', 400, { field: 'purpose' });
    const customPurpose = (body.purpose !== undefined ? body.customPurpose ?? '' : body.customPurpose ?? before?.customPurpose ?? '').trim();
    if (purpose === 'Others' && !customPurpose) return bad('Write the custom purpose.', 400, { field: 'customPurpose' });
    body.purpose = purpose;
    body.customPurpose = purpose === 'Others' ? customPurpose : '';
  }
  if (body.platform !== undefined || body.customPlatform !== undefined) {
    const platform = body.platform ?? before?.platform;
    if (!platform || !SOCIAL_POST_PLATFORM.includes(platform)) return bad('Select a valid platform.', 400, { field: 'platform' });
    const customPlatform = (body.platform !== undefined ? body.customPlatform ?? '' : body.customPlatform ?? before?.customPlatform ?? '').trim();
    if (platform === 'Others' && !customPlatform) return bad('Write the custom platform.', 400, { field: 'customPlatform' });
    body.platform = platform;
    body.customPlatform = platform === 'Others' ? customPlatform : '';
  }
  return null;
}

export const handlers = [
  /* ── Bootstrap: the whole synthetic dataset in one round trip ── */
  http.get(`${API}/bootstrap`, async () => {
    await LATENCY();
    return HttpResponse.json({
      countries: db.countries,
      platforms: db.platforms,
      brands: db.brands,
      projects: db.projects,
      teamMembers: db.teamMembers,
      sims: db.sims,
      agents: db.agents,
      socialAccounts: db.socialAccounts,
      credentials: db.credentials,
      assignments: db.assignments,
      domains: db.domains,
      followerSnapshots: db.followerSnapshots,
      contentPosts: db.contentPosts,
      agentProofs: db.agentProofs,
      pakistanCompetitors: db.pakistanCompetitors,
      socialMediaPosts: db.socialMediaPosts,
      socialPostScreenshots: db.socialPostScreenshots,
      dataLeads: db.dataLeads,
      domainMonitors: db.domainMonitors,
      rotationGroups: db.rotationGroups,
      rotationBatches: db.rotationBatches,
      rotationBatchMembers: db.rotationBatchMembers,
      rotationEvents: db.rotationEvents,
      rotationEventDomainChanges: db.rotationEventDomainChanges,
      auditEntries: db.auditEntries,
    });
  }),

  /* ── SIMs ─────────────────────────────────────────────────── */
  http.post(`${API}/sims`, async ({ request }) => {
    await LATENCY();
    const body = sanitizeFields((await request.json()) as Partial<Sim> & { reason?: string }, SIM_FIELDS);
    const phoneNumber = normalizePhone(body.phoneNumber ?? '');
    if (!phoneNumber) return bad('A phone number is required.');
    const extras = simExtrasProblem(body);
    if (extras) return extras;
    if (db.sims.some((s) => !s.archived && s.phoneNumber === phoneNumber)) {
      return bad(`${phoneNumber} is already registered on another SIM record.`, 409, { field: 'phoneNumber' });
    }
    const rec: Sim = {
      id: nextId('SIM', db.sims),
      phoneNumber,
      countryCode: body.countryCode ?? 'IN',
      provider: body.provider ?? '',
      form: body.form ?? 'Physical SIM',
      createdFor: body.createdFor ?? '',
      email: body.email ?? '',
      telegramUsername: body.telegramUsername ?? '',
      assigneeId: body.assigneeId ?? null,
      assigneeType: body.assigneeType ?? null,
      brandId: body.brandId ?? null,
      projectId: body.projectId ?? null,
      operationalStatus: body.operationalStatus ?? 'Active',
      allocationStatus: body.allocationStatus ?? 'Available',
      planExpiryDate: body.planExpiryDate ?? null,
      lastVerifiedDate: body.lastVerifiedDate ?? null,
      notes: body.notes ?? '',
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.sims.unshift(rec);
    // The label is the record id, never the number: an audit entry is permanent
    // and read by more people than the register itself. The number is still
    // reachable through the record it names.
    recordAudit({ actor: actor(request), recordType: 'SIM', recordId: rec.id, recordLabel: rec.id, action: 'create', reason: body.reason ?? 'New SIM registered', changes: [{ field: 'phoneNumber', from: null, to: '[recorded]' }] });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/sims/:id`, async ({ request, params }) => {
    await LATENCY();
    const rec = db.sims.find((s) => s.id === params.id);
    if (!rec) return bad('SIM record not found.', 404);
    const body = sanitizeFields((await request.json()) as Partial<Sim> & { reason?: string }, SIM_FIELDS);
    const extras = simExtrasProblem(body, rec);
    if (extras) return extras;
    if (body.phoneNumber) {
      body.phoneNumber = normalizePhone(body.phoneNumber);
      if (db.sims.some((s) => s.id !== rec.id && !s.archived && s.phoneNumber === body.phoneNumber)) {
        return bad(`${body.phoneNumber} is already registered on another SIM record.`, 409, { field: 'phoneNumber' });
      }
    }
    const { reason, ...patch } = body;
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({ actor: actor(request), recordType: 'SIM', recordId: rec.id, recordLabel: rec.id, action: patch.archived ? 'archive' : 'update', reason: reason ?? 'Record updated', changes });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Agents ───────────────────────────────────────────────── */
  http.post(`${API}/agents`, async ({ request }) => {
    await LATENCY();
    const body = sanitizeFields((await request.json()) as Partial<Agent> & { reason?: string }, AGENT_FIELDS);
    if (!body.name?.trim()) return bad('A name is required.');
    const phone = phoneKey(body.contactNumber);
    const phoneHolder = phone ? db.agents.find((a) => !a.archived && phoneKey(a.contactNumber) === phone) : undefined;
    if (phoneHolder) return taken('contact number', phoneHolder.id, phoneHolder.name, 'contactNumber');
    const uid = (body.externalUid ?? '').trim();
    const uidHolder = uid ? db.agents.find((a) => !a.archived && a.externalUid.toLowerCase() === uid.toLowerCase()) : undefined;
    if (uidHolder) return taken('UID', uidHolder.id, uidHolder.name, 'externalUid');
    const channels = body.channelUrls ?? [];
    const repeat = firstRepeat(channels, pageUrlKey);
    if (repeat) return bad(`${repeat} is listed twice.`, 400, { field: 'channelUrls' });
    const channelClash = agentChannelClash(channels);
    if (channelClash) return taken(`channel URL (${channelClash.url})`, channelClash.holder.id, channelClash.holder.name, 'channelUrls');
    const postLinks = body.postLinks ?? [];
    const postLinkRepeat = firstRepeat(postLinks, postUrlKey);
    if (postLinkRepeat) return bad(`${postLinkRepeat} is listed twice.`, 400, { field: 'postLinks' });
    const postLinkClash = agentPostLinkClash(postLinks);
    if (postLinkClash) return taken(`post link (${postLinkClash.url})`, postLinkClash.holder.id, postLinkClash.holder.name, 'postLinks');
    const telegram = checkAgentTelegramMock(body.telegramUsername ?? '');
    if ('error' in telegram) return bad(telegram.error, 400, { field: 'telegramUsername' });
    if (telegram.value) {
      const telegramHolder = db.agents.find((a) => !a.archived && telegramKey(a.telegramUsername) === telegram.value);
      if (telegramHolder) return taken('Telegram username', telegramHolder.id, telegramHolder.name, 'telegramUsername');
    }
    const agentType = body.agentType ?? 'Individual';
    if (body.paymentTerm && !paymentTermFitsType(body.paymentTerm, agentType)) {
      return bad(`"${body.paymentTerm}" is not a payment term for ${agentType}.`, 400, { field: 'paymentTerm' });
    }
    const rec: Agent = {
      id: nextId('AGT', db.agents, 3),
      name: body.name.trim(),
      externalUid: uid,
      agentType,
      contactNumber: normalizePhone(body.contactNumber ?? ''),
      email: body.email ?? '',
      telegramUsername: telegram.value,
      preferredChannel: body.preferredChannel ?? 'Email',
      managerId: body.managerId ?? null,
      brandIds: body.brandIds ?? [],
      projectIds: body.projectIds ?? [],
      channelUrls: body.channelUrls ?? [],
      postLinks,
      cooperationStatus: body.cooperationStatus ?? 'Prospect',
      paymentTerm: body.paymentTerm ?? null,
      salaryStatus: null, salaryNote: '', salaryUpdatedByName: '', salaryUpdatedAt: null,
      startDate: body.startDate ?? null,
      lastContactedDate: body.lastContactedDate ?? null,
      nextFollowUpDate: body.nextFollowUpDate ?? null,
      agreementRef: body.agreementRef ?? '',
      notes: body.notes ?? '',
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.agents.unshift(rec);
    recordAudit({ actor: actor(request), recordType: 'Agent', recordId: rec.id, recordLabel: rec.name, action: 'create', reason: body.reason ?? 'Agent registered. No CRM login account is created.', changes: [{ field: 'name', from: null, to: rec.name }] });
    return HttpResponse.json(rec, { status: 201 });
  }),

  /* Mirrors server/routes/agents.ts PATCH /:id/salary. */
  http.patch(`${API}/agents/:id/salary`, async ({ request, params }) => {
    await LATENCY();
    const who = actor(request);
    if (!maySetSalaryStatus(who.role)) return bad('Only the System Administrator can set the salary status.', 403);
    const rec = db.agents.find((a) => a.id === params.id);
    if (!rec) return bad('Agent not found.', 404);
    const checked = checkSalaryStatus((await request.json()) as { status?: unknown; note?: unknown });
    if ('error' in checked) return bad(checked.error, 400, { field: checked.field });
    if (checked.status !== rec.salaryStatus || checked.note !== rec.salaryNote) {
      const from = rec.salaryStatus ? salaryLabel(rec) : null;
      Object.assign(rec, { salaryStatus: checked.status, salaryNote: checked.note, salaryUpdatedByName: who.name, salaryUpdatedAt: now(), updatedAt: now() });
      recordAudit({ actor: who, recordType: 'Agent', recordId: rec.id, recordLabel: rec.name, action: 'status-change', reason: `Salary status set to ${salaryLabel(rec)}`, changes: [{ field: 'salaryStatus', from, to: checked.status ? salaryLabel(rec) : null }] });
    }
    return HttpResponse.json(rec);
  }),

  http.patch(`${API}/agents/:id`, async ({ request, params }) => {
    await LATENCY();
    const rec = db.agents.find((a) => a.id === params.id);
    if (!rec) return bad('Agent not found.', 404);
    const raw = (await request.json()) as Partial<Agent> & { reason?: string };
    // Mirrors server/routes/agents.ts: archive/restore alone skips the manager lock.
    const archiveOnly = isArchiveOnlyChange(raw as Record<string, unknown>);
    if (archiveOnly && !mayArchiveAgent(actor(request))) return bad(`Your role (${actor(request).role}) cannot archive or restore agents.`, 403);
    const locked = archiveOnly ? null : agentLocked(request, rec);
    if (locked) return locked;
    const { reason, ...patch } = sanitizeFields(raw, AGENT_FIELDS);
    // Like the server's column map: salary status has its own route and is never set by an edit.
    for (const k of ['salaryStatus', 'salaryNote', 'salaryUpdatedByName', 'salaryUpdatedAt'] as const) delete patch[k];
    if (patch.archived === true && !rec.archived && !reason?.trim()) return bad('Archiving needs a written reason.', 400, { field: 'reason' });
    if (patch.archived === false && rec.archived) {
      const who = actor(request);
      if (!hasPermission(who, 'archive:records')) return bad(`Your role (${who.role}) cannot restore records.`, 403);
      if (!reason?.trim()) return bad('Restoring needs a written reason.', 400, { field: 'reason' });
      const live = db.agents.filter((a) => a.id !== rec.id && !a.archived);
      const phone = phoneKey(patch.contactNumber ?? rec.contactNumber);
      const phoneHolder = phone ? live.find((a) => phoneKey(a.contactNumber) === phone) : undefined;
      if (phoneHolder) return taken('contact number', phoneHolder.id, phoneHolder.name, 'contactNumber');
      const uid = (patch.externalUid ?? rec.externalUid).toLowerCase();
      const uidHolder = uid ? live.find((a) => a.externalUid.toLowerCase() === uid) : undefined;
      if (uidHolder) return taken('UID', uidHolder.id, uidHolder.name, 'externalUid');
      const clash = agentChannelClash(patch.channelUrls ?? rec.channelUrls, rec.id);
      if (clash) return taken(`channel URL (${clash.url})`, clash.holder.id, clash.holder.name, 'channelUrls');
      const postLinkClash = agentPostLinkClash(patch.postLinks ?? rec.postLinks, rec.id);
      if (postLinkClash) return taken(`post link (${postLinkClash.url})`, postLinkClash.holder.id, postLinkClash.holder.name, 'postLinks');
      const restoreTelegramKey = telegramKey(patch.telegramUsername ?? rec.telegramUsername);
      const telegramHolder = restoreTelegramKey
        ? db.agents.find((a) => a.id !== rec.id && !a.archived && telegramKey(a.telegramUsername) === restoreTelegramKey)
        : undefined;
      if (telegramHolder) return taken('Telegram username', telegramHolder.id, telegramHolder.name, 'telegramUsername');
    }
    if (patch.externalUid !== undefined) {
      patch.externalUid = patch.externalUid.trim();
      const uid = patch.externalUid.toLowerCase();
      if (uid && uid !== rec.externalUid.toLowerCase()) {
        const holder = db.agents.find((a) => a.id !== rec.id && !a.archived && a.externalUid.toLowerCase() === uid);
        if (holder) return taken('UID', holder.id, holder.name, 'externalUid');
      }
    }
    if (patch.contactNumber) patch.contactNumber = normalizePhone(patch.contactNumber);
    if (changed(phoneKey, rec.contactNumber, patch.contactNumber)) {
      const key = phoneKey(patch.contactNumber);
      const holder = db.agents.find((a) => a.id !== rec.id && !a.archived && phoneKey(a.contactNumber) === key);
      if (holder) return taken('contact number', holder.id, holder.name, 'contactNumber');
    }
    if (patch.channelUrls) {
      const repeat = firstRepeat(patch.channelUrls, pageUrlKey);
      if (repeat) return bad(`${repeat} is listed twice.`, 400, { field: 'channelUrls' });
      const had = new Set(urlKeys(rec.channelUrls));
      const clash = agentChannelClash(patch.channelUrls.filter((u) => !had.has(pageUrlKey(u))), rec.id);
      if (clash) return taken(`channel URL (${clash.url})`, clash.holder.id, clash.holder.name, 'channelUrls');
    }
    if (patch.postLinks) {
      const repeat = firstRepeat(patch.postLinks, postUrlKey);
      if (repeat) return bad(`${repeat} is listed twice.`, 400, { field: 'postLinks' });
      const had = new Set(urlKeys(rec.postLinks, { caseSensitivePath: true }));
      const clash = agentPostLinkClash(patch.postLinks.filter((u) => !had.has(postUrlKey(u))), rec.id);
      if (clash) return taken(`post link (${clash.url})`, clash.holder.id, clash.holder.name, 'postLinks');
    }
    if (patch.telegramUsername !== undefined) {
      const telegram = checkAgentTelegramMock(patch.telegramUsername);
      if ('error' in telegram) return bad(telegram.error, 400, { field: 'telegramUsername' });
      patch.telegramUsername = telegram.value;
      if (telegram.value && telegram.value !== telegramKey(rec.telegramUsername)) {
        const holder = db.agents.find((a) => a.id !== rec.id && !a.archived && telegramKey(a.telegramUsername) === telegram.value);
        if (holder) return taken('Telegram username', holder.id, holder.name, 'telegramUsername');
      }
    }
    {
      const agentType = patch.agentType ?? rec.agentType;
      const paymentTerm = patch.paymentTerm !== undefined ? patch.paymentTerm : rec.paymentTerm;
      if (paymentTerm && !paymentTermFitsType(paymentTerm, agentType)) {
        return bad(`"${paymentTerm}" is not a payment term for ${agentType}.`, 400, { field: 'paymentTerm' });
      }
    }
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    const restoring = patch.archived === false && rec.archived;
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({ actor: actor(request), recordType: 'Agent', recordId: rec.id, recordLabel: rec.name, action: patch.archived ? 'archive' : restoring ? 'status-change' : 'update', reason: reason ?? 'Record updated', changes });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Social accounts ──────────────────────────────────────── */
  http.post(`${API}/social-accounts`, async ({ request }) => {
    await LATENCY();
    const body = sanitizeFields((await request.json()) as Partial<SocialAccount> & { reason?: string }, ACCOUNT_FIELDS);
    if (!body.username?.trim()) return bad('A username or handle is required.');
    const recovery = recoveryProblem(body);
    if (recovery) return recovery;
    // Handles may repeat; the platform ID is what identifies an account. Mirrors the real API.
    const dupPlatformId = body.platformAccountId
      ? db.socialAccounts.find((a) => !a.archived && a.platformId === body.platformId && a.platformAccountId === body.platformAccountId)
      : undefined;
    if (dupPlatformId) return bad(`This platform ID already exists (${dupPlatformId.id}).`, 409, { field: 'platformAccountId', conflictId: dupPlatformId.id });
    const urlKey = pageUrlKey(body.profileUrl);
    const urlHolder = urlKey ? db.socialAccounts.find((a) => !a.archived && pageUrlKey(a.profileUrl) === urlKey) : undefined;
    if (urlHolder) return taken('profile URL', urlHolder.id, `@${urlHolder.username}`, 'profileUrl');

    const rec: SocialAccount = {
      id: nextId('ACC', db.socialAccounts),
      platformId: body.platformId ?? db.platforms[0].id,
      platformAccountId: body.platformAccountId ?? '',
      assetType: body.assetType ?? 'Profile',
      displayName: body.displayName ?? body.username,
      username: body.username.trim(),
      profileUrl: body.profileUrl ?? '',
      brandId: body.brandId ?? null,
      projectId: body.projectId ?? null,
      targetCountryCode: body.targetCountryCode ?? 'IN',
      contentLanguage: body.contentLanguage ?? 'English',
      responsibleTeamMemberId: body.responsibleTeamMemberId ?? null,
      loginEmailRef: body.loginEmailRef ?? '',
      credentialId: body.credentialId ?? null,
      recoveryMethod: body.recoveryMethod ?? 'None',
      recoveryRef: body.recoveryRef ?? '',
      twoFaEnabled: body.twoFaEnabled ?? false,
      twoFaMethod: body.twoFaMethod ?? 'None',
      operationalStatus: body.operationalStatus ?? 'Active',
      allocationStatus: body.allocationStatus ?? 'Unassigned',
      simIds: body.simIds ?? [],
      lastAccessVerifiedDate: body.lastAccessVerifiedDate ?? null,
      lastPostingDate: body.lastPostingDate ?? null,
      followerCount: body.followerCount ?? null,
      followerCountMeasuredAt: body.followerCountMeasuredAt ?? null,
      reservedForProjectId: body.reservedForProjectId ?? null,
      notes: body.notes ?? '',
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.socialAccounts.unshift(rec);
    recordAudit({ actor: actor(request), recordType: 'Social Account', recordId: rec.id, recordLabel: `@${rec.username}`, action: 'create', reason: body.reason ?? 'Account registered', changes: [{ field: 'username', from: null, to: rec.username }] });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/social-accounts/:id`, async ({ request, params }) => {
    await LATENCY();
    const rec = db.socialAccounts.find((a) => a.id === params.id);
    if (!rec) return bad('Account not found.', 404);
    const { reason, ...patch } = sanitizeFields((await request.json()) as Partial<SocialAccount> & { reason?: string }, ACCOUNT_FIELDS);
    const recovery = recoveryProblem(patch, rec);
    if (recovery) return recovery;
    if (patch.platformAccountId) {
      const dup = db.socialAccounts.find(
        (a) => a.id !== rec.id && !a.archived && a.platformId === (patch.platformId ?? rec.platformId) && a.platformAccountId === patch.platformAccountId,
      );
      if (dup) return bad(`This platform ID already exists (${dup.id}).`, 409, { field: 'platformAccountId', conflictId: dup.id });
    }
    if (changed(pageUrlKey, rec.profileUrl, patch.profileUrl)) {
      const key = pageUrlKey(patch.profileUrl);
      const holder = db.socialAccounts.find((a) => a.id !== rec.id && !a.archived && pageUrlKey(a.profileUrl) === key);
      if (holder) return taken('profile URL', holder.id, `@${holder.username}`, 'profileUrl');
    }
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request),
        recordType: 'Social Account',
        recordId: rec.id,
        recordLabel: `@${rec.username}`,
        action: patch.archived ? 'archive' : patch.operationalStatus || patch.allocationStatus ? 'status-change' : 'update',
        reason: reason ?? 'Record updated',
        changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Assignments ──────────────────────────────────────────── */
  http.post(`${API}/assignments`, async ({ request }) => {
    await LATENCY();
    const body = sanitizeFields((await request.json()) as Partial<Assignment> & { reason?: string }, ASSIGNMENT_FIELDS);
    if (!body.resourceId || !body.newAssigneeId) return bad('A resource and a new assignee are required.');
    const role = body.role ?? 'Primary Custodian';
    const conflict = checkAssignmentConflict(db.assignments, {
      resourceType: body.resourceType ?? 'Social Account',
      resourceId: body.resourceId,
      role,
    });
    if (conflict.conflict) return bad(conflict.message, 409, { conflictId: conflict.existing?.id });

    const rec: Assignment = {
      id: nextId('ASG', db.assignments),
      resourceType: body.resourceType ?? 'Social Account',
      resourceId: body.resourceId,
      previousAssigneeId: body.previousAssigneeId ?? null,
      previousAssigneeType: body.previousAssigneeType ?? null,
      newAssigneeId: body.newAssigneeId,
      newAssigneeType: body.newAssigneeType ?? 'Team Member',
      role,
      brandId: body.brandId ?? null,
      projectId: body.projectId ?? null,
      startDate: body.startDate ?? now().slice(0, 10),
      expectedReturnDate: body.expectedReturnDate ?? null,
      purpose: body.purpose ?? '',
      handoverStatus: body.handoverStatus ?? 'Pending',
      acknowledgedAt: null,
      acknowledgedBy: null,
      returnedDate: null,
      credentialAction: body.credentialAction ?? 'None',
      active: true,
      notes: body.notes ?? '',
      createdAt: now(),
      updatedAt: now(),
    };
    db.assignments.unshift(rec);

    // Keep the resource's allocation status in step with its primary custodian.
    if (role === 'Primary Custodian') {
      if (rec.resourceType === 'Social Account') {
        const acc = db.socialAccounts.find((a) => a.id === rec.resourceId);
        if (acc) Object.assign(acc, { allocationStatus: 'Assigned', updatedAt: now() });
      } else if (rec.resourceType === 'SIM') {
        const sim = db.sims.find((s) => s.id === rec.resourceId);
        if (sim) Object.assign(sim, { allocationStatus: 'Assigned', assigneeId: rec.newAssigneeId, assigneeType: rec.newAssigneeType, updatedAt: now() });
      }
    }

    recordAudit({
      actor: actor(request),
      recordType: rec.resourceType,
      recordId: rec.resourceId,
      recordLabel: rec.resourceId,
      action: 'assign',
      reason: body.reason ?? rec.purpose ?? 'Resource assigned',
      changes: [
        { field: 'assignee', from: rec.previousAssigneeId, to: rec.newAssigneeId },
        { field: 'role', from: null, to: rec.role },
        { field: 'credentialAction', from: null, to: rec.credentialAction },
      ],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/assignments/:id`, async ({ request, params }) => {
    await LATENCY();
    const rec = db.assignments.find((a) => a.id === params.id);
    if (!rec) return bad('Assignment not found.', 404);
    const { reason, ...patch } = sanitizeFields((await request.json()) as Partial<Assignment> & { reason?: string }, ASSIGNMENT_FIELDS);
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });

    if (patch.active === false || patch.handoverStatus === 'Returned') {
      rec.active = false;
      rec.returnedDate = rec.returnedDate ?? now().slice(0, 10);
      if (rec.role === 'Primary Custodian') {
        if (rec.resourceType === 'Social Account') {
          const acc = db.socialAccounts.find((a) => a.id === rec.resourceId);
          if (acc) Object.assign(acc, { allocationStatus: 'Unassigned', updatedAt: now() });
        } else if (rec.resourceType === 'SIM') {
          const sim = db.sims.find((s) => s.id === rec.resourceId);
          if (sim) Object.assign(sim, { allocationStatus: 'Available', assigneeId: null, assigneeType: null, updatedAt: now() });
        }
      }
    }
    if (changes.length) {
      recordAudit({ actor: actor(request), recordType: rec.resourceType, recordId: rec.resourceId, recordLabel: rec.resourceId, action: 'assign', reason: reason ?? 'Handover updated', changes });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Credential references ────────────────────────────────── */
  http.patch(`${API}/credentials/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:credential-refs')) return noAccess();
    const rec = db.credentials.find((c) => c.id === params.id);
    if (!rec) return bad('Credential reference not found.', 404);
    const body = sanitizeFields((await request.json()) as Partial<CredentialRef> & { reason?: string; password?: string }, CREDENTIAL_FIELDS);
    // Defence in depth: reject any attempt to send secret material at all.
    for (const key of Object.keys(body)) {
      if (/pass|secret|token|cookie|code|otp/i.test(key)) {
        return bad(`Field "${key}" is rejected. This system stores vault references only, never secret values.`, 422);
      }
    }
    const { reason, ...patch } = body;
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request),
        recordType: 'Credential Reference',
        recordId: rec.id,
        recordLabel: rec.vaultRef,
        action: patch.lastRotationDate ? 'rotation' : patch.accessStatus ? 'credential-request' : 'update',
        reason: reason ?? 'Credential reference updated',
        changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Domains ──────────────────────────────────────────────── */
  http.post(`${API}/domains`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'access:domains')) return noAccess();
    const body = sanitizeFields((await request.json()) as Partial<DomainRecord> & { reason?: string }, DOMAIN_FIELDS);
    const extras = checkDomainExtras(body);
    if ('field' in extras) return bad(extras.message, 400, { field: extras.field });
    Object.assign(body, extras.value);
    const domainName = normalizeDomain(body.domainName ?? '');
    if (!domainName) return bad('A domain name is required.', 400, { field: 'domainName' });
    if (db.domains.some((d) => !d.archived && d.domainName === domainName)) {
      return bad(`${domainName} is already registered in the domain register.`, 409, { field: 'domainName' });
    }
    if (!body.registeredDate || !body.expirationDate) return bad('Registration and expiration dates are required.', 400);
    if (body.expirationDate < body.registeredDate) {
      return bad('Expiration date cannot precede the registration date.', 400, { field: 'expirationDate' });
    }
    const rec: DomainRecord = {
      id: nextId('DOM', db.domains),
      domainName,
      targetCountry: body.targetCountry ?? 'India',
      rotationDate: body.rotationDate ?? null,
      registeredDate: body.registeredDate,
      expirationDate: body.expirationDate,
      status: body.status ?? 'Active',
      registrar: body.registrar ?? '',
      registrarUid: body.registrarUid ?? '',
      category: body.category ?? '',
      nameservers: body.nameservers ?? '',
      brandId: body.brandId ?? null,
      notes: body.notes ?? '',
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.domains.unshift(rec);
    recordAudit({
      actor: actor(request),
      recordType: 'Domain',
      recordId: rec.id,
      recordLabel: rec.domainName,
      action: 'create',
      reason: body.reason ?? 'Domain added to register',
      changes: [
        { field: 'domainName', from: null, to: rec.domainName },
        { field: 'targetCountry', from: null, to: rec.targetCountry },
        { field: 'status', from: null, to: rec.status },
      ],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/domains/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domains')) return noAccess();
    const rec = db.domains.find((d) => d.id === params.id);
    if (!rec) return bad('Domain not found.', 404);
    const wasArchived = rec.archived;
    const body = sanitizeFields((await request.json()) as Partial<DomainRecord> & { reason?: string }, DOMAIN_FIELDS);
    const restoring = body.archived === false && wasArchived;
    if ((body.archived === true && !wasArchived) || restoring) {
      if (!may(request, 'archive:records')) return bad(`Your role (${actor(request).role}) cannot ${restoring ? 'restore' : 'archive'} records.`, 403);
      if (!body.reason?.trim()) return bad(`${restoring ? 'Restoring' : 'Archiving'} needs a written reason.`, 400, { field: 'reason' });
    }
    const extras = checkDomainExtras(body);
    if ('field' in extras) return bad(extras.message, 400, { field: extras.field });
    Object.assign(body, extras.value);
    if (body.domainName !== undefined) {
      body.domainName = normalizeDomain(body.domainName);
      if (!body.domainName) return bad('A domain name is required.', 400, { field: 'domainName' });
      if (db.domains.some((d) => d.id !== rec.id && !d.archived && d.domainName === body.domainName)) {
        return bad(`${body.domainName} is already registered in the domain register.`, 409, { field: 'domainName' });
      }
    }
    const registered = body.registeredDate ?? rec.registeredDate;
    const expiration = body.expirationDate ?? rec.expirationDate;
    if (expiration < registered) return bad('Expiration date cannot precede the registration date.', 400, { field: 'expirationDate' });

    const { reason, ...patch } = body;
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    const rotationChanged = changes.some((c) => c.field === 'rotationDate');
    const statusChanged = changes.some((c) => c.field === 'status');
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request),
        recordType: 'Domain',
        recordId: rec.id,
        recordLabel: rec.domainName,
        action: rotationChanged ? 'rotation' : statusChanged || restoring ? 'status-change' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Domain record updated',
        changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Domain Monitoring & Rotation (mirrors server/routes/domain-monitoring/) ── */
  http.post(`${API}/domain-monitoring`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'edit:resources')) return bad(`Your role (${actor(request).role}) cannot edit resources.`, 403);
    const body = sanitizeFields((await request.json()) as Partial<DomainMonitorRecord> & { reason?: string }, DOMAIN_MONITOR_FIELDS);
    const domainType = body.domainType;
    if (domainType !== 'Free Cash' && domainType !== 'Invite') return bad('Choose Free Cash or Invite Domain.', 400, { field: 'domainType' });
    const domainName = normalizeDomain(body.domainName ?? '');
    if (!domainName) return bad('A domain URL is required.', 400, { field: 'domainName' });
    if (db.domainMonitors.some((d) => d.domainName === domainName && d.domainType === domainType)) {
      return bad(`${domainName} is already a ${domainType} Domain.`, 409, { field: 'domainName' });
    }
    const rec: DomainMonitorRecord = {
      id: nextId('DMN', db.domainMonitors),
      domainType,
      domainName,
      activationStatus: domainType === 'Invite' ? 'Standby' : null,
      enabled: true,
      enabledDate: today(),
      nextRotationDate: null,
      lastAccessibilityStatus: 'Not Checked',
      lastCheckedDate: null,
      lastCheckedById: null,
      notes: body.notes ?? '',
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.domainMonitors.unshift(rec);
    recordAudit({
      actor: actor(request), recordType: 'Domain Monitor', recordId: rec.id, recordLabel: rec.domainName,
      action: 'create', reason: body.reason ?? `${domainType} Domain added`,
      changes: [{ field: 'domainName', from: null, to: rec.domainName }, { field: 'domainType', from: null, to: rec.domainType }],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.post(`${API}/domain-monitoring/bulk`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'import:records')) return bad(`Your role (${actor(request).role}) cannot import records.`, 403);
    const body = (await request.json()) as { domainType?: unknown; lines?: unknown; notes?: unknown; reason?: unknown };
    const domainType = body.domainType;
    if (domainType !== 'Free Cash' && domainType !== 'Invite') return bad('Choose Free Cash or Invite Domain.', 400, { field: 'domainType' });
    const lines = Array.isArray(body.lines) ? body.lines.map(String) : [];
    if (!lines.length) return bad('No domains were submitted.', 400);
    if (lines.length > 5000) return bad('A bulk add is limited to 5,000 domains. Split the list and run it again.', 400);
    const notes = sanitizeText(body.notes, 600);
    const existing = new Set(db.domainMonitors.filter((d) => d.domainType === domainType).map((d) => d.domainName));
    let created = 0;
    const problems: { line: number; reason: string }[] = [];
    for (const { line, domainName, problem } of validateDomainLines(lines, existing)) {
      if (!domainName) { problems.push({ line, reason: problem ?? 'Not a valid domain.' }); continue; }
      const rec: DomainMonitorRecord = {
        id: nextId('DMN', db.domainMonitors),
        domainType,
        domainName,
        activationStatus: domainType === 'Invite' ? 'Standby' : null,
        enabled: true,
        enabledDate: today(),
        nextRotationDate: null,
        lastAccessibilityStatus: 'Not Checked',
        lastCheckedDate: null,
        lastCheckedById: null,
        notes,
        archived: false,
        createdAt: now(),
        updatedAt: now(),
      };
      db.domainMonitors.unshift(rec);
      existing.add(domainName);
      created++;
    }
    recordAudit({
      actor: actor(request), recordType: 'Import', recordId: 'domain-monitoring', recordLabel: `${domainType} Domains bulk add`,
      action: 'import',
      reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason : 'Bulk add committed',
      changes: [{ field: 'rowsCreated', from: null, to: created }, { field: 'rowsSubmitted', from: null, to: lines.length }],
    });
    return HttpResponse.json({ created, skipped: lines.length - created, problems: problems.slice(0, 200) });
  }),

  http.patch(`${API}/domain-monitoring/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'edit:resources')) return bad(`Your role (${actor(request).role}) cannot edit resources.`, 403);
    const rec = db.domainMonitors.find((d) => d.id === params.id);
    if (!rec) return bad('Domain not found.', 404);
    const wasArchived = rec.archived;
    const body = sanitizeFields((await request.json()) as Partial<DomainMonitorRecord> & { reason?: string }, DOMAIN_MONITOR_FIELDS);

    if (body.activationStatus === 'Active' || body.activationStatus === 'Standby') {
      return bad('Active and Standby are set by a rotation, not a plain edit.', 400, { field: 'activationStatus' });
    }
    if (body.enabled === true && !rec.enabled) {
      body.enabledDate = today();
    }
    if (body.domainName !== undefined) {
      body.domainName = normalizeDomain(body.domainName);
      if (!body.domainName) return bad('A domain URL is required.', 400, { field: 'domainName' });
      const effectiveType = body.domainType ?? rec.domainType;
      if (db.domainMonitors.some((d) => d.id !== rec.id && d.domainName === body.domainName && d.domainType === effectiveType)) {
        return bad(`${body.domainName} is already a ${effectiveType} Domain.`, 409, { field: 'domainName' });
      }
    }
    const restoring = body.archived === false && wasArchived;
    if ((body.archived === true && !wasArchived) || restoring) {
      if (!may(request, 'archive:records')) return bad(`Your role (${actor(request).role}) cannot ${restoring ? 'restore' : 'archive'} records.`, 403);
      if (!body.reason?.trim()) return bad(`${restoring ? 'Restoring' : 'Archiving'} needs a written reason.`, 400, { field: 'reason' });
    }

    const { reason, ...patch } = body;
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    const statusChanged = changes.some((c) => c.field === 'activationStatus');
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request), recordType: 'Domain Monitor', recordId: rec.id, recordLabel: rec.domainName,
        action: statusChanged ? 'status-change' : restoring ? 'restore' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Domain monitor updated',
        changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  http.delete(`${API}/domain-monitoring/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    const who = actor(request);
    if (who.role !== SYSTEM_ADMIN_ROLE) return bad('Only the System Administrator can delete domains.', 403);
    const index = db.domainMonitors.findIndex((d) => d.id === params.id);
    if (index === -1) return bad('Domain not found.', 404);
    const body = (await request.json()) as { reason?: unknown };
    const reason = sanitizeText(body.reason, 500);
    if (!reason) return bad('Deleting a domain needs a written reason.', 400, { field: 'reason' });
    const [rec] = db.domainMonitors.splice(index, 1);
    db.domainCheckLogs = db.domainCheckLogs.filter((l) => l.domainMonitorId !== rec.id);
    db.rotationBatchMembers = db.rotationBatchMembers.filter((m) => m.domainMonitorId !== rec.id);
    recordAudit({
      actor: who, recordType: 'Domain Monitor', recordId: rec.id, recordLabel: rec.domainName, action: 'delete', reason, changes: [],
    });
    return HttpResponse.json({ deleted: rec.id });
  }),

  http.post(`${API}/domain-monitoring/:id/checks`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'record:domain-checks')) return bad(`Your role (${actor(request).role}) cannot log domain checks.`, 403);
    const rec = db.domainMonitors.find((d) => d.id === params.id);
    if (!rec) return bad('Domain not found.', 404);
    const body = (await request.json()) as { accessibilityStatus?: unknown; notes?: unknown };
    const status = body.accessibilityStatus;
    if (!(DOMAIN_ACCESSIBILITY_STATUS as readonly unknown[]).includes(status)) {
      return bad('Choose Accessible, Inaccessible, Intermittent or Not Checked.', 400, { field: 'accessibilityStatus' });
    }
    writeCheckLog(rec, status as DomainAccessibilityStatus, sanitizeText(body.notes, 600), actor(request).id);
    return HttpResponse.json(rec);
  }),

  http.post(`${API}/domain-monitoring/bulk-checks`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'record:domain-checks')) return bad(`Your role (${actor(request).role}) cannot log domain checks.`, 403);
    const body = (await request.json()) as { domainMonitorIds?: unknown; accessibilityStatus?: unknown; notes?: unknown };
    const ids = Array.isArray(body.domainMonitorIds) ? body.domainMonitorIds.map(String) : [];
    if (!ids.length) return bad('No domains were selected.', 400);
    const status = body.accessibilityStatus;
    if (!(DOMAIN_ACCESSIBILITY_STATUS as readonly unknown[]).includes(status)) {
      return bad('Choose Accessible, Inaccessible, Intermittent or Not Checked.', 400, { field: 'accessibilityStatus' });
    }
    const notes = sanitizeText(body.notes, 600);
    const who = actor(request);
    let updated = 0;
    const skipped: string[] = [];
    for (const domainId of ids) {
      const rec = db.domainMonitors.find((d) => d.id === domainId);
      if (!rec) { skipped.push(domainId); continue; }
      writeCheckLog(rec, status as DomainAccessibilityStatus, notes, who.id);
      updated++;
    }
    return HttpResponse.json({ updated, skipped: skipped.length, problems: skipped.map((domainId) => ({ domainId, reason: 'Not found.' })) });
  }),

  http.get(`${API}/domain-monitoring/:id/checks`, ({ request, params }) => {
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    const rec = db.domainMonitors.find((d) => d.id === params.id);
    if (!rec) return bad('Domain not found.', 404);
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const rows = db.domainCheckLogs
      .filter((l) => l.domainMonitorId === params.id)
      .filter((l) => (!from || l.checkDate >= from) && (!to || l.checkDate <= to))
      .sort((a, b) => (a.checkDate < b.checkDate ? 1 : -1));
    return HttpResponse.json(rows);
  }),

  http.get(`${API}/domain-monitoring/checks`, ({ request }) => {
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    const url = new URL(request.url);
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const rows = db.domainCheckLogs
      .filter((l) => (!from || l.checkDate >= from) && (!to || l.checkDate <= to))
      .sort((a, b) => (a.checkDate < b.checkDate ? 1 : -1));
    return HttpResponse.json(rows);
  }),

  /* ── Rotation groups & batches (configuration only; mirrors server/routes/domain-monitoring/batches.ts) ── */
  http.post(`${API}/domain-monitoring/groups`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'manage:rotation-batches')) return bad(`Your role (${actor(request).role}) cannot manage rotation batches.`, 403);
    const body = sanitizeFields((await request.json()) as Partial<RotationGroupRecord> & { reason?: string }, ROTATION_FIELDS);
    const name = body.name?.trim();
    if (!name) return bad('A group name is required.', 400, { field: 'name' });
    if (db.rotationGroups.some((g) => g.name === name)) return bad(`${name} is already a rotation group.`, 409, { field: 'name' });
    const rec: RotationGroupRecord = {
      id: nextId('RTG', db.rotationGroups), name, notes: body.notes ?? '',
      rotationIntervalDays: body.rotationIntervalDays ?? 5, cycleStartedAt: null, nextRotationDueAt: null,
      archived: false, createdAt: now(), updatedAt: now(),
    };
    db.rotationGroups.unshift(rec);
    recordAudit({
      actor: actor(request), recordType: 'Rotation Group', recordId: rec.id, recordLabel: name, action: 'create',
      reason: body.reason ?? 'Rotation group created', changes: [{ field: 'name', from: null, to: name }],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/domain-monitoring/groups/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'manage:rotation-batches')) return bad(`Your role (${actor(request).role}) cannot manage rotation batches.`, 403);
    const rec = db.rotationGroups.find((g) => g.id === params.id);
    if (!rec) return bad('Rotation group not found.', 404);
    const body = sanitizeFields((await request.json()) as Partial<RotationGroupRecord> & { reason?: string }, ROTATION_FIELDS);
    if (body.name !== undefined) {
      body.name = body.name.trim();
      if (!body.name) return bad('A group name is required.', 400, { field: 'name' });
      if (db.rotationGroups.some((g) => g.id !== rec.id && g.name === body.name)) return bad(`${body.name} is already a rotation group.`, 409, { field: 'name' });
    }
    if (body.cycleStartedAt !== undefined || body.nextRotationDueAt !== undefined) {
      return bad('The rotation schedule is set by a rotation or an override, not a plain edit.', 400, { field: 'nextRotationDueAt' });
    }
    const wasArchived = rec.archived;
    const restoring = body.archived === false && wasArchived;
    if ((body.archived === true && !wasArchived) || restoring) {
      if (!may(request, 'archive:records')) return bad(`Your role (${actor(request).role}) cannot ${restoring ? 'restore' : 'archive'} records.`, 403);
      if (!body.reason?.trim()) return bad(`${restoring ? 'Restoring' : 'Archiving'} needs a written reason.`, 400, { field: 'reason' });
    }
    const { reason, ...patch } = body;
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request), recordType: 'Rotation Group', recordId: rec.id, recordLabel: rec.name,
        action: restoring ? 'restore' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Rotation group updated', changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  http.post(`${API}/domain-monitoring/groups/:groupId/batches`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'manage:rotation-batches')) return bad(`Your role (${actor(request).role}) cannot manage rotation batches.`, 403);
    const group = db.rotationGroups.find((g) => g.id === params.groupId);
    if (!group) return bad('Rotation group not found.', 404);
    const body = sanitizeFields((await request.json()) as Partial<RotationBatchRecord> & { reason?: string }, ROTATION_FIELDS);
    const name = body.name?.trim();
    if (!name) return bad('A batch name is required.', 400, { field: 'name' });
    if (db.rotationBatches.some((b) => b.rotationGroupId === group.id && b.name === name)) return bad(`${name} already exists in this group.`, 409, { field: 'name' });
    const rec: RotationBatchRecord = {
      id: nextId('RTB', db.rotationBatches), rotationGroupId: group.id, name, status: 'Standby',
      archived: false, createdAt: now(), updatedAt: now(),
    };
    db.rotationBatches.unshift(rec);
    recordAudit({
      actor: actor(request), recordType: 'Rotation Batch', recordId: rec.id, recordLabel: `${group.name} / ${name}`, action: 'create',
      reason: body.reason ?? 'Rotation batch created', changes: [{ field: 'name', from: null, to: name }],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/domain-monitoring/batches/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'manage:rotation-batches')) return bad(`Your role (${actor(request).role}) cannot manage rotation batches.`, 403);
    const rec = db.rotationBatches.find((b) => b.id === params.id);
    if (!rec) return bad('Rotation batch not found.', 404);
    const body = sanitizeFields((await request.json()) as Partial<RotationBatchRecord> & { reason?: string }, ROTATION_FIELDS);
    if (body.name !== undefined) {
      body.name = body.name.trim();
      if (!body.name) return bad('A batch name is required.', 400, { field: 'name' });
      if (db.rotationBatches.some((b) => b.id !== rec.id && b.rotationGroupId === rec.rotationGroupId && b.name === body.name)) {
        return bad(`${body.name} already exists in this group.`, 409, { field: 'name' });
      }
    }
    if (body.status !== undefined) return bad('A batch becomes Active or Standby through a rotation, not a plain edit.', 400, { field: 'status' });
    if (body.archived === true && rec.status === 'Active') return bad('Rotate this batch out before archiving it.', 400, { field: 'archived' });
    const wasArchived = rec.archived;
    const restoring = body.archived === false && wasArchived;
    if ((body.archived === true && !wasArchived) || restoring) {
      if (!may(request, 'archive:records')) return bad(`Your role (${actor(request).role}) cannot ${restoring ? 'restore' : 'archive'} records.`, 403);
      if (!body.reason?.trim()) return bad(`${restoring ? 'Restoring' : 'Archiving'} needs a written reason.`, 400, { field: 'reason' });
    }
    const { reason, ...patch } = body;
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request), recordType: 'Rotation Batch', recordId: rec.id, recordLabel: rec.name,
        action: restoring ? 'restore' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Rotation batch updated', changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  http.put(`${API}/domain-monitoring/batches/:id/members`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'manage:rotation-batches')) return bad(`Your role (${actor(request).role}) cannot manage rotation batches.`, 403);
    const batch = db.rotationBatches.find((b) => b.id === params.id);
    if (!batch) return bad('Rotation batch not found.', 404);
    const body = (await request.json()) as { domainMonitorIds?: unknown };
    const ids = [...new Set(Array.isArray(body.domainMonitorIds) ? body.domainMonitorIds.map(String) : [])];
    for (const domainId of ids) {
      const domain = db.domainMonitors.find((d) => d.id === domainId);
      if (!domain) return bad(`Domain ${domainId} was not found.`, 400, { field: 'domainMonitorIds' });
      if (domain.domainType !== 'Invite') return bad('Only Invite Domains can belong to a rotation batch.', 400, { field: 'domainMonitorIds' });
      if (domain.archived) return bad('An archived domain cannot be added to a rotation batch.', 400, { field: 'domainMonitorIds' });
    }
    db.rotationBatchMembers = db.rotationBatchMembers.filter((m) => m.rotationBatchId !== batch.id && !ids.includes(m.domainMonitorId));
    for (const domainId of ids) {
      db.rotationBatchMembers.push({ rotationBatchId: batch.id, domainMonitorId: domainId, createdAt: now() });
    }
    return HttpResponse.json({
      rotationBatchId: batch.id,
      domainMonitorIds: db.rotationBatchMembers.filter((m) => m.rotationBatchId === batch.id).map((m) => m.domainMonitorId),
    });
  }),

  /* ── Running a rotation (mirrors server/routes/domain-monitoring/rotation.ts) ── */
  http.post(`${API}/domain-monitoring/groups/:id/rotate-full`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'execute:full-rotation')) return bad(`Your role (${actor(request).role}) cannot run a full rotation.`, 403);
    const group = db.rotationGroups.find((g) => g.id === params.id);
    if (!group) return bad('Rotation group not found.', 404);
    if (group.archived) return bad('This rotation group is archived.', 400);

    const body = sanitizeFields((await request.json()) as { incomingBatchId?: string; reason?: string }, ROTATION_FIELDS);
    const reason = body.reason?.trim();
    if (!reason || reason.length < 10) return bad('A full rotation needs a written reason of at least 10 characters.', 400, { field: 'reason' });
    const incoming = db.rotationBatches.find((b) => b.id === body.incomingBatchId && b.rotationGroupId === group.id);
    if (!incoming) return bad('That batch does not belong to this group.', 400, { field: 'incomingBatchId' });
    if (incoming.archived) return bad('That batch is archived.', 400, { field: 'incomingBatchId' });
    if (incoming.status === 'Active') return bad('That batch is already Active.', 400, { field: 'incomingBatchId' });

    const outgoing = db.rotationBatches.find((b) => b.rotationGroupId === group.id && b.status === 'Active' && !b.archived);
    const incomingIds = db.rotationBatchMembers.filter((m) => m.rotationBatchId === incoming.id).map((m) => m.domainMonitorId);
    if (!incomingIds.length) return bad('That batch has no domains assigned to it.', 400, { field: 'incomingBatchId' });
    const outgoingIds = outgoing ? db.rotationBatchMembers.filter((m) => m.rotationBatchId === outgoing.id).map((m) => m.domainMonitorId) : [];

    const nowIso = now();
    const newDue = new Date(Date.now() + group.rotationIntervalDays * 86_400_000).toISOString();
    if (outgoing) { outgoing.status = 'Standby'; outgoing.updatedAt = nowIso; }
    incoming.status = 'Active'; incoming.updatedAt = nowIso;
    for (const id of outgoingIds) { const d = db.domainMonitors.find((x) => x.id === id); if (d) { d.activationStatus = 'Standby'; d.updatedAt = nowIso; } }
    for (const id of incomingIds) { const d = db.domainMonitors.find((x) => x.id === id); if (d) { d.activationStatus = 'Active'; d.updatedAt = nowIso; } }
    const previousDueAt = group.nextRotationDueAt;
    group.cycleStartedAt = nowIso; group.nextRotationDueAt = newDue; group.updatedAt = nowIso;

    const eventId = nextId('RTE', db.rotationEvents, 5);
    const who = actor(request);
    db.rotationEvents.unshift({
      id: eventId, rotationGroupId: group.id, eventType: 'full_rotation',
      outgoingBatchId: outgoing?.id ?? null, incomingBatchId: incoming.id,
      previousDueAt, newDueAt: newDue, previousIntervalDays: null, newIntervalDays: null,
      isOverride: false, reason, performedById: who.id, performedAt: nowIso, createdAt: nowIso,
    });
    let position = 0;
    for (const id of outgoingIds) {
      db.rotationEventDomainChanges.push({ rotationEventId: eventId, position: position++, domainMonitorId: id, fromBatchId: outgoing!.id, toBatchId: outgoing!.id, fromActivationStatus: 'Active', toActivationStatus: 'Standby' });
    }
    for (const id of incomingIds) {
      db.rotationEventDomainChanges.push({ rotationEventId: eventId, position: position++, domainMonitorId: id, fromBatchId: incoming.id, toBatchId: incoming.id, fromActivationStatus: 'Standby', toActivationStatus: 'Active' });
    }
    recordAudit({
      actor: who, recordType: 'Rotation Event', recordId: group.id, recordLabel: `${group.name}: full rotation to ${incoming.name}`,
      action: 'rotation', reason, changes: [{ field: 'activeBatch', from: outgoing?.name ?? null, to: incoming.name }],
    });
    return HttpResponse.json(group);
  }),

  http.post(`${API}/domain-monitoring/groups/:id/rotate-partial`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'execute:partial-rotation')) return bad(`Your role (${actor(request).role}) cannot run a partial rotation.`, 403);
    const group = db.rotationGroups.find((g) => g.id === params.id);
    if (!group) return bad('Rotation group not found.', 404);
    if (group.archived) return bad('This rotation group is archived.', 400);

    const body = sanitizeFields((await request.json()) as { moves?: unknown; reason?: string }, ROTATION_FIELDS);
    const reason = body.reason?.trim();
    if (!reason || reason.length < 10) return bad('A partial rotation needs a written reason of at least 10 characters.', 400, { field: 'reason' });
    const moves = Array.isArray(body.moves)
      ? (body.moves as { domainMonitorId?: unknown; toBatchId?: unknown }[]).filter((m) => typeof m.domainMonitorId === 'string' && typeof m.toBatchId === 'string')
      : [];
    if (!moves.length) return bad('Choose at least one domain to move.', 400, { field: 'moves' });

    const groupBatches = db.rotationBatches.filter((b) => b.rotationGroupId === group.id && !b.archived);
    const batchById = new Map(groupBatches.map((b) => [b.id, b]));
    const nowIso = now();
    const changes: { domainMonitorId: string; fromBatchId: string | null; toBatchId: string | null; fromActivationStatus: DomainMonitorRecord['activationStatus']; toActivationStatus: RotationBatchRecord['status'] }[] = [];

    for (const move of moves) {
      const domainId = String(move.domainMonitorId);
      const toBatchId = String(move.toBatchId);
      const toBatch = batchById.get(toBatchId);
      if (!toBatch) return bad(`Batch ${toBatchId} does not belong to this group.`, 400, { field: 'moves' });
      const currentMembership = db.rotationBatchMembers.find((m) => m.domainMonitorId === domainId);
      const fromBatchId = currentMembership?.rotationBatchId ?? null;
      if (fromBatchId && !batchById.has(fromBatchId)) return bad(`Domain ${domainId} does not belong to this group.`, 400, { field: 'moves' });
      if (fromBatchId === toBatchId) continue;
      const domain = db.domainMonitors.find((d) => d.id === domainId);
      if (!domain) return bad(`Domain ${domainId} was not found.`, 400, { field: 'moves' });

      db.rotationBatchMembers = db.rotationBatchMembers.filter((m) => m.domainMonitorId !== domainId);
      db.rotationBatchMembers.push({ rotationBatchId: toBatchId, domainMonitorId: domainId, createdAt: nowIso });
      const fromActivationStatus = domain.activationStatus;
      domain.activationStatus = toBatch.status;
      domain.updatedAt = nowIso;
      changes.push({ domainMonitorId: domainId, fromBatchId, toBatchId, fromActivationStatus, toActivationStatus: toBatch.status });
    }
    if (!changes.length) return bad('None of the chosen domains needed to move.', 400, { field: 'moves' });

    const eventId = nextId('RTE', db.rotationEvents, 5);
    const who = actor(request);
    db.rotationEvents.unshift({
      id: eventId, rotationGroupId: group.id, eventType: 'partial_rotation', outgoingBatchId: null, incomingBatchId: null,
      previousDueAt: null, newDueAt: null, previousIntervalDays: null, newIntervalDays: null,
      isOverride: false, reason, performedById: who.id, performedAt: nowIso, createdAt: nowIso,
    });
    changes.forEach((c, position) => db.rotationEventDomainChanges.push({ rotationEventId: eventId, position, ...c }));
    recordAudit({
      actor: who, recordType: 'Rotation Event', recordId: group.id, recordLabel: `${group.name}: partial rotation (${changes.length} domain${changes.length === 1 ? '' : 's'})`,
      action: 'rotation', reason, changes: changes.map((c) => ({ field: c.domainMonitorId, from: c.fromBatchId, to: c.toBatchId })),
    });
    return HttpResponse.json(group);
  }),

  http.post(`${API}/domain-monitoring/groups/:id/override`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:domain-monitoring')) return noAccess();
    if (!may(request, 'override:rotation-schedule')) return bad(`Your role (${actor(request).role}) cannot override the rotation schedule.`, 403);
    const group = db.rotationGroups.find((g) => g.id === params.id);
    if (!group) return bad('Rotation group not found.', 404);
    if (group.archived) return bad('This rotation group is archived.', 400);

    const body = sanitizeFields((await request.json()) as { action?: string; newDueAt?: string; newIntervalDays?: unknown; reason?: string }, ROTATION_FIELDS);
    const reason = body.reason?.trim();
    if (!reason || reason.length < 10) return bad('An override needs a written reason of at least 10 characters.', 400, { field: 'reason' });

    const nowIso = now();
    const previousDueAt = group.nextRotationDueAt;
    const previousIntervalDays = group.rotationIntervalDays;
    let eventType: string;
    let newDueAt: string | null = previousDueAt;
    let newIntervalDays: number | null = null;

    if (body.action === 'postpone') {
      if (!body.newDueAt) return bad('Choose a new rotation date.', 400, { field: 'newDueAt' });
      const d = new Date(body.newDueAt);
      if (Number.isNaN(d.getTime())) return bad('That date is not valid.', 400, { field: 'newDueAt' });
      newDueAt = d.toISOString();
      eventType = 'postpone';
    } else if (body.action === 'early_complete') {
      newDueAt = new Date(Date.now() + group.rotationIntervalDays * 86_400_000).toISOString();
      eventType = 'early_complete';
      group.cycleStartedAt = nowIso;
    } else if (body.action === 'change_interval') {
      const days = Number(body.newIntervalDays);
      if (!Number.isInteger(days) || days < 1 || days > 90) return bad('Choose a whole number of days between 1 and 90.', 400, { field: 'newIntervalDays' });
      newIntervalDays = days;
      newDueAt = group.cycleStartedAt ? new Date(new Date(group.cycleStartedAt).getTime() + days * 86_400_000).toISOString() : previousDueAt;
      eventType = 'change_interval';
    } else {
      return bad('Choose postpone, early_complete or change_interval.', 400, { field: 'action' });
    }

    group.nextRotationDueAt = newDueAt;
    if (newIntervalDays !== null) group.rotationIntervalDays = newIntervalDays;
    group.updatedAt = nowIso;

    const eventId = nextId('RTE', db.rotationEvents, 5);
    const who = actor(request);
    db.rotationEvents.unshift({
      id: eventId, rotationGroupId: group.id, eventType: eventType as RotationEventRecord['eventType'], outgoingBatchId: null, incomingBatchId: null,
      previousDueAt, newDueAt, previousIntervalDays, newIntervalDays, isOverride: true, reason, performedById: who.id, performedAt: nowIso, createdAt: nowIso,
    });
    recordAudit({
      actor: who, recordType: 'Rotation Event', recordId: group.id, recordLabel: `${group.name}: ${eventType.replace('_', ' ')} override`,
      action: 'rotation', reason,
      changes: [
        { field: 'nextRotationDueAt', from: previousDueAt, to: newDueAt },
        ...(newIntervalDays !== null ? [{ field: 'rotationIntervalDays', from: previousIntervalDays, to: newIntervalDays }] : []),
      ],
    });
    return HttpResponse.json(group);
  }),

  /* ── Pakistan Competitor register ────────────────────────── */
  http.post(`${API}/pakistan-competitors`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'edit:resources')) return noAccess();
    const body = sanitizeFields((await request.json()) as Partial<CompetitorRecord> & { reason?: string }, COMPETITOR_FIELDS);
    const linkOrDomain = (body.linkOrDomain ?? '').trim();
    if (!linkOrDomain) return bad('A link or domain is required.', 400, { field: 'linkOrDomain' });
    const platformId = body.platformId ?? '';
    if (!platformId) return bad('Select a platform.', 400, { field: 'platformId' });
    const rec: CompetitorRecord = {
      id: nextId('CMP', db.pakistanCompetitors),
      platformId,
      linkOrDomain,
      whatsapp: body.whatsapp ?? '',
      telegram: body.telegram ?? '',
      others: body.others ?? '',
      notes: body.notes ?? '',
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.pakistanCompetitors.unshift(rec);
    recordAudit({
      actor: actor(request),
      recordType: 'Pakistan Competitor',
      recordId: rec.id,
      recordLabel: rec.linkOrDomain,
      action: 'create',
      reason: body.reason ?? 'Competitor added to register',
      changes: [{ field: 'linkOrDomain', from: null, to: rec.linkOrDomain }],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/pakistan-competitors/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'edit:resources')) return noAccess();
    const rec = db.pakistanCompetitors.find((c) => c.id === params.id);
    if (!rec) return bad('Competitor not found.', 404);
    const wasArchived = rec.archived;
    const body = sanitizeFields((await request.json()) as Partial<CompetitorRecord> & { reason?: string }, COMPETITOR_FIELDS);
    const restoring = body.archived === false && wasArchived;
    if ((body.archived === true && !wasArchived) || restoring) {
      if (!may(request, 'archive:records')) return bad(`Your role (${actor(request).role}) cannot ${restoring ? 'restore' : 'archive'} records.`, 403);
      if (!body.reason?.trim()) return bad(`${restoring ? 'Restoring' : 'Archiving'} needs a written reason.`, 400, { field: 'reason' });
    }
    if (body.linkOrDomain !== undefined) {
      body.linkOrDomain = body.linkOrDomain.trim();
      if (!body.linkOrDomain) return bad('A link or domain is required.', 400, { field: 'linkOrDomain' });
    }
    const { reason, ...patch } = body;
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request),
        recordType: 'Pakistan Competitor',
        recordId: rec.id,
        recordLabel: rec.linkOrDomain,
        action: restoring ? 'restore' : patch.archived ? 'archive' : 'update',
        reason: reason ?? 'Competitor record updated',
        changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Data Leads register (mirrors server/routes/data-leads.ts) ── */
  http.patch(`${API}/data-leads/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:data-leads')) return noAccess();
    if (!may(request, 'edit:resources')) return bad(`Your role (${actor(request).role}) cannot edit resources.`, 403);
    const rec = db.dataLeads.find((l) => l.id === params.id);
    if (!rec) return bad('Lead not found.', 404);
    const body = sanitizeFields((await request.json()) as Partial<DataLeadRecord> & { reason?: string }, DATA_LEAD_FIELDS);
    const { reason, ...rest } = body;
    const patch = rest as Record<string, unknown>;
    const who = actor(request);

    if (patch.assignedTo !== undefined && patch.assignedTo !== null
      && !(DATA_LEAD_ASSIGNEE as readonly string[]).includes(patch.assignedTo as string)) {
      return bad('Not a recognised person to assign.', 400, { field: 'assignedTo' });
    }

    if (typeof patch.status === 'string' && patch.status !== rec.status) {
      if (patch.status === 'Not contacted') {
        patch.contactedAt = null;
        patch.contactedById = null;
      } else if (rec.status === 'Not contacted') {
        patch.contactedAt = now();
        patch.contactedById = who.id;
      }
    }

    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: who, recordType: 'Data Lead', recordId: rec.id, recordLabel: rec.creator,
        action: changes.some((c) => c.field === 'status') ? 'status-change' : 'update',
        reason: reason ?? 'Lead updated',
        changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  http.delete(`${API}/data-leads/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'access:data-leads')) return noAccess();
    const who = actor(request);
    if (who.role !== SYSTEM_ADMIN_ROLE) return bad('Only the System Administrator can delete leads.', 403);
    const index = db.dataLeads.findIndex((l) => l.id === params.id);
    if (index === -1) return bad('Lead not found.', 404);
    const body = (await request.json()) as { reason?: unknown };
    const reason = sanitizeText(body.reason, 500);
    if (!reason) return bad('Deleting a lead needs a written reason.', 400, { field: 'reason' });
    const [rec] = db.dataLeads.splice(index, 1);
    recordAudit({
      actor: who, recordType: 'Data Lead', recordId: rec.id, recordLabel: rec.creator, action: 'delete', reason, changes: [],
    });
    return HttpResponse.json({ deleted: rec.id });
  }),

  http.post(`${API}/data-leads/import`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'access:data-leads')) return noAccess();
    if (!may(request, 'import:records')) return bad(`Your role (${actor(request).role}) cannot import records in bulk.`, 403);
    const { countryCode, platformId, niche, rows, reason } = (await request.json()) as {
      countryCode?: string; platformId?: string; niche?: string; rows?: Record<string, unknown>[]; reason?: string;
    };
    if (!Array.isArray(rows) || !rows.length) return bad('No rows were submitted.');
    const country = db.countries.find((c) => c.code === countryCode);
    if (!country) return bad('Choose a country.', 400, { field: 'countryCode' });
    const defaultPlatform = db.platforms.find((p) => p.id === platformId);
    if (!defaultPlatform) return bad('Choose a platform.', 400, { field: 'platformId' });

    const niceNiche = sanitizeText(niche, 160);
    const existing = new Set(db.dataLeads.map((l) => leadChannelKey(l.countryCode, l.platformId, l.channelUrl)));
    const seen = new Set<string>();
    const who = actor(request);
    let created = 0;
    const problems: { row: number; reason: string }[] = [];

    const rawFrom = (row: Record<string, unknown>): Partial<Record<LeadImportKey, string>> => ({
      platform: typeof row.platform === 'string' ? row.platform : '',
      creator: typeof row.creator === 'string' ? row.creator : '',
      channelUrl: typeof row.channelUrl === 'string' ? row.channelUrl : '',
      subscribers: typeof row.subscribers === 'string' ? row.subscribers : '',
      tier: typeof row.tier === 'string' ? row.tier : '',
      keyword: typeof row.keyword === 'string' ? row.keyword : '',
      promoConfidence: typeof row.promoConfidence === 'string' ? row.promoConfidence : '',
      evidenceTitle: typeof row.evidenceTitle === 'string' ? row.evidenceTitle : '',
      evidenceUrl: typeof row.evidenceUrl === 'string' ? row.evidenceUrl : '',
      publicEmail: typeof row.publicEmail === 'string' ? row.publicEmail : '',
      publicTelegram: typeof row.publicTelegram === 'string' ? row.publicTelegram : '',
      publicInstagram: typeof row.publicInstagram === 'string' ? row.publicInstagram : '',
      status: typeof row.status === 'string' ? row.status : '',
    });

    for (const [index, row] of rows.entries()) {
      const rowNumber = Number((row as { rowNumber?: unknown })?.rowNumber) || index + 1;
      const { value, problems: rowProblems } = validateLeadRow(rawFrom(row), {
        platforms: db.platforms, defaultPlatformId: defaultPlatform.id, countryCode: country.code, existing, seen,
      });
      if (!value) {
        problems.push({ row: rowNumber, reason: rowProblems.map((p) => `${p.column}: ${p.message}`).join(' ') });
        continue;
      }
      db.dataLeads.unshift({
        id: nextId('LED', db.dataLeads), countryCode: country.code, niche: niceNiche, notes: '',
        ...value, contactedAt: null, contactedById: null, assignedTo: null, createdAt: now(), updatedAt: now(),
      });
      seen.add(leadChannelKey(country.code, value.platformId, value.channelUrl));
      created++;
    }

    recordAudit({
      actor: who, recordType: 'Import', recordId: 'data-leads', recordLabel: `Data Leads upload (${niceNiche || 'uncategorised'})`,
      action: 'import', reason: reason ?? 'CSV import committed',
      changes: [
        { field: 'rowsCreated', from: null, to: created },
        { field: 'rowsSubmitted', from: null, to: rows.length },
      ],
    });
    return HttpResponse.json({ created, skipped: rows.length - created, problems: problems.slice(0, 200) });
  }),

  /* ── Social Media Posting ─────────────────────────────────── */

  http.post(`${API}/social-media-posts`, async ({ request }) => {
    await LATENCY();
    if (!may(request, 'edit:resources')) return noAccess();
    const body = sanitizeFields((await request.json()) as Partial<SocialMediaPost> & { reason?: string }, SOCIAL_POST_FIELDS);
    if (!body.marketingMemberId) return bad('Select who posted this.', 400, { field: 'marketingMemberId' });
    if (!body.purpose) return bad('Select a purpose.', 400, { field: 'purpose' });
    if (!body.platform) return bad('Select a platform.', 400, { field: 'platform' });
    if (!body.postDate) return bad('A date is required.', 400, { field: 'postDate' });
    const postLink = (body.postLink ?? '').trim();
    if (!postLink) return bad('A post link is required.', 400, { field: 'postLink' });
    const extrasProblem = applySocialPostExtras(body);
    if (extrasProblem) return extrasProblem;

    const who = actor(request);
    const rec: SocialMediaPost = {
      id: nextId('SMP', db.socialMediaPosts),
      marketingMemberId: body.marketingMemberId,
      purpose: body.purpose,
      customPurpose: body.customPurpose ?? '',
      platform: body.platform,
      customPlatform: body.customPlatform ?? '',
      postDate: body.postDate,
      postLink,
      notes: body.notes ?? '',
      status: 'active',
      archivedAt: null,
      archivedById: null,
      createdById: who.id || null,
      createdAt: now(),
      updatedAt: now(),
    };
    db.socialMediaPosts.unshift(rec);
    recordAudit({
      actor: who,
      recordType: 'Social Media Post',
      recordId: rec.id,
      recordLabel: `${rec.id} — ${rec.platform}`,
      action: 'create',
      reason: body.reason ?? 'Post logged',
      changes: [{ field: 'postLink', from: null, to: postLink }],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/social-media-posts/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'edit:resources')) return noAccess();
    const rec = db.socialMediaPosts.find((p) => p.id === params.id);
    if (!rec) return bad('Post not found.', 404);
    const body = sanitizeFields((await request.json()) as Partial<SocialMediaPost> & { reason?: string }, SOCIAL_POST_FIELDS);
    if (body.postLink !== undefined) {
      body.postLink = body.postLink.trim();
      if (!body.postLink) return bad('A post link is required.', 400, { field: 'postLink' });
    }
    const extrasProblem = applySocialPostExtras(body, rec);
    if (extrasProblem) return extrasProblem;

    const changingStatus = body.status !== undefined && body.status !== rec.status;
    if (changingStatus) {
      if (!may(request, 'archive:records')) {
        return bad(`Your role (${actor(request).role}) cannot ${body.status === 'archived' ? 'archive' : 'restore'} records.`, 403);
      }
      if (!body.reason?.trim()) {
        return bad(`${body.status === 'archived' ? 'Archiving' : 'Restoring'} needs a written reason.`, 400, { field: 'reason' });
      }
    }

    const { reason, ...patch } = body;
    if (changingStatus) {
      patch.archivedAt = patch.status === 'archived' ? now() : null;
      patch.archivedById = patch.status === 'archived' ? actor(request).id : null;
    }
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request),
        recordType: 'Social Media Post',
        recordId: rec.id,
        recordLabel: `${rec.id} — ${rec.platform}`,
        action: changingStatus ? (patch.status === 'archived' ? 'archive' : 'restore') : 'update',
        reason: reason ?? 'Post updated',
        changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  http.delete(`${API}/social-media-posts/:id`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'archive:records')) return noAccess();
    const index = db.socialMediaPosts.findIndex((p) => p.id === params.id);
    if (index === -1) return bad('Post not found.', 404);
    const rec = db.socialMediaPosts[index];
    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = (body.reason ?? '').trim();
    if (!reason) return bad('Deleting a post needs a written reason.', 400, { field: 'reason' });
    db.socialMediaPosts.splice(index, 1);
    // Mirrors the real schema's ON DELETE CASCADE: a post's screenshot cannot
    // outlive the post.
    const screenshotIndex = db.socialPostScreenshots.findIndex((s) => s.postId === rec.id);
    if (screenshotIndex !== -1) db.socialPostScreenshots.splice(screenshotIndex, 1);
    delete db.screenshotImages[rec.id];
    recordAudit({
      actor: actor(request),
      recordType: 'Social Media Post',
      recordId: rec.id,
      recordLabel: `${rec.id} — ${rec.platform}`,
      action: 'delete',
      reason,
      changes: [],
    });
    return HttpResponse.json({ deleted: rec.id });
  }),

  http.post(`${API}/social-media-posts/:id/screenshot`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'edit:resources')) return noAccess();
    const post = db.socialMediaPosts.find((p) => p.id === params.id);
    if (!post) return bad('Post not found.', 404);
    const body = (await request.json()) as { image?: unknown };
    const bytes = decodeBase64Image(body.image);
    if (!bytes) return bad('The image could not be read. Choose the file again.', 400, { field: 'image' });
    const image = checkProofImage(bytes);
    if ('error' in image) return bad(image.error, 400, { field: 'image' });

    const who = actor(request);
    const meta: SocialPostScreenshot = {
      postId: post.id, mimeType: image.mime, sizeBytes: bytes.length, uploadedById: who.id, uploadedByName: who.name, uploadedAt: now(),
    };
    const existingIndex = db.socialPostScreenshots.findIndex((s) => s.postId === post.id);
    if (existingIndex !== -1) db.socialPostScreenshots.splice(existingIndex, 1, meta);
    else db.socialPostScreenshots.unshift(meta);
    db.screenshotImages[post.id] = { mime: image.mime, base64: String(body.image).replace(/^data:[^;,]*;base64,/, '') };

    recordAudit({
      actor: who, recordType: 'Social Media Post', recordId: post.id, recordLabel: `${post.id} — ${post.platform}`,
      action: 'update', reason: 'Screenshot uploaded', changes: [{ field: 'screenshot', from: null, to: '[uploaded]' }],
    });
    return HttpResponse.json(meta, { status: 201 });
  }),

  http.get(`${API}/social-media-posts/:id/screenshot`, ({ params }) => {
    const stored = db.screenshotImages[String(params.id)];
    if (!stored) return bad('No screenshot for this post.', 404);
    const bytes = decodeBase64Image(stored.base64) ?? new Uint8Array();
    return new HttpResponse(bytes, { headers: { 'Content-Type': stored.mime } });
  }),

  http.delete(`${API}/social-media-posts/:id/screenshot`, async ({ request, params }) => {
    await LATENCY();
    if (!may(request, 'edit:resources')) return noAccess();
    const post = db.socialMediaPosts.find((p) => p.id === params.id);
    if (!post) return bad('Post not found.', 404);
    const index = db.socialPostScreenshots.findIndex((s) => s.postId === post.id);
    if (index === -1) return bad('No screenshot for this post.', 404);
    db.socialPostScreenshots.splice(index, 1);
    delete db.screenshotImages[post.id];
    recordAudit({
      actor: actor(request), recordType: 'Social Media Post', recordId: post.id, recordLabel: `${post.id} — ${post.platform}`,
      action: 'update', reason: 'Screenshot removed', changes: [{ field: 'screenshot', from: '[uploaded]', to: null }],
    });
    return HttpResponse.json({ removed: post.id });
  }),

  /* ── Follower snapshots ───────────────────────────────────── */

  /** A day's numbers for many accounts in one audited action.
   *
   *  Upserts on (accountId, date): re-saving a date corrects that day rather than
   *  adding a second row, and the correction is audited. The account's own
   *  follower figure is written through from its newest snapshot, so the register,
   *  the exports and this module can never show different numbers. */
  http.post(`${API}/follower-snapshots/bulk`, async ({ request }) => {
    await LATENCY();
    const body = sanitizeFields((await request.json()) as {
      date?: string;
      entries?: { accountId: string; followerCount: number }[];
      reason?: string;
    }, SNAPSHOT_FIELDS);
    const date = body.date ?? '';
    const entries = body.entries ?? [];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad('A valid date is required.', 400, { field: 'date' });
    if (date > now().slice(0, 10)) return bad('A future date cannot have been observed yet.', 400, { field: 'date' });
    if (!entries.length) return bad('No follower numbers were submitted.', 400);

    const invalid = entries.find(
      (e) => !db.socialAccounts.some((a) => a.id === e.accountId) ||
        !Number.isFinite(e.followerCount) || e.followerCount < 0 || !Number.isInteger(e.followerCount),
    );
    if (invalid) {
      return bad(
        `${invalid.accountId}: a follower total must be a whole number of zero or more.`,
        400,
        { field: invalid.accountId },
      );
    }

    let created = 0;
    let corrected = 0;
    const who = actor(request);

    for (const entry of entries) {
      const existing = db.followerSnapshots.find((s) => s.accountId === entry.accountId && s.date === date);
      if (existing) {
        if (existing.followerCount !== entry.followerCount) {
          recordAudit({
            actor: who, recordType: 'Follower Snapshot', recordId: existing.id,
            recordLabel: `${entry.accountId} on ${date}`, action: 'update',
            reason: body.reason ?? 'Daily follower total corrected',
            changes: [{ field: 'followerCount', from: existing.followerCount, to: entry.followerCount }],
          });
          existing.followerCount = entry.followerCount;
          existing.recordedById = who.id;
          existing.recordedAt = now();
          corrected++;
        }
      } else {
        db.followerSnapshots.push({
          id: nextId('FSN', db.followerSnapshots, 5),
          accountId: entry.accountId,
          date,
          followerCount: entry.followerCount,
          recordedById: who.id,
          recordedAt: now(),
          note: '',
        });
        created++;
      }

      // Write through to the account, but only from its newest snapshot — a
      // back-filled older day must not overwrite a more recent total.
      const account = db.socialAccounts.find((a) => a.id === entry.accountId);
      if (account) {
        const newest = db.followerSnapshots
          .filter((s) => s.accountId === entry.accountId)
          .reduce<FollowerSnapshot | null>((a, b) => (a && a.date >= b.date ? a : b), null);
        if (newest) {
          account.followerCount = newest.followerCount;
          account.followerCountMeasuredAt = newest.date;
          account.updatedAt = now();
        }
      }
    }

    recordAudit({
      actor: who, recordType: 'Follower Snapshot', recordId: date, recordLabel: `Daily follower entry for ${date}`,
      action: 'update', reason: body.reason ?? 'Daily follower numbers recorded',
      changes: [
        { field: 'accountsRecorded', from: null, to: created },
        { field: 'accountsCorrected', from: null, to: corrected },
      ],
    });

    return HttpResponse.json({ date, created, corrected });
  }),

  /* ── Content posts ────────────────────────────────────────── */
  http.post(`${API}/content-posts`, async ({ request }) => {
    await LATENCY();
    const body = sanitizeFields((await request.json()) as Partial<ContentPost> & { reason?: string }, CONTENT_POST_FIELDS);
    const account = db.socialAccounts.find((a) => a.id === body.accountId);
    if (!account) return bad('Select the account this was posted from.', 400, { field: 'accountId' });
    if (!body.title?.trim()) return bad('A title is required.', 400, { field: 'title' });
    const postKey = postUrlKey(body.url);
    const postHolder = postKey ? db.contentPosts.find((c) => !c.archived && postUrlKey(c.url) === postKey) : undefined;
    if (postHolder) return taken('post URL', postHolder.id, `“${postHolder.title}”`, 'url');

    const counts = { views: body.views, likes: body.likes, comments: body.comments, shares: body.shares };
    for (const [field, v] of Object.entries(counts)) {
      if (!Number.isInteger(v) || (v as number) < 0) {
        return bad(`${field} must be a whole number of zero or more.`, 400, { field });
      }
    }
    const engagements = (body.likes ?? 0) + (body.comments ?? 0) + (body.shares ?? 0);
    if (engagements > (body.views ?? 0)) {
      return bad('Engagements cannot exceed views — check the numbers.', 400, { field: 'views' });
    }

    const rec: ContentPost = {
      id: nextId('CNT', db.contentPosts),
      accountId: account.id,
      platformId: account.platformId,
      format: body.format ?? 'Reel',
      title: body.title.trim(),
      url: body.url ?? '',
      publishedDate: body.publishedDate ?? now().slice(0, 10),
      views: body.views ?? 0,
      likes: body.likes ?? 0,
      comments: body.comments ?? 0,
      shares: body.shares ?? 0,
      followerGain: body.followerGain ?? null,
      metricsMeasuredAt: body.metricsMeasuredAt ?? now().slice(0, 10),
      notes: body.notes ?? '',
      archived: false,
      createdAt: now(),
      updatedAt: now(),
    };
    db.contentPosts.unshift(rec);
    recordAudit({
      actor: actor(request), recordType: 'Content Post', recordId: rec.id, recordLabel: rec.title,
      action: 'create', reason: body.reason ?? 'Content engagement recorded',
      changes: [{ field: 'views', from: null, to: rec.views }, { field: 'account', from: null, to: rec.accountId }],
    });
    return HttpResponse.json(rec, { status: 201 });
  }),

  http.patch(`${API}/content-posts/:id`, async ({ request, params }) => {
    await LATENCY();
    const rec = db.contentPosts.find((c) => c.id === params.id);
    if (!rec) return bad('Content post not found.', 404);
    const { reason, ...patch } = sanitizeFields((await request.json()) as Partial<ContentPost> & { reason?: string }, CONTENT_POST_FIELDS);
    const merged = { ...rec, ...patch };
    if (merged.likes + merged.comments + merged.shares > merged.views) {
      return bad('Engagements cannot exceed views — check the numbers.', 400, { field: 'views' });
    }
    if (changed(postUrlKey, rec.url, patch.url)) {
      const key = postUrlKey(patch.url);
      const holder = db.contentPosts.find((c) => c.id !== rec.id && !c.archived && postUrlKey(c.url) === key);
      if (holder) return taken('post URL', holder.id, `“${holder.title}”`, 'url');
    }
    const changes = diffRecords(rec as unknown as Record<string, unknown>, patch as Record<string, unknown>);
    Object.assign(rec, patch, { updatedAt: now() });
    if (changes.length) {
      recordAudit({
        actor: actor(request), recordType: 'Content Post', recordId: rec.id, recordLabel: rec.title,
        action: patch.archived ? 'archive' : 'update', reason: reason ?? 'Content metrics updated', changes,
      });
    }
    return HttpResponse.json(rec);
  }),

  /* ── Bulk import commit ───────────────────────────────────── */
  http.post(`${API}/import/:entity`, async ({ request, params }) => {
    await LATENCY();
    const pagePermission = String(params.entity) === 'domains' ? 'access:domains' : String(params.entity) === 'sims' ? null : 'access:import';
    if (pagePermission && !may(request, pagePermission)) return noAccess();
    const { rows, reason, fallbackCountryCode, overwrite } =
      (await request.json()) as { rows: Record<string, unknown>[]; reason?: string; fallbackCountryCode?: string; overwrite?: boolean };
    const updating = String(params.entity) === 'domains' && overwrite === true;
    const domainsInFile = new Set<string>();
    let updated = 0;
    let unchanged = 0;
    let simsTaken: ReturnType<typeof takenBySims> | undefined;
    // Imported rows never touched a form, so they are sanitised here as they land.
    const clean = (v: unknown, max: number) => sanitizeText(v, max);
    const entity = String(params.entity);
    const who = actor(request);
    let created = 0;
    const problems: { row: number; reason: string }[] = [];

    for (const [rowIndex, row] of rows.entries()) {
      if (entity === 'sims') {
        // The same rule as the upload preview and the real server.
        simsTaken ??= takenBySims(db.sims);
        const { value, problems: rowProblems } = validateSimRow(simRawFromRecord(row), {
          countries: db.countries, fallbackCountryCode, existing: simsTaken, seen: noneTaken(),
        });
        if (!value) {
          problems.push({ row: Number(row.rowNumber) || rowIndex + 1, reason: rowProblems.map((p) => `${p.column}: ${p.message}`).join(' ') });
          continue;
        }
        db.sims.unshift({
          id: nextId('SIM', db.sims), ...value,
          assigneeId: null, assigneeType: null, brandId: null, projectId: null, planExpiryDate: null,
          archived: false, createdAt: now(), updatedAt: now(),
        });
        addTaken(simsTaken, value);
        created++;
      } else if (entity === 'domains') {
        const existing = new Set(db.domains.map((d) => d.domainName));
        const archived = new Set(db.domains.filter((d) => d.archived).map((d) => d.domainName));
        const raw = domainRawFromRecord(row);
        const { value, problems: rowProblems } = validateDomainRow(raw, { existing, archived, seen: domainsInFile, overwrite: updating });
        if (!value) {
          problems.push({ row: Number(row.rowNumber) || rowIndex + 1, reason: rowProblems.map((p) => `${p.column}: ${p.message}`).join(' ') });
          continue;
        }
        domainsInFile.add(value.domainName);
        const current = db.domains.find((d) => d.domainName === value.domainName);
        if (current) {
          const changes = domainSheetChanges(current, domainUpdateFields(raw, value));
          if (!changes.length) { unchanged++; continue; }
          Object.assign(current, Object.fromEntries(changes.map((c) => [c.field, c.to])), { updatedAt: now() });
          recordAudit({
            actor: who, recordType: 'Domain', recordId: current.id, recordLabel: current.domainName,
            action: changes.some((c) => c.field === 'status') ? 'status-change' : 'update',
            reason: reason ?? 'Bulk upload', changes,
          });
          updated++;
          continue;
        }
        db.domains.unshift({
          id: nextId('DOM', db.domains), ...value,
          rotationDate: null, brandId: null, notes: '', archived: false, createdAt: now(), updatedAt: now(),
        });
        created++;
      } else if (entity === 'agents') {
        const name = clean(row.name, 160);
        const skip = (reason: string) => problems.push({ row: Number(row.rowNumber) || rowIndex + 1, reason });
        if (!name) { skip('Name is required.'); continue; }
        const phone = phoneKey(String(row.contactNumber ?? ''));
        if (phone && db.agents.some((a) => !a.archived && phoneKey(a.contactNumber) === phone)) { skip('Another agent already has this contact number.'); continue; }
        db.agents.unshift({
          id: nextId('AGT', db.agents, 3), name, externalUid: '',
          agentType: (row.agentType as Agent['agentType']) ?? 'Individual',
          contactNumber: normalizePhone(String(row.contactNumber ?? '')), email: clean(row.email, 160),
          telegramUsername: '',
          preferredChannel: (row.preferredChannel as Agent['preferredChannel']) ?? 'Email',
          managerId: null, brandIds: [], projectIds: [], channelUrls: [], postLinks: [],
          cooperationStatus: (row.cooperationStatus as Agent['cooperationStatus']) ?? 'Prospect',
          paymentTerm: null,
          salaryStatus: null, salaryNote: '', salaryUpdatedByName: '', salaryUpdatedAt: null,
          startDate: (row.startDate as string) || null, lastContactedDate: null, nextFollowUpDate: null,
          agreementRef: clean(row.agreementRef, 200), notes: clean(row.notes, 4000),
          archived: false, createdAt: now(), updatedAt: now(),
        });
        created++;
      } else if (entity === 'social-accounts') {
        const username = clean(row.username, 160);
        const platform = db.platforms.find((p) => p.name.toLowerCase() === String(row.platform ?? '').toLowerCase());
        const skip = (reason: string) => problems.push({ row: Number(row.rowNumber) || rowIndex + 1, reason });
        if (!username) { skip('Username or handle is required.'); continue; }
        if (!platform) { skip('Unknown platform.'); continue; }
        const importedId = clean(row.platformAccountId, 200);
        const importedUrl = pageUrlKey(sanitizeUrl(row.profileUrl));
        const live = db.socialAccounts.filter((a) => !a.archived);
        if (importedId && live.some((a) => a.platformId === platform.id && a.platformAccountId === importedId)) { skip('An account with this platform ID already exists.'); continue; }
        if (importedUrl && live.some((a) => pageUrlKey(a.profileUrl) === importedUrl)) { skip('An account with this profile URL already exists.'); continue; }
        db.socialAccounts.unshift({
          id: nextId('ACC', db.socialAccounts), platformId: platform.id,
          platformAccountId: clean(row.platformAccountId, 200),
          assetType: (row.assetType as SocialAccount['assetType']) ?? 'Profile',
          displayName: clean(row.displayName, 160) || username, username,
          profileUrl: sanitizeUrl(row.profileUrl), brandId: (row.brandId as string) ?? null, projectId: null,
          targetCountryCode: String(row.targetCountryCode ?? 'IN'), contentLanguage: clean(row.contentLanguage, 160) || 'English',
          responsibleTeamMemberId: null, loginEmailRef: clean(row.loginEmailRef, 200), credentialId: null,
          recoveryMethod: 'None', recoveryRef: '', twoFaEnabled: false, twoFaMethod: 'None',
          operationalStatus: (row.operationalStatus as SocialAccount['operationalStatus']) ?? 'Active',
          allocationStatus: (row.allocationStatus as SocialAccount['allocationStatus']) ?? 'Unassigned',
          simIds: [], lastAccessVerifiedDate: null, lastPostingDate: null,
          followerCount: null, followerCountMeasuredAt: null, reservedForProjectId: null,
          notes: clean(row.notes, 4000), archived: false, createdAt: now(), updatedAt: now(),
        });
        created++;
      }
    }

    recordAudit({
      actor: who, recordType: 'Import', recordId: entity, recordLabel: `${entity} CSV import`,
      action: 'import', reason: reason ?? 'CSV import committed',
      changes: [
        { field: 'rowsCreated', from: null, to: created },
        ...(updating ? [{ field: 'rowsUpdated', from: null, to: updated }] : []),
        { field: 'rowsSubmitted', from: null, to: rows.length },
      ],
    });
    return HttpResponse.json({ created, updated, unchanged, skipped: rows.length - created - updated - unchanged, problems });
  }),

  /* ── Agent proofs (mirrors server/routes/agent-proofs.ts) ─── */
  http.post(`${API}/agents/:id/proofs`, async ({ request, params }) => {
    await LATENCY();
    const agent = db.agents.find((a) => a.id === params.id);
    if (!agent) return bad('Agent not found.', 404);
    const locked = agentLocked(request, agent);
    if (locked) return locked;
    if (agent.archived) return bad('This agent is archived.');
    const body = (await request.json()) as { postUrl?: unknown; image?: unknown };
    const url = checkProofPostUrl(body.postUrl);
    if ('error' in url) return bad(url.error, 400, { field: 'postUrl' });
    const bytes = decodeBase64Image(body.image);
    if (!bytes) return bad('The image could not be read. Choose the file again.', 400, { field: 'image' });
    const image = checkProofImage(bytes);
    if ('error' in image) return bad(image.error, 400, { field: 'image' });
    const holder = db.agentProofs.find((p) => !p.archived && postUrlKey(p.postUrl) === url.key);
    if (holder) return bad(`This Post URL is already on a proof for ${holder.agentId} (${holder.id}).`, 409, { field: 'postUrl', conflictId: holder.id });
    const who = actor(request);
    const proof = {
      id: nextId('PRF', db.agentProofs), agentId: agent.id, postUrl: url.value, mimeType: image.mime, sizeBytes: bytes.length,
      uploadedById: who.id, uploadedByName: who.name,
      verdict: null, verdictReason: '', reviewedByName: '', reviewedAt: null, payment: 'Not paid', paidByName: '', paidAt: null,
      archived: false, createdAt: now(),
    } satisfies AgentProof;
    db.agentProofs.unshift(proof);
    db.proofImages[proof.id] = { mime: image.mime, base64: String(body.image).replace(/^data:[^;,]*;base64,/, '') };
    recordAudit({ actor: who, recordType: 'Agent', recordId: agent.id, recordLabel: agent.name, action: 'update', reason: 'Proof uploaded', changes: [{ field: 'proofPostUrl', from: null, to: url.value }] });
    return HttpResponse.json(proof, { status: 201 });
  }),

  http.patch(`${API}/agent-proofs/:id/review`, async ({ request, params }) => {
    await LATENCY();
    const who = actor(request);
    if (!mayReviewProofs(who.role)) return bad("Only the System Administrator can set a proof's verdict or payment.", 403);
    const review = checkProofReview((await request.json()) as Record<string, unknown>);
    if ('error' in review) return bad(review.error, 400, { field: review.field });
    const proof = db.agentProofs.find((p) => p.id === params.id);
    if (!proof) return bad('Proof not found.', 404);
    if (proof.archived) return bad('This proof has been removed.');
    const changes: { field: string; from: string | null; to: string | null }[] = [];
    if (review.verdict && (review.verdict !== proof.verdict || review.reason !== proof.verdictReason)) {
      changes.push({ field: 'proofVerdict', from: proof.verdict, to: review.verdict });
      Object.assign(proof, { verdict: review.verdict, verdictReason: review.reason, reviewedByName: who.name, reviewedAt: now() });
    }
    if (review.payment && review.payment !== proof.payment) {
      changes.push({ field: 'proofPayment', from: proof.payment, to: review.payment });
      const paid = review.payment === 'Paid';
      Object.assign(proof, { payment: review.payment, paidByName: paid ? who.name : '', paidAt: paid ? now() : null });
    }
    if (changes.length) {
      const agent = db.agents.find((a) => a.id === proof.agentId);
      recordAudit({
        actor: who, recordType: 'Agent', recordId: proof.agentId, recordLabel: agent?.name ?? proof.agentId, action: 'status-change',
        reason: review.reason || `Proof ${proof.id} (${proof.postUrl}): ${changes.map((c) => c.to).join(', ')}`, changes,
      });
    }
    return HttpResponse.json(proof);
  }),

  http.get(`${API}/agent-proofs/:id/image`, ({ params }) => {
    const stored = db.proofImages[String(params.id)];
    if (!stored) return bad('Proof not found.', 404);
    const bytes = decodeBase64Image(stored.base64) ?? new Uint8Array();
    return new HttpResponse(bytes, { headers: { 'Content-Type': stored.mime } });
  }),

  http.patch(`${API}/agent-proofs/:id`, async ({ request, params }) => {
    await LATENCY();
    const proof = db.agentProofs.find((p) => p.id === params.id);
    if (!proof) return bad('Proof not found.', 404);
    const who = actor(request);
    if (!hasPermission(who, 'archive:records')) return bad(`Your role (${who.role}) cannot archive records.`, 403);
    const body = (await request.json()) as { archived?: unknown; reason?: unknown };
    const reason = sanitizeText(body.reason, 500);
    if (body.archived !== true) return bad('Only removing a proof is supported.');
    if (!reason) return bad('Removing a proof needs a written reason.', 400, { field: 'reason' });
    const agent = db.agents.find((a) => a.id === proof.agentId)!;
    const locked = agentLocked(request, agent);
    if (locked) return locked;
    proof.archived = true;
    recordAudit({ actor: who, recordType: 'Agent', recordId: agent.id, recordLabel: agent.name, action: 'archive', reason, changes: [{ field: 'proofPostUrl', from: proof.postUrl, to: null }] });
    return HttpResponse.json(proof);
  }),

  ...teamReportHandlers(API, actor),

  /* ── Permission editor (mirrors server/routes/permissions.ts) ── */
  http.get(`${API}/permissions`, ({ request }) => (may(request, 'access:roles-audit') ? HttpResponse.json(permissionSnapshot()) : noAccess())),
  http.put(`${API}/permissions/roles/:role`, async ({ request, params }) => {
    if (!may(request, 'manage:users')) return bad('Only the System Administrator can change permissions.', 403);
    const role = decodeURIComponent(String(params.role));
    if (role === SYSTEM_ADMIN_ROLE || !(EDITABLE_ROLES as readonly string[]).includes(role)) return bad('That role cannot be edited.');
    const body = (await request.json()) as { permissions?: unknown };
    if (!Array.isArray(body.permissions)) return bad('Send the full list of permissions for the role.');
    mockPermissions.roles[role] = cleanPermissionList(body.permissions);
    return HttpResponse.json(permissionSnapshot());
  }),
  http.put(`${API}/permissions/users/:id`, async ({ request, params }) => {
    if (!may(request, 'manage:users')) return bad('Only the System Administrator can change permissions.', 403);
    const user = db.teamMembers.find((t) => t.id === params.id);
    if (!user) return bad('User not found.', 404);
    if (user.role === SYSTEM_ADMIN_ROLE) return bad('A System Administrator already has every permission.');
    const body = (await request.json()) as { permissions?: unknown };
    if (!Array.isArray(body.permissions)) return bad('Send the full list of extra permissions for this person.');
    const roleList = mockPermissions.roles[user.role] ?? ROLE_PERMISSIONS[user.role];
    mockPermissions.users[user.id] = cleanPermissionList(body.permissions).filter((p) => !roleList.includes(p));
    return HttpResponse.json(permissionSnapshot());
  }),

  /* Ads Monitoring stores money, files and imports in the database and is only
     served by the real API. The preview says so instead of failing quietly. */
  http.all(`${API}/ads/*`, () => bad('Ads Monitoring needs the real API and database — it is not available in the mock preview.', 501)),
  http.all(`${API}/spiels/*`, () => bad('The Shared Spiel Library needs the real API and database — it is not available in the mock preview.', 501)),
  http.get(`${API}/notifications`, () => HttpResponse.json({ notifications: [], unread: 0 })),

  /* ── Audit (export events are logged, never the data) ─────── */
  http.post(`${API}/audit`, async ({ request }) => {
    await LATENCY();
    const body = (await request.json()) as Omit<AuditEntry, 'id' | 'timestamp' | 'actorId' | 'actorName' | 'actorRole'>;
    const entry = recordAudit({
      actor: actor(request),
      recordType: body.recordType,
      recordId: body.recordId,
      recordLabel: body.recordLabel,
      action: body.action,
      reason: body.reason,
      changes: body.changes ?? [],
    });
    return HttpResponse.json(entry, { status: 201 });
  }),
];
