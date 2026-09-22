/** Deterministic synthetic dataset — TEST FIXTURES ONLY.
 *
 *  This is NOT loaded by the application. The shipped workspace starts empty
 *  (see `seed.ts`); this file exists so the test suite has a large, realistic,
 *  reproducible dataset to assert against.
 *
 *  Load it in a test with `loadFixtures()` from `./db`.
 *
 *  Every value here is fabricated. No real phone numbers, accounts, people or
 *  credentials. Vault references point nowhere. */

import type {
  Agent, AgentProof, Assignment, AuditEntry, Brand, CompetitorRecord, ContentPost, Country, CredentialRef, DomainRecord,
  FollowerSnapshot, Platform, Project, Sim, SocialAccount, TeamMember,
} from '@/lib/types';
import { addDays, toISODate } from '@/lib/utils';

/* Small deterministic PRNG so the dataset is identical on every reload. */
function mulberry32(seed: number) {
  return function rand() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260912);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
const pickSome = <T,>(xs: readonly T[], n: number): T[] => {
  const pool = [...xs];
  const out: T[] = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
};
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pad = (n: number, w = 4) => String(n).padStart(w, '0');

const NOW = new Date('2026-09-12T09:00:00.000Z');
const dayOffset = (n: number) => toISODate(addDays(NOW, n));
const stamp = (n: number) => addDays(NOW, n).toISOString();

/* ── Reference data ───────────────────────────────────────────── */

