# Marketing Resource CRM — developer handover

The workspace runs against a real Node API over MySQL, with server-side sessions and server-side
authorization. There is no vault connection and no platform integration: credential *references* are
stored, secrets are not, and every follower and engagement figure is typed in by a person.

The in-browser mock API still exists, but it is opt-in (`VITE_USE_MOCK_API=true`) and is what the
component tests render against. It is not what the app talks to.

This document is for the engineers picking up the vault and platform-integration phases.

---

## 1. Running it

```bash
npm install
npm run server     # the API on :3001 — needs .env and a reachable MySQL
npm run dev        # the browser app on :5173, proxying /api to the API
npm run test       # unit, component and API contract tests
npm run typecheck          # the browser app
npm run typecheck:server   # the API
npm run build
```

First-time database setup — `.env`, the migration, the team's accounts — is in
[SETUP.md](SETUP.md). Until that is done, `npm run server` exits naming the keys it is missing.

To run the app with no server at all, against the mock: `VITE_USE_MOCK_API=true npm run dev`.
`npm install` runs `msw init public/`, which writes `public/mockServiceWorker.js`; without that file
the mock renders but every request 404s. The real API does not use it.

## 2. Stack

| Concern | Choice |
| --- | --- |
| Build | Vite 8, React 19, TypeScript (strict, `erasableSyntaxOnly`) |
| Styling | Tailwind CSS v4 via `@tailwindcss/vite`, CSS custom properties in `src/index.css` |
| Components | shadcn/ui conventions hand-authored over Radix primitives (`src/components/ui/`) |
| Tables | TanStack Table v8 |
| Server state | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Charts | Chart.js v4 + react-chartjs-2 (`src/components/charts/`) |
| Mock API | MSW v2 (`src/mocks/`) |
| Tests | Vitest, Testing Library (jsdom for component smoke tests) |

## 3. Architecture

```
src/
  lib/          types.ts (domain model) · rules.ts · growth.ts · search.ts · integrity.ts
                sanitize.ts · permissions.ts · config.ts · csv.ts · utils.ts
  mocks/        seed.ts (config only, ships empty) · fixtures.ts (test data) · db.ts · handlers.ts · browser.ts
  hooks/        useData.ts (Query + mutations) · useSession.tsx (role preview) · useTheme.tsx · useFilters.ts
  components/   ui/ (primitives) · common/ (DataTable, KpiCard, controls, audit/assignment lists) · layout/
  features/     per-module dialogs and drawers
  routes/       one file per route
```

Two decisions matter for the backend phase:

**All business rules live in `src/lib/rules.ts` as pure functions.** Dashboard KPIs, table filters,
reserve readiness and reports all call the same functions over the same array, which is why a KPI
and the records it drills into can never disagree. Port these rules to the server rather than
re-deriving them — and keep the client copy, so the UI can explain *why* a record fails a check
without a round trip.

**Filters live in the URL** (`src/hooks/useFilters.ts`). KPI drilldowns, saved views, browser history
and shared links are all the same mechanism. Server-side filtering should accept the same parameter
names.

## 4. The API

`src/hooks/useData.ts` is the only module that calls `fetch` (plus the growth grid, which reuses its
helpers). The real server and the mock answer the same contract, which is what makes the switch a
configuration change rather than a rewrite:

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/bootstrap` | Returns every collection in one payload |
| POST / PATCH | `/api/sims`, `/api/agents`, `/api/social-accounts`, `/api/domains` | Create / partial update |
| POST / PATCH | `/api/assignments` | PATCH with `handoverStatus: 'Returned'` closes and frees the resource |
| PATCH | `/api/credentials/:id` | Rejects any secret-looking field with 422 |
| POST | `/api/follower-snapshots/bulk` | A day's totals for many accounts; upserts on (account, date) |
| POST / PATCH | `/api/content-posts` | Short-form post engagement |
| POST | `/api/import/:entity` | Bulk commit, returns `{ created, skipped }` |
| POST | `/api/audit` | Logs export and other non-mutating events |

Server layout:

```
server/
  app.ts                 Express factory — helmet, 1mb JSON cap, route mounting
  repositories/
    statements.ts        Column maps and statement building. Pure; no database import
    records.ts           Single-record readers and join-table writes
    mappers.ts           Row to domain mapping, defined once for every read path
    bootstrap.ts         The whole payload in one round trip
  routes/                One file per register; helpers.ts holds the actor and archive guards
