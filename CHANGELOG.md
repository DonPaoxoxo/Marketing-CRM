# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Database changes are listed with their migration file.

## [Unreleased]

### Added

- **Global toolbar** on every page: refresh data, search, filter, clear filters, save view, export to CSV / Excel /
  PDF, print page, copy link, share report, full-screen view, light/dark toggle, notifications, help, user profile
  (with password change) and keyboard shortcuts.
- **Collapsible sidebar** (icon rail) with foldable navigation groups, remembered per browser.
- **Agent salary status** — Hold, Advance or a custom status, set by the System Administrator (`013_agent_salary_status.sql`).
- **AI Assistant Learner history** — members can reuse, copy and remove their own past suggestions (`012_ai_history.sql`).
- **AI model routing** across three main and seventeen fallback OpenRouter models, with a whole-request time limit
  (`011_ai_free_model_routing.sql`).
- **Shared Spiel Library** — communication scripts with approval workflow, versioning, reference documents,
  favorites, personal notes, in-app notifications and the AI Assistant Learner (`010_shared_spiel_library.sql`).
- **Proof verdict and payment** on agent proofs (`009_proof_verdict_payment.sql`).
- **Editable permissions** per role and per person in Roles & Audit (`008_role_permissions.sql`).
- **Ads Monitoring** — campaigns, exact multi-currency spend, daily metrics, trends, creatives, Excel import and
  creator-only edits (`007_ads_monitoring.sql`).
- **Team Reports** — daily, weekly and monthly reports with attachments and replies (`006_team_reports.sql`).
- **Domains** archive tab and restore; registrar-export bulk upload with optional updates (`003_domain_sheet_fields.sql`).
- **Agents** archive tab, typed-in agent UID, proof screenshots with post URLs (`004_agent_uid_and_proofs.sql`).
- **SIMs** custom "Created for" purpose and Telegram links (`002_sim_sheet_fields.sql`, `005_sim_created_for_custom.sql`).

### Changed

- Archiving and restoring agents is open to every role with the archive permission, independent of the manager edit lock.
- Page export buttons offer CSV, Excel and PDF; exports keep the same masking, blocked-column and audit rules.
- Saved views moved from individual pages to the global toolbar.

### Security

- Real team contact details moved to a git-ignored `server/scripts/team.local.ts`; test data uses synthetic values only.

## [0.1.0]

### Added

- Initial release: SIM, agent, social account, domain, reserve, assignment and credential-reference registers;
  growth tracking; reports; CSV import; role-based access; audit trail; server-side sessions over MySQL
  (`001_init.sql`).