export const countries: Country[] = [
  { code: 'IN', name: 'India', dialCode: '+91' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92' },
  { code: 'PH', name: 'Philippines', dialCode: '+63' },
];

export const platforms: Platform[] = [
  { id: 'PLT-01', name: 'Facebook', slug: 'facebook', supportsAssetTypes: ['Profile', 'Page', 'Group', 'Business Account'], builtIn: true },
  { id: 'PLT-02', name: 'Instagram', slug: 'instagram', supportsAssetTypes: ['Profile', 'Business Account'], builtIn: true },
  { id: 'PLT-03', name: 'TikTok', slug: 'tiktok', supportsAssetTypes: ['Profile', 'Business Account'], builtIn: true },
  { id: 'PLT-04', name: 'YouTube', slug: 'youtube', supportsAssetTypes: ['Channel'], builtIn: true },
  { id: 'PLT-05', name: 'X', slug: 'x', supportsAssetTypes: ['Profile'], builtIn: true },
  { id: 'PLT-06', name: 'Telegram', slug: 'telegram', supportsAssetTypes: ['Channel', 'Group', 'Profile'], builtIn: true },
  { id: 'PLT-07', name: 'WhatsApp Business', slug: 'whatsapp-business', supportsAssetTypes: ['Business Account', 'Group'], builtIn: true },
  { id: 'PLT-08', name: 'Threads', slug: 'threads', supportsAssetTypes: ['Profile'], builtIn: false },
];

export const brands: Brand[] = [
  { id: 'BRD-01', name: 'Aurora Retail', code: 'AUR', description: 'Consumer retail brand, South & Southeast Asia.', countryCodes: ['IN', 'ID'], active: true },
  { id: 'BRD-02', name: 'Nimbus Fintech', code: 'NIM', description: 'Payments and wallet products.', countryCodes: ['IN', 'PK'], active: true },
  { id: 'BRD-03', name: 'Kirana Fresh', code: 'KIR', description: 'Grocery delivery, India tier-2 cities.', countryCodes: ['IN'], active: true },
  { id: 'BRD-04', name: 'Sentra Travel', code: 'SEN', description: 'Travel bookings, Indonesia focus.', countryCodes: ['ID', 'PH'], active: true },
  { id: 'BRD-05', name: 'Vela Studio', code: 'VEL', description: 'Creator studio and content licensing.', countryCodes: ['PH', 'PK'], active: false },
];

export const projects: Project[] = [
  { id: 'PRJ-01', name: 'Diwali Launch 2026', brandId: 'BRD-01', status: 'Running', startDate: dayOffset(-40), endDate: dayOffset(35) },
  { id: 'PRJ-02', name: 'Wallet Referral Push', brandId: 'BRD-02', status: 'Running', startDate: dayOffset(-90), endDate: dayOffset(60) },
  { id: 'PRJ-03', name: 'Tier-2 City Expansion', brandId: 'BRD-03', status: 'Planning', startDate: dayOffset(14), endDate: dayOffset(160) },
  { id: 'PRJ-04', name: 'Ramadan Travel 2027', brandId: 'BRD-04', status: 'Planning', startDate: dayOffset(60), endDate: dayOffset(210) },
  { id: 'PRJ-05', name: 'Creator Collab Series', brandId: 'BRD-05', status: 'Paused', startDate: dayOffset(-200), endDate: null },
  { id: 'PRJ-06', name: 'Always-on Social', brandId: 'BRD-01', status: 'Running', startDate: dayOffset(-300), endDate: null },
];

export const teamMembers: TeamMember[] = [
  { id: 'TM-01', name: 'Priya Raghunathan', email: 'priya.r@example-internal.test', role: 'System Administrator', title: 'Head of Marketing Ops', active: true },
  { id: 'TM-02', name: 'Devan Sharma', email: 'devan.s@example-internal.test', role: 'Marketing Manager', title: 'Social Lead, India', active: true },
  { id: 'TM-03', name: 'Ayu Prasetyo', email: 'ayu.p@example-internal.test', role: 'Marketing Manager', title: 'Social Lead, Indonesia', active: true },
  { id: 'TM-04', name: 'Rohit Menon', email: 'rohit.m@example-internal.test', role: 'Marketing Staff', title: 'Campaign Executive', active: true },
  { id: 'TM-05', name: 'Siti Nurhaliza', email: 'siti.n@example-internal.test', role: 'Marketing Staff', title: 'Community Manager', active: true },
  { id: 'TM-06', name: 'Kabir Anand', email: 'kabir.a@example-internal.test', role: 'Marketing Staff', title: 'Performance Analyst', active: true },
  { id: 'TM-07', name: 'Meera Iyer', email: 'meera.i@example-internal.test', role: 'Read-only Reviewer', title: 'Compliance Reviewer', active: true },
  { id: 'TM-08', name: 'Bagus Wibowo', email: 'bagus.w@example-internal.test', role: 'Marketing Staff', title: 'Content Producer', active: false },
];

/* ── SIMs ─────────────────────────────────────────────────────── */

const PROVIDERS: Record<string, string[]> = {
  IN: ['Airtel', 'Jio', 'Vi India', 'BSNL'],
  ID: ['Telkomsel', 'Indosat Ooredoo', 'XL Axiata', 'Smartfren'],
  PH: ['Globe', 'Smart'],
  PK: ['Jazz', 'Zong', 'Telenor Pakistan', 'Ufone'],
};

function phoneFor(code: string, n: number): string {
  const dial = countries.find((c) => c.code === code)!.dialCode;
  const base = { IN: 9810000000, ID: 8110000000, PH: 9170000000, PK: 3001000000 }[code] ?? 9000000000;
  return `${dial}${base + n * 137 + int(1, 90)}`;
}

export const sims: Sim[] = Array.from({ length: 68 }, (_, i) => {
  const code = pick(['IN', 'IN', 'IN', 'ID', 'ID', 'PH', 'PK', 'PK', 'PH', 'IN']);
  const opStatus = pick(['Active', 'Active', 'Active', 'Active', 'Active', 'Inactive', 'Expired', 'Lost', 'Retired'] as const);
  const usable = opStatus === 'Active' || opStatus === 'Inactive';
  const alloc = usable ? pick(['Assigned', 'Assigned', 'Reserved', 'Available'] as const) : 'Available';
  const assigned = alloc === 'Assigned';
  const assigneeIsAgent = assigned && chance(0.35);
  const brand = chance(0.85) ? pick(brands) : null;
  return {
    id: `SIM-${pad(i + 1)}`,
    phoneNumber: phoneFor(code, i),
    countryCode: code,
    provider: pick(PROVIDERS[code]),
    form: chance(0.3) ? 'eSIM' : 'Physical SIM',
    createdFor: (['Email + Telegram', 'Telegram', '', 'Email', ''] as const)[i % 5],
    email: i % 5 === 0 || i % 5 === 3 ? `simowner${i + 1}@example.com` : '',
    telegramUsername: i % 5 <= 1 ? `simuser${i + 1}` : '',
    assigneeId: assigned ? (assigneeIsAgent ? `AGT-${pad(int(1, 22), 3)}` : pick(teamMembers).id) : null,
    assigneeType: assigned ? (assigneeIsAgent ? 'Agent' : 'Team Member') : null,
    brandId: brand?.id ?? null,
    projectId: brand ? (projects.filter((p) => p.brandId === brand.id)[0]?.id ?? null) : null,
    operationalStatus: opStatus,
    allocationStatus: alloc,
    planExpiryDate: opStatus === 'Retired' ? null : dayOffset(int(-45, 320)),
    lastVerifiedDate: chance(0.88) ? dayOffset(-int(1, 200)) : null,
    notes: chance(0.25) ? pick(['Used for OTP verification only.', 'Roaming enabled.', 'Physical SIM held in Mumbai office safe.', 'Do not reassign before campaign close.']) : '',
    archived: false,
    createdAt: stamp(-int(200, 900)),
    updatedAt: stamp(-int(1, 120)),
  } satisfies Sim;
});

// Deliberate duplicate-number pair so the duplicate check has something to find.
sims[7] = { ...sims[7], phoneNumber: sims[3].phoneNumber };

/* ── Agents ───────────────────────────────────────────────────── */

const AGENT_NAMES = [
  'Ananya Deshpande', 'Rizky Pratama', 'BrightWave Media', 'Farhan Qureshi', 'Cahaya Digital Agency',
  'Nisha Kulkarni', 'Aditya Balan', 'Puspita Sari', 'Northlight Creators', 'Hari Venkatesh',
  'Dewi Lestari', 'Imran Sheikh', 'Studio Mahakam', 'Tanvi Gokhale', 'Bayu Nugroho',
  'Sameer Chatterjee', 'Lintang Collective', 'Radhika Nair', 'Yusuf Alamsyah', 'PixelKart Agency',
  'Kavya Suresh', 'Gilang Saputra',
];

export const agents: Agent[] = AGENT_NAMES.map((name, i) => {
  const isAgency = /Media|Agency|Creators|Studio|Collective|Kart/.test(name);
  const status = pick(['Active', 'Active', 'Active', 'Onboarding', 'Prospect', 'Paused', 'Ended'] as const);
  const brandIds = pickSome(brands.map((b) => b.id), int(1, 2));
  return {
    id: `AGT-${pad(i + 1, 3)}`,
    name,
    // Deterministic, so the seeded random sequence the other fixtures draw from is unchanged.
    externalUid: i % 3 === 0 ? '' : String(8_100_000 + i * 37),
    agentType: isAgency ? 'Agency' : 'Individual',
    contactNumber: phoneFor(pick(['IN', 'ID']), i + 300),
    email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@agents.example-internal.test`,
    preferredChannel: pick(['WhatsApp', 'Email', 'Telegram', 'Phone'] as const),
    managerId: pick(teamMembers.filter((t) => t.role !== 'Read-only Reviewer')).id,
    brandIds,
    projectIds: projects.filter((p) => brandIds.includes(p.brandId)).slice(0, 2).map((p) => p.id),
    channelUrls: pickSome(
      [`https://instagram.com/${name.toLowerCase().replace(/[^a-z]+/g, '')}`,
       `https://youtube.com/@${name.toLowerCase().replace(/[^a-z]+/g, '')}`,
       `https://tiktok.com/@${name.toLowerCase().replace(/[^a-z]+/g, '')}`],
      int(1, 3),
    ),
    cooperationStatus: status,
    // Not drawn from the seeded sequence, so the other fixtures stay the same.
    salaryStatus: null,
    salaryNote: '',
    salaryUpdatedByName: '',
    salaryUpdatedAt: null,
    startDate: status === 'Prospect' ? null : dayOffset(-int(30, 700)),
    lastContactedDate: chance(0.9) ? dayOffset(-int(1, 90)) : null,
    nextFollowUpDate: status === 'Ended' ? null : chance(0.8) ? dayOffset(int(-10, 45)) : null,
    agreementRef: status === 'Prospect' ? '' : `DOC-${pad(1000 + i, 4)}`,
    notes: chance(0.3) ? pick(['Prefers evening calls IST.', 'Invoices monthly, net 30.', 'Handles regional language content.', 'Under contract review.']) : '',
    archived: false,
    createdAt: stamp(-int(120, 800)),
    updatedAt: stamp(-int(1, 90)),
  } satisfies Agent;
});