```

**Every write goes through a column map.** A field the map does not name never reaches SQL — the
statement is built from the map, not from the request body. `server/repositories/schema.test.ts`
checks each map against `001_init.sql` in both directions, so a column renamed in the migration
fails a test rather than one field silently ceasing to save.

Known limits, in the order they will start to matter:

1. `GET /api/bootstrap` returns every collection. That is deliberate — every screen filters
   locally and cross-register views need no request each — but it will not scale indefinitely.
   `useCrmData()` is the seam: keep its return shape and per-collection endpoints need no route
   changes. The audit trail is already capped at `AUDIT_PAGE_SIZE`.
2. The error contract is `{ message, field?, conflictId? }` with 409 for conflicts. Forms map
   `field` onto the offending input and `conflictId` onto the blocking record. Preserve it.
3. Uniqueness for phone numbers and platform account IDs is enforced in the API among live rows
   rather than by a constraint, because archived rows legitimately keep their values. **Handles are
   deliberately not unique**: team members manage many pages and reuse a handle or name across them,
   and many Facebook pages have no username. CSV import recognises a re-imported account by its
   platform ID, or its profile URL when it has none. Simultaneous creates are caught
   by `isDuplicateKey` where a unique index exists (domains) and are theoretically racy where one
   does not.


## 5. Authorization

`src/lib/permissions.ts` holds the matrix and **both sides import it**. The UI consults it to
disable buttons and mask contact details; `server/auth/middleware.ts` consults the same module to
decide whether a request proceeds.

The role comes from the session row. It is never read from the request — the mock's `actorId`
query parameter would be an impersonation hole the moment it met a real database, so the real API
ignores it and the client stops sending it.

A disabled button is not a permission check. The check is `requirePermission()` on the route.

Modelled permissions: view contact details · edit resources · assign resources · import records · export data ·
manage credential references · request credential access · archive records · manage users.

**Archiving carries its own permission and needs a written reason.** Register edits are gated on
`edit:resources`, which several roles hold; a request that also flips `archived` has to clear
`archive:records` separately (`assertMayArchive` in `server/routes/helpers.ts`) rather than arriving
as one more field in an ordinary save.


## 6. Credential handling — the invariants to keep

This system stores **references, never secrets**. The invariants, all currently enforced and tested:

- No password, token, recovery code, session cookie or 2FA seed is stored in any record, fixture,
  export, log or `localStorage` entry. `src/mocks/db.test.ts` and `src/lib/rules.test.ts` assert this
  against the whole dataset.
- `PATCH /api/credentials/:id` returns **422** for any payload key matching
  `/pass|secret|token|cookie|code|otp/i`, before touching the record.
- `recordAudit()` (`src/mocks/db.ts`) replaces values of secret-named fields with `[redacted]`
  before an audit entry is written.
- `toCSV()` (`src/lib/csv.ts`) drops forbidden columns even when a caller passes them, and prefixes
  cells starting with `= + - @` to neutralise spreadsheet formula injection.
- CSV import rejects secret-bearing columns outright — they cannot even be mapped.

`localStorage` is used for exactly three non-sensitive things: theme preference, per-table column
visibility, and saved filter views. Keep it that way.

**Vault integration is the main outstanding piece.** The interface is shaped for it: every credential
record already carries `vaultRef`, `ownerTeamMemberId`, `accessStatus`, `lastRotationDate`,
`recoveryReady` and `lastAccessVerifiedDate`. "Request access" and "Record rotation" currently update
the register only. Wiring them to a password manager or encrypted server-side vault means
implementing those two actions and a retrieval flow that never returns a secret to this frontend.

## 7. Charts

Chart.js v4, wrapped in two components. Do not call Chart.js directly from a route —
go through these, because the rules below are enforced in the wrapper rather than left
to each caller:

| Component | Job | Colour |
| --- | --- | --- |
| `CategoryBarChart` | magnitude across **nominal** categories (platform, brand, country) | one series, slot-1 teal for every bar |
| `StackedBarChart` | part-to-whole across a few rows (allocation state, expiry buckets) | categorical slots 1..N, or status tokens when the series *means* good/bad |

Where they are used: Overview (reserve accounts by platform and by brand, both
click-through to the filtered records), Reports → Inventory (three small multiples),
Reports → Assigned vs available (stacked), Domains (expiry distribution by country).

**The palette is computed, not chosen.** `src/components/charts/palette.ts` holds the
slots, the sequential ramp, the status scale and the chart chrome, with the measured
validation results in its header comment. Slot 1 is the brand teal; the rest were
derived by enumerating candidate orderings and keeping the one with the highest
minimum adjacent CVD separation. Current margins, against this app's own surfaces
(`#ffffff` light, `#191c20` dark):

- six slots, adjacent pairs: worst CVD ΔE **13.9** light / **12.8** dark (target ≥ 8)
- six slots, adjacent pairs: worst normal-vision ΔE **22.6** light / **21.3** dark (floor ≥ 15)
- first three slots, all pairs: worst CVD ΔE **12.8** light / **13.6** dark
- every slot clears 3:1 against its surface in both modes

If you change a hex, **re-run the validator** rather than eyeballing it — the command
is in the header comment of `palette.ts`. `--pairs all` applies to scatter/bubble/map
forms, which cap at three series; past that, fold into "Other" or facet.

Rules the wrappers enforce, each covered by a test in `charts.dom.test.tsx`:

- **Every chart ships a table-view twin.** No value is reachable only by hovering.
  `ChartFrame` renders the toggle and the table; callers just supply the rows.
- **A legend appears for two or more series and never for one** (a single-series title
  already names what is plotted). Legends are real HTML, not canvas pixels, so they
  are selectable and screen-reader visible.
- **Series caps are hard.** `StackedBarChart` throws past six series and
  `CategoryBarChart` folds the tail into a single "Other" bar. A seventh hue is never
  generated — it would be indistinguishable from an existing slot under CVD.
- **Status colours are reserved.** A status series wears the status scale, carries an
  icon in its legend entry, and never borrows a categorical slot.
- Marks: bars capped at 24px, 4px rounded data-end with a square baseline, a 2px
  surface-coloured gap between touching stacked segments (a gap, never a border),
  hairline solid gridlines, values direct-labelled at the bar tip in muted text ink.

Both themes are selected, not flipped: the dark column is its own set of steps
validated against the dark surface. Charts re-mount on theme change (`key={resolved}`).

## 8. Social growth

`/growth`, three tabs: daily entry, follower growth, content performance.
Rules live in `src/lib/growth.ts`.

**Totals are recorded, gains are derived.** `FollowerSnapshot` stores the absolute
follower count for one account on one day, unique per (accountId, date). The gain
beside each figure is computed against that account's previous snapshot, with the
span in days carried alongside it. This is the whole reason the model works: if
nobody enters Tuesday, Wednesday still reports a correct two-day gain. Had the team
entered gains directly, a missed day would silently break the running total.

`POST /api/follower-snapshots/bulk` upserts a whole day in one audited action.
Re-saving a date corrects those figures in place rather than adding a second row,
and each correction is audited with the previous value. The account's own
`followerCount` / `followerCountMeasuredAt` are **written through from its newest
snapshot** — a back-filled older day never overwrites a more recent total. That is
why the account form no longer accepts a follower number: every figure now arrives
with a date and lands in the series.

**Tracked, stale and untracked are three different states.** `tracked` means a
figure has ever been recorded; `trackingStale` means it *was* tracked and has gone
quiet past `staleTrackingDays`. An account nobody ever recorded is untracked, not
stale — conflating them turns "we never started" into an alarming "we stopped".

**Content is short-form video only** (Reel / Short / TikTok), because comparing a
Reel's engagement rate to a Telegram broadcast's is meaningless. Rate is
(likes + comments + shares) ÷ views. The engagement leaderboard excludes posts
under `leaderboardMinViews` (100): a 3-view post with 1 like is a 33% rate and
would otherwise top the table. That floor applies only to the *rate* ordering —
ordering by views or absolute engagements needs no floor.

Growth thresholds sit in `DEFAULT_GROWTH_THRESHOLDS` and belong with the others in
§9 when they move server-side.

## 9. The workspace ships empty

`seed.ts` contains **configuration only** — 8 platforms and 4 countries (India, Indonesia, Pakistan, Philippines). Every
operational register, including brands, projects and team members, starts empty.

The large synthetic dataset moved to `fixtures.ts` and is loaded **only by tests**,
through `loadFixtures()` in `db.ts`. The application never calls it, which is what
keeps demonstration data out of a shipped workspace. `resetDb()` returns to the
shipped state; `loadFixtures()` loads the test data. Empty is now the default
experience rather than an edge case, so `empty-workspace.dom.test.tsx` renders every
route with no records and asserts the empty states read properly.

Two consequences worth knowing:

- **The team register is empty, so an audited write may have no matching member.**
  `actor()` in `handlers.ts` falls back to the identity the client claims, labelled
  `(unverified)`. That is honest — a request cannot be trusted to say who sent it.
  The real API resolves the caller from the session row and ignores
  `actorId`/`actorName`/`actorRole` entirely; the client no longer sends them.
- **The mock persists nothing.** Its database lives in the browser tab, and the header
  carries a standing banner saying so whenever it is serving, because people would
  otherwise type a real register in and lose it. See §10.

## 10. Build-time switches

`src/lib/config.ts`, set via `.env` (see `.env.example`):

| Flag | Default | Effect |
| --- | --- | --- |
| `VITE_USE_MOCK_API` | off | `true` serves the API from MSW instead of talking to the real one |
| `VITE_ENABLE_ROLE_PREVIEW` | on with the mock | Shows the synthetic role switcher. Meaningless with a real session, which supplies the role |

The default is off. It was the other way round while the server was the thing that did
not exist yet, and leaving it there would mean a missing `.env` quietly serving a fake
register that looks exactly like the real one and loses everything typed into it on
reload. Leaving it off drops MSW from the bundle entirely — 460 KB raw, 170 KB gzipped.