/* ── Social accounts ──────────────────────────────────────────── */

const HANDLE_WORDS = ['official', 'india', 'id', 'shop', 'daily', 'live', 'hq', 'care', 'deals', 'stories', 'club', 'now'];
const LANGS: Record<string, string> = { IN: 'Hindi', ID: 'Bahasa Indonesia', PK: 'Urdu', PH: 'Filipino' };

export const socialAccounts: SocialAccount[] = Array.from({ length: 142 }, (_, i) => {
  const platform = pick(platforms);
  const brand = chance(0.92) ? pick(brands) : null;
  const country = brand ? pick(brand.countryCodes) : pick(countries).code;
  const opStatus = pick([
    'Active', 'Active', 'Active', 'Active', 'Active', 'Active', 'Active',
    'Under Review', 'Under Review', 'Restricted', 'Suspended', 'Closed',
  ] as const);
  const alloc = opStatus === 'Closed' || opStatus === 'Suspended'
    ? 'Unassigned'
    : pick(['Assigned', 'Assigned', 'Assigned', 'Reserved', 'Reserved', 'Unassigned'] as const);
  const handle = `${brand?.code.toLowerCase() ?? 'vela'}${pick(HANDLE_WORDS)}${chance(0.45) ? int(1, 99) : ''}`;
  const hasOwner = chance(0.88);
  const hasCred = chance(0.84);
  const twoFa = chance(0.72);
  const reserved = alloc === 'Reserved';
  // A follower count is meaningless without the date it was taken, so the two always travel together.
  const followerCount = chance(0.9) ? int(180, 480_000) : null;
  return {
    id: `ACC-${pad(i + 1)}`,
    platformId: platform.id,
    platformAccountId: `${platform.slug.slice(0, 2).toUpperCase()}${1000000 + i * 7919}`,
    assetType: pick(platform.supportsAssetTypes),
    displayName: `${brand?.name ?? 'Vela Studio'} ${pick(['Official', 'India', 'Indonesia', 'Support', 'Deals', 'Community'])}`,
    username: handle,
    profileUrl: `https://${platform.slug === 'x' ? 'x.com' : `${platform.slug}.example`}/${handle}`,
    brandId: brand?.id ?? null,
    projectId: brand ? (pickSome(projects.filter((p) => p.brandId === brand.id).map((p) => p.id), 1)[0] ?? null) : null,
    targetCountryCode: country,
    contentLanguage: LANGS[country] ?? 'English',
    responsibleTeamMemberId: hasOwner ? pick(teamMembers).id : null,
    loginEmailRef: `ops+acc${pad(i + 1)}@example-internal.test`,
    credentialId: hasCred ? `CRD-${pad(i + 1)}` : null,
    recoveryMethod: hasCred ? pick(['Recovery Email', 'Recovery Phone', 'Authenticator App', 'Backup Codes'] as const) : 'None',
    recoveryRef: hasCred ? `vault://marketing/recovery/acc-${pad(i + 1)}` : '',
    twoFaEnabled: twoFa,
    twoFaMethod: twoFa ? pick(['Authenticator App', 'SMS', 'Security Key'] as const) : 'None',
    operationalStatus: opStatus,
    allocationStatus: alloc,
    simIds: [],
    lastAccessVerifiedDate: chance(0.85) ? dayOffset(-int(1, 150)) : null,
    lastPostingDate: chance(0.8) ? dayOffset(-int(0, 120)) : null,
    followerCount,
    followerCountMeasuredAt: followerCount === null ? null : dayOffset(-int(1, 60)),
    reservedForProjectId: reserved && chance(0.5) ? pick(projects).id : null,
    notes: chance(0.2) ? pick(['Migrated from legacy agency.', 'Pending brand verification badge.', 'Paused pending policy review.', 'Second-line support account.']) : '',
    archived: false,
    createdAt: stamp(-int(100, 1000)),
    updatedAt: stamp(-int(1, 100)),
  } satisfies SocialAccount;
});

// Deliberate duplicates for the duplicate-detection surface:
socialAccounts[11] = { ...socialAccounts[11], platformId: socialAccounts[4].platformId, username: socialAccounts[4].username };
socialAccounts[27] = { ...socialAccounts[27], platformId: socialAccounts[9].platformId, platformAccountId: socialAccounts[9].platformAccountId };

// Link SIMs to accounts — mostly 1:1, with a few legitimate shared numbers and one outlier.
const activeSims = sims.filter((s) => s.operationalStatus === 'Active');
socialAccounts.forEach((acc, i) => {
  if (!chance(0.62)) return;
  const sim = activeSims[i % activeSims.length];
  acc.simIds = [sim.id];
});
// One SIM intentionally linked to many accounts so the "unusual association" flag fires.
const busySim = activeSims[2];
[3, 14, 25, 36, 47, 58, 69].forEach((i) => {
  if (socialAccounts[i]) socialAccounts[i].simIds = [busySim.id];
});

/* ── Credential references (never secrets) ────────────────────── */

export const credentials: CredentialRef[] = socialAccounts
  .filter((a) => a.credentialId)
  .map((a, i) => ({
    id: a.credentialId!,
    resourceType: 'Social Account' as const,
    resourceId: a.id,
    provider: platforms.find((p) => p.id === a.platformId)!.name,
    loginIdentifier: a.loginEmailRef,
    vaultRef: `vault://marketing/${a.id.toLowerCase()}`,
    ownerTeamMemberId: a.responsibleTeamMemberId,
    accessStatus: pick(['Approved', 'Approved', 'Approved', 'Not Requested', 'Requested', 'Revoked', 'Expired'] as const),
    lastRotationDate: chance(0.8) ? dayOffset(-int(5, 400)) : null,
    twoFaEnabled: a.twoFaEnabled,
    recoveryReady: a.recoveryMethod !== 'None' && a.recoveryRef !== '' && chance(0.9),
    lastAccessVerifiedDate: a.lastAccessVerifiedDate,
    notes: i % 17 === 0 ? 'Rotation overdue — scheduled with platform owner.' : '',
    archived: false,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  }));