**The check in `main.tsx` is written inline as
`import.meta.env.VITE_USE_MOCK_API === 'true'` on purpose.** Vite replaces that with
a string literal at build time so the bundler can fold the branch and eliminate the
dynamic import. Routing it through a helper or a cross-module constant does *not*
fold, and the whole mock server ships to production — verified, not assumed. If you
refactor that line, re-check the emitted chunks.

## 11. Sanitisation, integrity and privacy

**Sanitisation happens at the API boundary** (`src/lib/sanitize.ts`, applied in every
write handler), not in the forms — a form-only check is a convenience, not a guard,
and a request that skips the UI would walk straight past it. It covers what React's
escaping does not:

- **URL schemes.** `javascript:`, `data:`, `vbscript:` and `file:` are dropped rather
  than stored, so they can never reach an `href`. `SafeExternalLink` is the second
  line at render time, for records written before this existed.
- **Invisible and bidi characters.** Zero-width marks and right-to-left overrides let
  one handle or domain display as another. Stripped before parsing, so a scheme
  cannot hide behind them either.
- **Length caps** per field, and `sanitizeCount` for metrics, which rejects `NaN`,
  `Infinity` and negatives before they reach the arithmetic.

CSV imports are sanitised on the same path — those rows never touched a form.

**A Content-Security-Policy** is in `index.html`. A meta policy is the floor:
`frame-ancestors` and `report-to` are ignored there and must be response headers.
Recommended set for whatever serves this:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: same-origin
```

**Data quality** (`src/lib/integrity.ts`, surfaced as a Reports tab) checks broken
references across every register, contradictory state (a SIM marked Assigned with no
assignee), missing required information, orphaned growth records, and duplicates.
Archived records are excluded — nobody needs nagging about a record they retired.

**Privacy.** Three things changed once real people's numbers could be entered:

- The audit trail no longer stores contact values. A SIM entry is labelled by its
  record id, never its number, and `phone`/`contactNumber`/`email` values are
  redacted in the diff. The *fact* of the change is still recorded; only the value is
  withheld. An audit log is permanent and read by more people than the register.
- Contact details are **masked by default**, behind a header toggle, and the reveal
  does not survive a reload. Permission is necessary but not sufficient — opening the
  SIM register should not put a screenful of real numbers in front of whoever walks
  past.
- Exports mask contact columns unless deliberately opted in, and the opt-in is
  recorded in the audit trail. Credential columns remain unexportable regardless.

`localStorage` still holds only theme, per-table column visibility and saved filter
views. Keep it that way.

## 12. Configurable thresholds

`DEFAULT_THRESHOLDS` in `src/lib/rules.ts`:

| Threshold | Default | Drives |
| --- | --- | --- |
| `windowDays` | 30 | Follower gain, percent change and trend |
| `flatBandPercent` | 0.5 | The band inside which an account reads as flat |
| `staleTrackingDays` | 7 | "Tracking gone stale" |
| `leaderboardMinViews` | 100 | Engagement-rate leaderboard floor |
| `accessVerificationWindowDays` | 90 | Reserve readiness, "awaiting verification" reports |
| `simRenewalWindowDays` | 30 | SIM renewal KPI and report |
| `followUpWindowDays` | 14 | Agent follow-up KPI and report |
| `simFanOutReviewThreshold` | 3 | "Unusual SIM association" review flag |

These should become server-side settings. Changing one changes every derived figure consistently,
which is the point.

## 13. Deliberate modelling decisions

- **Operational status is separate from allocation status**, for both SIMs and accounts. "Does it
  work" and "is it spoken for" are different questions and were kept as different fields.
- **Reserve inventory is a filtered view, not a second table.** `reserveAccounts()` filters the
  account register. Suspended, restricted and closed accounts are never counted as available.
- **A shared SIM is normal.** One SIM may serve several accounts. Fan-out above the threshold is
  *flagged for review*, not rejected — the register does not assume every shared number is invalid.
- **Agents are not users.** Creating an agent record never creates a CRM login. Keep this separation
  when you add real authentication.
- **One active primary custodian per resource.** Collaborators are recorded as separate assignment
  rows with `role: 'Collaborator'` and are unlimited. `checkAssignmentConflict()` enforces this.
- **Records are archived, not deleted.** Archiving requires the permission plus a written reason of
  at least 10 characters, stored on the audit entry. There is no delete path anywhere.
- **Follower counts are manual.** Every such metric carries its own measurement date and the UI
  labels it as measured on that date. Nothing implies live platform synchronisation.

## 14. Search and indexing

Global search (Ctrl/Cmd+K, or `/`) covers names, phone numbers, usernames, agents, brands and record
IDs. It masks contact details for roles without `view:contact-details`.

`index.html` carries `noindex, nofollow, noarchive, nosnippet, noimageindex`; `public/robots.txt`
disallows everything; there is no sitemap. **Crawler directives are not access control.** Production
must sit behind authentication, and ideally not be publicly routable at all.

## 15. Ads Monitoring

Route `/ads-monitoring` (Overview, Campaigns, Compare, Import History) and `/ads-monitoring/:campaignId`
(Summary, Daily Tracker, Charts, Creatives, References, Notes & History). API under `/api/ads`, every route
behind `requireAuth`. Schema: migration `007_ads_monitoring.sql` (additive only).

**Ownership is enforced on the server.** `src/lib/ads/campaign.ts` is the one rule, shared by the routes
and the UI:

- *System Owner* is mapped explicitly to the `System Administrator` role (`SYSTEM_OWNER_ROLE`). No other
  role is treated as an owner.
- Every signed-in user may view campaigns, records, creatives, references and import history.
- A campaign may be changed, archived, restored or deleted only by its creator (`created_by`) or the System
  Owner. Assigned staff, follow-up owners and Marketing Managers gain nothing.
- Children (daily records, creatives, references, follow-ups) may be added only by the campaign's creator
  or the System Owner; an existing child may be changed only by *its own* creator (who must also own the
  campaign) or the System Owner.
- `created_by` always comes from the session. Client-supplied creator fields are dropped; the campaign
  reference cannot change after creation.
- Files are served only through `/api/ads/creatives/:id/file` and `/api/ads/references/:id/file`, with
  `Content-Security-Policy: default-src 'none'; sandbox` and `nosniff`. Unknown ids answer 404; no session
  answers 401.

**Numbers.** Money is `DECIMAL(18,4)` and handled as bigint units of 1/10,000 (`src/lib/ads/money.ts`); it is
never summed across currencies (the overview groups by currency, Compare refuses mixed currencies). Counts
are nullable — blank is "not available", never zero. Ratios are recalculated from summed inputs
(`src/lib/ads/metrics.ts`); content interactions are only used when reactions, comments, shares and saves
are all present for every day. Reach is labelled *Sum of daily reach* everywhere; platform-reported unique
reach is not stored in this release.

**Trends** (`src/lib/ads/trends.ts`) compare complete days in the campaign's reporting timezone; any missing
day in either window gives *Insufficient Data*. A zero baseline reports the absolute change and "No comparable
baseline". Thresholds live in `ads_settings` and only the System Owner may change them.

**Creatives** must be exactly 1080 × 1350 and ≤ 1,000,000 bytes; dimensions are read from the image
header (`src/lib/ads/files.ts`) in both the browser and the server. Nothing is resized.

**Excel import** (`src/lib/ads/import.ts`, `server/routes/ads/import.ts`). The server parses the uploaded
`.xlsx` itself (cached values only). *Preview* decides every row; *commit* re-uploads the same file,
re-reads the database with row locks inside one transaction, re-decides every row, and refuses (409,
nothing written) if the result differs from the summary the user confirmed. Confirmed valid rows are then
written all-or-nothing. Existing daily records are skipped by default; update mode applies only filled
cells, and only for the record's creator or the System Owner. Unknown brands and social accounts are
rejected, never created. Ownership is never read from the file.

**Tests.** `src/lib/ads/ads-rules.test.ts` (formulas checked against the team's own sheet), `src/routes/ads-monitoring.dom.test.tsx`
(screens), and `server/routes/ads/ads.integration.test.ts` — the RBAC, direct-API/file access, import
ownership, duplicate, rollback (forced with a trigger) and template round-trip tests. That file needs a
real, migrated, config-seeded MariaDB database and is skipped unless `ADS_IT=1` and `ADS_IT_CONFIRM_DB` repeats `DB_NAME`:

```
ADS_IT=1 ADS_IT_CONFIRM_DB=<scratch db> DB_NAME=<scratch db> DB_USER=… DB_PASSWORD=… SESSION_SECRET=<32+ chars> npx vitest run server/routes/ads
```

Never point it at the live database — it deletes all `ads_*` rows first.

## 16. Editable permissions

`src/lib/permissions.ts` holds each role's **defaults**; the live values are in the database (migration
`008_role_permissions.sql`: `role_permissions`, `user_permissions`) and the System Administrator edits them in
Roles & Audit → Roles and permissions (`src/features/team/PermissionsEditor.tsx`, API `server/routes/permissions.ts`).

- Effective permissions = the role's stored list (or its defaults if never saved) + the person's individual
  extras. Resolved on every session read (`server/auth/permissions.ts`, role lists cached 30 s and dropped on
  save), attached to `req.user.permissions`, and returned by `/api/auth/me` so the browser hides what the server
  would refuse. Every check goes through `hasPermission()`; nothing reads `ROLE_PERMISSIONS` directly for a
  signed-in person.
- The System Administrator always has everything. `manage:users` (accounts and the editor itself) can never be
  granted to anyone else — the API strips it — so no one can be locked out.
- Page permissions: `access:domains`, `access:import`, `access:credential-refs`, `access:roles-audit` (they
  replace the old single `access:admin-areas`). Without one, the page is refused, its menu entry is hidden, and
  its data and audit history are left out of the bootstrap payload (`bootstrapFor`).
- Record-level locks are unchanged by any grant: agents by their manager, ads records by their creator; Team
  Report review/delete and Ads alert thresholds stay with the System Administrator role.
- Every role or individual change is audited (record type `Role` or `User`) with each permission added or removed
  and the written reason.
- Migration 008 seeds today's defaults, including `archive:records` for Marketing Staff (owner's request,
  2026-09-14).
- `server/routes/permissions.integration.test.ts` runs with the same `ADS_IT` / `ADS_IT_CONFIRM_DB` gate as the
  Ads Monitoring tests. It rewrites the Marketing Staff role, so use a scratch database only.

### Proof verdict and payment (migration 009)

- Each agent proof has a **verdict** (`null` = Not reviewed, `Accepted`, `Rejected` with a reason of at least 10
  characters) and a **payment** status (`Not paid` by default, or `Paid`). The Agents table shows the latest
  proof's values in the Verdict and Payment columns; the agent's Proofs tab shows them on every proof.
- `PATCH /api/agent-proofs/:id/review` is restricted to the **System Administrator role**, taken from the session.
  It is deliberately not a grantable permission. Rules live in `src/lib/proofs.ts` (`checkProofReview`,
  `mayReviewProofs`) and are shared by the server and the mock.
- Everyone who can see the agent can read the verdict, rejection reason and payment status. Each change is audited
  on the agent as `status-change`, with `proofVerdict` / `proofPayment` field changes.
- `server/routes/proofs.integration.test.ts` uses the same scratch-database gate.

## 17. Shared Spiel Library and AI Assistant Learner

Route `/shared-spiel` (Operations → Shared Spiel Library). API under `/api/spiels`, notifications under
`/api/notifications`. Migration `010_shared_spiel_library.sql` is additive; no Ads Monitoring table or route was touched.
The mock preview answers `501` for `/api/spiels/*`: this module needs the real server and database.

**Where the rules live.** `src/lib/spiels.ts` (statuses, transitions, ownership, validation, duplicate and
similarity checks, SMS counting, document type/size/content checks) and `src/lib/spiel-ai.ts` (actions, prompt,
redaction, structured reply schema, settings schema). The server, the browser and the tests all import them.

**Ownership.** `created_by` is always the session user; request bodies naming an owner are ignored. Only the creator
and the System Owner (the System Administrator role) may edit or delete a spiel, document, document version or
comment. Managers and other roles get nothing extra, and this is deliberately *not* a grantable permission. Reads are
filtered in SQL (`visibleSpielsWhere` / `visibleDocumentsWhere`): a member's queries only return their own records and
approved, non-archived ones, so another member's draft is `404`, never `403`. Creating spiels, uploading documents and
using the AI need `edit:resources`; Read-only Reviewers can read and copy.

**Spiel workflow.** Draft → Pending Approval → Approved / Rejected / Changes Requested; Rejected or Changes Requested
→ (edit) → Draft → Pending; Approved → Archived → Restored (Approved). Rejecting, requesting changes, archiving,
restoring and deleting need a written explanation (≥ 10 characters). Editing a Draft/Rejected spiel updates the same
version; editing an Approved spiel inserts a new version in Pending Approval while `approved_version_id` keeps the
approved one live in the library. Approving marks the previous approved version `Superseded`. History is in
`spiel_approvals`. Deleting: the System Owner deletes permanently (not while a version is live — archive first); an
author can only soft-delete work that was never approved.

**Documents.** Draft → Pending Review → Approved / Rejected → Archived. Accepted: .xlsx .xls .csv .docx .doc (10 MB),
.pptx .ppt .pdf (20 MB), .txt .md (10 MB), .jpg .jpeg .png .webp (1 MB). Each upload is checked by extension, declared
MIME type, magic bytes/UTF-8 content and size; executables, scripts, HTML/SVG and macro-enabled Office names are
refused; file names are stripped of paths and reserved characters and stored under a random `storage_name`. Bytes live
in `spiel_file_chunks` (512 KB chunks) and are sent only by
`GET /api/spiels/documents/:id/versions/:versionId/file`, which checks the caller may see *that version* (approved
versions for everyone, others only for the uploader and System Owner), sets `Content-Security-Policy: sandbox`,
`nosniff` and `no-store`, and audits every preview and download. Replacing a file always creates a new version; an
approved document stays usable until the replacement is approved. Text is extracted for AI context from
txt/md/csv/docx/pptx/xlsx (fflate, no macros executed, inflate size capped); PDFs and legacy Office files contribute
only title and description.

**Notifications.** `server/notifications.ts` writes rows inside the same transaction as the change. Administrators
are notified of submissions, resubmissions ("review requested"), edits of approved spiels, document submissions and
replacements; authors of approvals, rejections and change requests with the feedback text. The header bell polls every
60 s.

**AI Assistant Learner (OpenRouter).** Server side only: `server/ai/openrouter.ts` calls
`POST https://openrouter.ai/api/v1/chat/completions` with `Authorization: Bearer $OPENROUTER_API_KEY`, `HTTP-Referer`
(APP_ORIGIN) and `X-Title`, per the OpenRouter quickstart. The key is read from the environment and never logged,
stored or returned — the settings API only reports whether it is set. Models are tried in the configured order;
each model gets one retry with exponential backoff and jitter on timeout/408/429/500/502/503/network errors; 402 and
"model not found" move straight to the next model; 401/403 stop at once; an empty or invalid JSON reply gets one
correction retry on the same model, then the next model. The reply must match `aiResponseSchema` (Zod, strict). If all
fail the member gets a clear message and their text is untouched (the browser never overwrites it; suggestions are
shown separately and applied only on "Use this suggestion").
Before sending, phone numbers, emails and secret-looking `key: value` pairs are replaced with placeholders; only the
selected text, the chosen situation fields and *approved* reference documents (the System Owner may also use a
pending one to review it) go in the prompt, capped by `max_document_chars`. The AI endpoint writes nothing to spiels or
documents, so it cannot approve, publish, delete, archive, reassign or message anyone. Member submissions are never
used to train anything.
Every request is logged in `ai_requests` (user, action, model used, fallback count, status, error type, duration,
token usage, document ids — no text) with one `ai_usage_logs` row per attempt, and audited as `ai-request`.

**AI history (migration 012).** Every successful request also writes a row to `ai_history`, owned by the member who
made it: the text exactly as sent (phone numbers, emails and secret-looking values already replaced), the chosen
situation fields, the structured suggestion, the model and its position. `GET /api/spiels/ai/history` returns only the
session user's rows (latest 200 are kept). `DELETE /api/spiels/ai/history/:id` removes one — the member's own, or any for
the System Owner; anyone else gets `404`. `DELETE /api/spiels/ai/history` clears the caller's own history and needs a
written reason. Removals are audited. Removing history never touches `ai_requests` / `ai_usage_logs`, which hold no text
and keep daily limits and the System Owner's logs accurate. In the panel, **My AI history** offers Reuse (restores the
settings, the text and the suggestion to review), Copy, Remove and Clear all.

**Model IDs (migration 011).** The spec's original ids (`qwen/qwen3-32b:free`, `google/gemma-3-27b-it:free`,
`meta-llama/llama-3.3-70b-instruct:free`) were not listed by OpenRouter on 2026-09-14, so at the owner's request the
routing uses all 20 models OpenRouter listed as free that day: **3 main** —
`google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free`, `google/gemma-4-26b-a4b-it:free` — then 17
fallbacks in this order: `nex-agi/nex-n2.5-pro:free`, `nex-agi/nex-n2.5-mini:free`, `dots-studio/dots-3-note-preview:free`,
`liquid/lfm-2.5-2.6b:free`, `openrouter/free`, `nvidia/nemotron-3-ultra-550b-a55b:free`, `nvidia/nemotron-3.5-lightning:free`,
`nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`, `nvidia/nemotron-3.5-content-safety:free`,
`thinkingmachines/inkling:free`, `thinkingmachines/inkling-small:free`, `poolside/laguna-s-2.1:free`,
`poolside/laguna-xs-2.1:free`, `inclusionai/ling-3.0-flash-vl:free`, `inclusionai/ling-3.0-flash-fin:free`,
`inclusionai/ling-3.0-flash-sante:free`, `cohere/north-mini-code:free` (the last four are specialised and rarely reached).
Migration 011 only replaces the model list if it is still the untouched 010 default. The list lives in
`DEFAULT_MODELS` (`src/lib/spiel-ai.ts`); `MAIN_MODEL_COUNT = 3`; at most 20 models. Responses report the answering
model's position and tier (Main model 1 / Main model / Fallback model). Free models come and go — use "Check
availability on OpenRouter" in Settings and turn off or replace any marked "Not listed".

**Time limits.** Each attempt has its own timeout (default 20 s) and the whole request has a cap (default 55 s,
`total_timeout_ms`): no new attempt starts once it is used up, and an attempt never gets more than the time left. The
cap stays under nginx's default 60 s `proxy_read_timeout`; raise that first if the cap is raised.

**Uploads through nginx.** Documents can be 20 MB, so nginx `client_max_body_size` must be at least `25m` for the
site (it is `10m` today); otherwise nginx answers 413 before the app sees the request.

**Tests.** `src/lib/spiels.test.ts` (rules, file checks, redaction, reply parsing), `server/ai/openrouter.test.ts`
(primary success, fallback, backoff, timeout, 402/404/401, malformed JSON correction, inline provider errors),
`src/routes/shared-spiel.dom.test.tsx` (library, copy, role tabs, editor, AI panel) and
`server/routes/spiels/spiels.integration.test.ts` (real MariaDB, OpenRouter stubbed; same `ADS_IT` /
`ADS_IT_CONFIRM_DB` guard, scratch databases only — run the integration files with `--no-file-parallelism` and after
`npm run db:seed-config`).

## 18. Global buttons and shortcuts

Every page shares one set of controls (`src/components/layout/GlobalToolbar.tsx`):

- **Header:** Search (Ctrl/⌘ + K or /), Refresh data (invalidates every query), contact-detail toggle, Notifications,
  light/dark toggle, Help, Keyboard shortcuts, User profile (role, permissions, theme, change password, sign out).
  Below `sm`, Refresh, theme and Help move into the profile menu and the page Actions menu.
- **Page toolbar:** Filter (jumps to the page's `FilterBar`), Clear filters, Save view (route + query string, kept in
  this browser), Export CSV / Excel / PDF, Print page, Copy link, Share report (Web Share API, falling back to a
  copy/email dialog), Full-screen view. Below `md` they collapse into an Actions menu.
- **How pages plug in:** nothing to wire. `FilterBar` registers its clear action and `ExportButton` registers its rows
  with `page-actions.tsx`; the toolbar acts on whatever the open page registered, and is disabled with a reason when a
  page has nothing to filter or export. Page-level Saved views buttons were removed in favour of the toolbar.
- **Exports** (`src/components/common/ExportDialog.tsx`) keep the existing rules for every format: `export:data`
  permission, column picker without secret-bearing columns, contact details masked unless included, and an audit entry
  (format, columns, row count, masking — never values). Excel uses `write-excel-file` with text cells. PDF is the
  browser's print engine (`src/lib/print.ts`): the table is rendered into `#print-root` and the print dialog opens, where
  "Save as PDF" is a destination; this handles Hindi, Indonesian and emoji without a PDF library, capped at 2,000 rows.
- **Print styles** (`src/index.css`): navigation, header, toolbar, banner and toasts are hidden, scrolling containers
  are released, and dark mode prints in the light palette.
- **Shortcuts** fire only when no field, dialog or menu has focus: Shift + R refresh, F filter, X clear filters,
  S save view, E export, P print, L copy link, O share, M full screen, D theme, N notifications, H help, U profile, and
  ? for the list.
- A copied or shared link is not a permission: people still sign in, and the server still checks access.
- **Sidebar:** collapses to an icon rail (button at the top of the sidebar, or Shift + B), and each group heading folds
  its links; the page you are on stays visible in a folded group. Both preferences live in `localStorage`
  (`mrcrm.sidebarCollapsed`, `mrcrm.navGroupsClosed`).

**Agent salary status (migration 013).** `agents.salary_status` is Hold, Advance or Customize (with `salary_note`, up to
80 characters, required for Customize), plus who set it and when. It is set only through
`PATCH /api/agents/:id/salary`, restricted to the System Administrator role (`src/lib/salary.ts`); the ordinary agent
edit cannot write it because it is not in `AGENT_COLUMNS`. Everyone who can see the agent can read it (Salary Status
column beside Proof, the agent page header, and the CSV/Excel/PDF export). Every change is audited as `status-change`.

## 19. Known gaps

- Bootstrap-everything data loading will not scale past a few thousand records (§4).
- Bundle is ~1.07 MB / ~316 KB gzipped with the mock excluded, ~1.53 MB / ~486 KB with it included.
  Route-level `React.lazy`, plus lazily importing the chart components, is the obvious fix and was left
  out to keep this phase's routing legible.
- 218 tests cover the rules, growth and engagement maths, search matching, sanitisation, data integrity,
  privacy behaviour, audit redaction, API handlers, a render smoke test of every route in both the populated
  and empty states, the CSV import preview, and the chart layer's rules. There are still no end-to-end tests, and
  keyboard-navigation coverage is by inspection rather than automation.
- Chart *layout* was verified by screenshotting the running app (including dark mode and a 390px
  viewport); there is no visual-regression baseline, so restyling a chart will not fail a test.
- Mock data lives in memory per browser tab. A reload resets everything, by design.
- The bootstrap payload carried ~1,300 follower snapshots with the fixtures loaded. The shipped workspace is
  empty, but the single-payload design is still the thing to replace before real volume arrives (§4).
- There is still no persistence. Everything entered is lost on reload until a backend exists — this is the
  single largest outstanding gap and the banner in the header says so.
- Identity-document uploads and file storage are deliberately out of scope; only reference
  identifiers are recorded.
- Shared Spiel Library: no virus scanning of uploaded documents (type, content and size are checked, and files are
  never executed or served inline as HTML); PDF and legacy .doc/.xls/.ppt text is not extracted for AI context; the
  AI daily limit resets at 00:00 UTC; notifications are polled, not pushed.