/* ── Assignments ──────────────────────────────────────────────── */

let asgN = 0;
const nextAsg = () => `ASG-${pad(++asgN)}`;
export const assignments: Assignment[] = [];

function pushAssignment(partial: Omit<Assignment, 'id' | 'createdAt' | 'updatedAt'>) {
  assignments.push({ ...partial, id: nextAsg(), createdAt: stamp(-int(1, 300)), updatedAt: stamp(-int(0, 30)) });
}

socialAccounts.filter((a) => a.allocationStatus === 'Assigned').forEach((a) => {
  const toAgent = chance(0.4);
  const start = int(-300, -5);
  const status = pick(['Completed', 'Acknowledged', 'Acknowledged', 'In Progress', 'Pending'] as const);
  pushAssignment({
    resourceType: 'Social Account',
    resourceId: a.id,
    previousAssigneeId: chance(0.35) ? pick(teamMembers).id : null,
    previousAssigneeType: chance(0.35) ? 'Team Member' : null,
    newAssigneeId: toAgent ? pick(agents).id : (a.responsibleTeamMemberId ?? pick(teamMembers).id),
    newAssigneeType: toAgent ? 'Agent' : 'Team Member',
    role: 'Primary Custodian',
    brandId: a.brandId,
    projectId: a.projectId,
    startDate: dayOffset(start),
    expectedReturnDate: chance(0.4) ? dayOffset(start + int(60, 200)) : null,
    purpose: pick(['Campaign execution', 'Community management', 'Paid media operations', 'Content publishing', 'Customer support handling']),
    handoverStatus: status,
    acknowledgedAt: status === 'Pending' || status === 'In Progress' ? null : stamp(start + 1),
    acknowledgedBy: status === 'Pending' || status === 'In Progress' ? null : 'Recipient confirmed in handover call',
    returnedDate: null,
    credentialAction: chance(0.5) ? 'Access Granted' : 'None',
    active: true,
    notes: '',
  });
});

sims.filter((s) => s.allocationStatus === 'Assigned').forEach((s) => {
  const start = int(-400, -10);
  pushAssignment({
    resourceType: 'SIM',
    resourceId: s.id,
    previousAssigneeId: null,
    previousAssigneeType: null,
    newAssigneeId: s.assigneeId!,
    newAssigneeType: s.assigneeType!,
    role: 'Primary Custodian',
    brandId: s.brandId,
    projectId: s.projectId,
    startDate: dayOffset(start),
    expectedReturnDate: chance(0.3) ? dayOffset(start + int(90, 250)) : null,
    purpose: pick(['OTP and account verification', 'Field team contact number', 'Business messaging line', 'Agent coordination']),
    handoverStatus: pick(['Acknowledged', 'Completed', 'Pending'] as const),
    acknowledgedAt: chance(0.75) ? stamp(start + 1) : null,
    acknowledgedBy: chance(0.75) ? 'Signed handover form' : null,
    returnedDate: null,
    credentialAction: 'None',
    active: true,
    notes: '',
  });
});

// A handful of closed historical assignments so History tabs are not empty.
socialAccounts.slice(0, 30).forEach((a, i) => {
  if (i % 3) return;
  const start = int(-800, -400);
  pushAssignment({
    resourceType: 'Social Account',
    resourceId: a.id,
    previousAssigneeId: null,
    previousAssigneeType: null,
    newAssigneeId: pick(teamMembers).id,
    newAssigneeType: 'Team Member',
    role: 'Primary Custodian',
    brandId: a.brandId,
    projectId: null,
    startDate: dayOffset(start),
    expectedReturnDate: dayOffset(start + 180),
    purpose: 'Previous campaign cycle',
    handoverStatus: 'Returned',
    acknowledgedAt: stamp(start + 2),
    acknowledgedBy: 'Archived handover record',
    returnedDate: dayOffset(start + 180),
    credentialAction: 'Access Revoked',
    active: false,
    notes: 'Closed at end of engagement.',
  });
});

// A few collaborators alongside primary custodians.
socialAccounts.filter((a) => a.allocationStatus === 'Assigned').slice(0, 12).forEach((a) => {
  pushAssignment({
    resourceType: 'Social Account',
    resourceId: a.id,
    previousAssigneeId: null,
    previousAssigneeType: null,
    newAssigneeId: pick(teamMembers).id,
    newAssigneeType: 'Team Member',
    role: 'Collaborator',
    brandId: a.brandId,
    projectId: a.projectId,
    startDate: dayOffset(-int(10, 120)),
    expectedReturnDate: null,
    purpose: 'Secondary publishing access',
    handoverStatus: 'Acknowledged',
    acknowledgedAt: stamp(-int(5, 100)),
    acknowledgedBy: 'Added as collaborator',
    returnedDate: null,
    credentialAction: 'Access Granted',
    active: true,
    notes: '',
  });
});

/* ── Domains ──────────────────────────────────────────────────── */

const DOMAIN_STEMS = [
  'auroraretail', 'auroradeals', 'aurorashop', 'nimbuswallet', 'nimbuspay', 'nimbusrefer',
  'kiranafresh', 'kiranadaily', 'kiranacart', 'sentratravel', 'sentratrip', 'sentraholiday',
  'velastudio', 'velacreators', 'auroralive', 'nimbusoffers', 'kiranamart', 'sentrabooking',
  'auroraindia', 'sentraindonesia', 'nimbusindia', 'kiranahub', 'velamedia', 'sentrapromo',
  'auroracare', 'nimbussupport', 'kiranaoffers', 'sentradeals',
];
const TLD_BY_COUNTRY: Record<string, string[]> = { India: ['.in', '.co.in', '.com', '.net'], Indonesia: ['.id', '.co.id', '.com', '.web.id'] };

export const domains: DomainRecord[] = DOMAIN_STEMS.flatMap((stem, i) => {
  const country = i % 2 === 0 ? 'India' : ('Indonesia' as const);
  const tld = pick(TLD_BY_COUNTRY[country]);
  const registeredOffset = -int(120, 1400);
  // Spread expirations across expired / <7d / <30d / healthy buckets.
  const bucket = i % 7;
  const expOffset =
    bucket === 0 ? -int(1, 60) :
    bucket === 1 ? int(0, 6) :
    bucket === 2 ? int(8, 29) :
    int(45, 700);
  const rotated = i % 4 !== 0;
  return [{
    id: `DOM-${pad(i + 1)}`,
    domainName: `${stem}${tld}`,
    targetCountry: country as 'India' | 'Indonesia',
    rotationDate: rotated ? dayOffset(-int(5, 300)) : null,
    registeredDate: dayOffset(registeredOffset),
    expirationDate: dayOffset(expOffset),
    status: i % 5 === 3 ? ('Inactive' as const) : ('Active' as const),
    registrar: i % 3 === 0 ? 'Gname' : 'RealTime',
    registrarUid: '241089',
    category: 'Ungrouped',
    nameservers: i % 6 === 5 ? 'a5.share-dns.com,b5.share-dns.net' : 'chad.ns.cloudflare.com,clarissa.ns.cloudflare.com',
    brandId: brands[i % brands.length].id,
    notes: i % 9 === 0 ? 'Rotated after reachability issue.' : '',
    archived: false,
    createdAt: stamp(registeredOffset),
    updatedAt: stamp(-int(1, 80)),
  } satisfies DomainRecord];
});

/* ── Audit trail ──────────────────────────────────────────────── */

export const agentProofs: AgentProof[] = [];

/* ── Pakistan Competitor register ────────────────────────────────── */

const COMPETITOR_SEED: { platform: string; link: string; whatsapp: string; telegram: string; others: string }[] = [
  { platform: 'PLT-01', link: 'https://facebook.com/rivalrewardspk', whatsapp: '+92 300 1234567', telegram: '', others: '' },
  { platform: 'PLT-03', link: 'tiktok.com/@pk.dealzone', whatsapp: '', telegram: '@dealzonepk', others: '' },
  { platform: 'PLT-06', link: 't.me/PKBonusHub', whatsapp: '', telegram: '@PKBonusHub', others: 'Second channel: t.me/PKBonusHubVIP' },
  { platform: 'PLT-04', link: 'https://youtube.com/@pk.rewardsdaily', whatsapp: '+92 301 7654321', telegram: '', others: '' },
  { platform: 'PLT-07', link: 'https://wa.me/923219876543', whatsapp: '+92 321 9876543', telegram: '', others: '' },
];

export const pakistanCompetitors: CompetitorRecord[] = COMPETITOR_SEED.map((c, i) => ({
  id: `CMP-${pad(i + 1)}`,
  platformId: c.platform,
  linkOrDomain: c.link,
  whatsapp: c.whatsapp,
  telegram: c.telegram,
  others: c.others,
  notes: '',
  archived: false,
  createdAt: stamp(-int(5, 60)),
  updatedAt: stamp(-int(0, 5)),
}));

export const auditEntries: AuditEntry[] = [
  ...assignments.slice(0, 25).map((a, i) => ({
    id: `AUD-${pad(i + 1)}`,
    actorId: 'TM-02',
    actorName: 'Devan Sharma',
    actorRole: 'Marketing Manager' as const,
    timestamp: stamp(-int(1, 180)),
    recordType: a.resourceType,
    recordId: a.resourceId,
    recordLabel: a.resourceId,
    action: 'assign' as const,
    reason: a.purpose,
    changes: [{ field: 'allocationStatus', from: 'Unassigned', to: 'Assigned' }],
  })),
  ...domains.slice(0, 14).map((d, i) => ({
    id: `AUD-${pad(100 + i)}`,
    actorId: 'TM-01',
    actorName: 'Priya Raghunathan',
    actorRole: 'System Administrator' as const,
    timestamp: stamp(-int(1, 200)),
    recordType: 'Domain',
    recordId: d.id,
    recordLabel: d.domainName,
    action: d.rotationDate ? ('rotation' as const) : ('create' as const),
    reason: d.rotationDate ? 'Scheduled rotation' : 'Initial registration record',
    changes: d.rotationDate
      ? [{ field: 'rotationDate', from: null, to: d.rotationDate }]
      : [{ field: 'domainName', from: null, to: d.domainName }],
  })),
  ...socialAccounts.slice(0, 20).map((a, i) => ({
    id: `AUD-${pad(200 + i)}`,
    actorId: 'TM-03',
    actorName: 'Ayu Prasetyo',
    actorRole: 'Marketing Manager' as const,
    timestamp: stamp(-int(1, 150)),
    recordType: 'Social Account',
    recordId: a.id,
    recordLabel: `${a.displayName} (@${a.username})`,
    action: 'update' as const,
    reason: 'Routine record maintenance',
    changes: [{ field: 'lastAccessVerifiedDate', from: null, to: a.lastAccessVerifiedDate }],
  })),
].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

/* ── Follower snapshots ───────────────────────────────────────── */

/** Accounts we actually track daily. Closed and suspended accounts are not
 *  expected to produce numbers, so they are left out rather than showing up as
 *  permanent gaps in the daily entry grid. */
const TRACKED_DAYS = 45;
const trackedAccounts = socialAccounts
  .filter((a) => !a.archived && a.operationalStatus !== 'Closed' && a.operationalStatus !== 'Suspended')
  .slice(0, 30);

type Trajectory = 'growing' | 'steady' | 'flat' | 'declining';

export const followerSnapshots: FollowerSnapshot[] = [];
let fsnN = 0;

trackedAccounts.forEach((account, idx) => {
  // A deliberate spread so the trend column has something to say: mostly growth,
  // a few flat, and a couple genuinely shrinking.
  const trajectory: Trajectory =
    idx % 11 === 0 ? 'declining' : idx % 5 === 0 ? 'flat' : idx % 3 === 0 ? 'steady' : 'growing';
  // Plausible daily rates: a 300k-follower account does not add 2,000 a day.
  // Over a 30-day window these land at roughly +3..14%, +1..3%, +/-0.3%, -1.5..-7%,
  // which straddles the +/-0.5% flat band so all four trends actually occur.
  const dailyRate = {
    growing: 0.0010 + rand() * 0.0035,
    steady: 0.0003 + rand() * 0.0007,
    flat: -0.0001 + rand() * 0.0002,
    declining: -0.0005 - rand() * 0.0020,
  }[trajectory];

  let count = account.followerCount ?? int(1_500, 90_000);
  // Wind the series back so it *ends* near the account's recorded figure.
  count = Math.max(200, Math.round(count / (1 + dailyRate) ** TRACKED_DAYS));

  for (let day = TRACKED_DAYS - 1; day >= 0; day--) {
    const date = dayOffset(-day);
    const isFirst = day === TRACKED_DAYS - 1;
    const isLast = day === 0;

    // Day-to-day noise on top of the trend, so the line is not a clean curve.
    // Kept below the flat band so day-to-day wobble cannot masquerade as a trend.
    const noise = 1 + (rand() - 0.5) * 0.0015;
    count = Math.max(0, Math.round(count * (1 + dailyRate) * noise));

    // Real teams miss days. Never the first or last, so every series has ends.
    if (!isFirst && !isLast && chance(0.08)) continue;

    followerSnapshots.push({
      id: `FSN-${pad(++fsnN, 5)}`,
      accountId: account.id,
      date,
      followerCount: count,
      recordedById: pick(teamMembers.filter((t) => t.role !== 'Read-only Reviewer')).id,
      recordedAt: `${date}T09:${pad(int(0, 59), 2)}:00.000Z`,
      note: chance(0.04) ? pick(['Campaign spike.', 'Cross-post day.', 'Counted after the platform refresh.']) : '',
    });
  }
});

// The account's follower figure is the latest snapshot — one number, always dated.
socialAccounts.forEach((account) => {
  const own = followerSnapshots.filter((s) => s.accountId === account.id);
  if (!own.length) return;
  const latest = own.reduce((a, b) => (a.date >= b.date ? a : b));
  account.followerCount = latest.followerCount;
  account.followerCountMeasuredAt = latest.date;
});

/* ── Short-form content ───────────────────────────────────────── */

const SHORT_FORM_FORMAT: Record<string, 'Reel' | 'Short' | 'TikTok'> = {
  'PLT-02': 'Reel',      // Instagram
  'PLT-03': 'TikTok',    // TikTok
  'PLT-04': 'Short',     // YouTube
};

const CONTENT_TITLES = [
  'Festive unboxing in 30 seconds', 'Three things nobody tells you about delivery day',
  'Behind the counter at 6am', 'We tried the viral recipe', 'Customer reacts to the new packaging',
  'Rider POV: monsoon shift', 'How the wallet cashback actually works', 'Warehouse tour, sped up',
  'Answering your top comment', 'Before and after: the store refit', 'Packing 100 orders in one hour',
  'The cheapest basket challenge', 'Meet the night shift team', 'Why we changed the app icon',
  'Reading your one-star reviews', 'First day on the job', 'Sunrise over the hub',
  'What 10,000 orders looks like', 'Fastest checkout in the city', 'Our founder answers three questions',
];

const shortFormAccounts = socialAccounts.filter(
  (a) => !a.archived && SHORT_FORM_FORMAT[a.platformId] && a.operationalStatus === 'Active',
);

export const contentPosts: ContentPost[] = Array.from({ length: 84 }, (_, i) => {
  const account = shortFormAccounts[i % Math.max(1, shortFormAccounts.length)];
  const publishedOffset = -int(1, 60);
  // Most posts land in a normal band; a handful genuinely over- or under-perform
  // so the leaderboard has something to find.
  const breakout = i % 13 === 0;
  const dud = i % 17 === 0;
  const views = breakout ? int(120_000, 900_000) : dud ? int(120, 900) : int(2_000, 90_000);
  const rate = breakout ? 0.09 + rand() * 0.07 : dud ? 0.004 + rand() * 0.01 : 0.02 + rand() * 0.05;
  const engagements = Math.round(views * rate);
  const likes = Math.round(engagements * (0.78 + rand() * 0.1));
  const comments = Math.round(engagements * (0.08 + rand() * 0.05));

  return {
    id: `CNT-${pad(i + 1)}`,
    accountId: account.id,
    platformId: account.platformId,
    format: SHORT_FORM_FORMAT[account.platformId],
    title: CONTENT_TITLES[i % CONTENT_TITLES.length],
    url: `${account.profileUrl}/video/${900000 + i * 37}`,
    publishedDate: dayOffset(publishedOffset),
    views,
    likes,
    comments,
    shares: Math.max(0, engagements - likes - comments),
    followerGain: chance(0.75) ? Math.round(views * (0.0008 + rand() * 0.004)) : null,
    metricsMeasuredAt: dayOffset(-int(0, 3)),
    notes: breakout ? 'Outperformed the account average — worth studying.' : '',
    archived: false,
    createdAt: stamp(publishedOffset),
    updatedAt: stamp(-int(0, 3)),
  } satisfies ContentPost;
});
