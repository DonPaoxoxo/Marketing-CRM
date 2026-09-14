-- Marketing Resource CRM — initial schema.
--
-- Mirrors the domain model in src/lib/types.ts, which is frozen and covered by
-- tests, so the whole schema lands in one migration rather than dribbling out.
--
-- Conventions:
--   * Human-readable primary keys (SIM-0001, ACC-0231) because they appear in URLs,
--     cross-references and exports. Allocated from `id_sequences`, not MAX()+1,
--     so two concurrent writers cannot collide.
--   * Records are archived, never deleted, so foreign keys are RESTRICT by default.
--     Optional references use SET NULL.
--   * All timestamps are UTC, DATETIME(3). Date-only fields are DATE.
--   * utf8mb4_unicode_ci throughout: case-insensitive, so an email cannot be
--     registered twice in different cases.

SET NAMES utf8mb4;

-- ── Identity ────────────────────────────────────────────────────────────────
-- One table serves both purposes: a login AND a team member that resources are
-- assigned to. Two tables kept in sync by hand would drift. Agents are a separate
-- register and deliberately never get a row here.
CREATE TABLE users (
  id                  VARCHAR(24)  NOT NULL,
  email               VARCHAR(320) NOT NULL,
  name                VARCHAR(160) NOT NULL,
  title               VARCHAR(160) NOT NULL DEFAULT '',
  role                VARCHAR(32)  NOT NULL,
  active              TINYINT(1)   NOT NULL DEFAULT 1,

  -- Null until the invite is accepted. An account with no hash cannot sign in.
  password_hash       VARCHAR(255) NULL,
  password_set_at     DATETIME(3)  NULL,

  -- Only the hash of the invite token is stored, exactly like a session token.
  invite_token_hash   CHAR(64)     NULL,
  invite_expires_at   DATETIME(3)  NULL,
  invite_accepted_at  DATETIME(3)  NULL,

  -- Throttling state for failed sign-in attempts.
  failed_login_count  INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until        DATETIME(3)  NULL,
  last_login_at       DATETIME(3)  NULL,

  created_at          DATETIME(3)  NOT NULL,
  updated_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_invite (invite_token_hash),
  KEY ix_users_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Server-side sessions rather than JWTs: an internal tool needs instant
-- revocation more than it needs statelessness. `id` is the SHA-256 of the cookie
-- value, so a database dump does not hand out live sessions.
CREATE TABLE sessions (
  id            CHAR(64)     NOT NULL,
  user_id       VARCHAR(24)  NOT NULL,
  created_at    DATETIME(3)  NOT NULL,
  last_seen_at  DATETIME(3)  NOT NULL,
  expires_at    DATETIME(3)  NOT NULL,
  ip            VARCHAR(45)  NOT NULL DEFAULT '',
  user_agent    VARCHAR(255) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY ix_sessions_user (user_id),
  KEY ix_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Reference configuration ─────────────────────────────────────────────────
CREATE TABLE countries (
  code       CHAR(2)      NOT NULL,
  name       VARCHAR(120) NOT NULL,
  dial_code  VARCHAR(8)   NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE platforms (
  id                    VARCHAR(24)  NOT NULL,
  name                  VARCHAR(120) NOT NULL,
  slug                  VARCHAR(120) NOT NULL,
  -- Small fixed list of asset types; JSON keeps it one row per platform.
  supports_asset_types  JSON         NOT NULL,
  built_in              TINYINT(1)   NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_platforms_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE brands (
  id           VARCHAR(24)  NOT NULL,
  name         VARCHAR(160) NOT NULL,
  code         VARCHAR(16)  NOT NULL,
  description  TEXT         NOT NULL,
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_brands_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE brand_countries (
  brand_id      VARCHAR(24) NOT NULL,
  country_code  CHAR(2)     NOT NULL,
  PRIMARY KEY (brand_id, country_code),
  CONSTRAINT fk_bc_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE CASCADE,
  CONSTRAINT fk_bc_country FOREIGN KEY (country_code) REFERENCES countries (code) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE projects (
  id          VARCHAR(24)  NOT NULL,
  name        VARCHAR(160) NOT NULL,
  brand_id    VARCHAR(24)  NOT NULL,
  status      VARCHAR(32)  NOT NULL,
  start_date  DATE         NOT NULL,
  end_date    DATE         NULL,
  PRIMARY KEY (id),
  KEY ix_projects_brand (brand_id),
  CONSTRAINT fk_projects_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── SIMs ────────────────────────────────────────────────────────────────────
CREATE TABLE sims (
  id                   VARCHAR(24)  NOT NULL,
  phone_number         VARCHAR(32)  NOT NULL,
  country_code         CHAR(2)      NOT NULL,
  provider             VARCHAR(160) NOT NULL,
  form                 VARCHAR(32)  NOT NULL,
  -- Polymorphic: a SIM may sit with an employee or an external agent.
  assignee_id          VARCHAR(24)  NULL,
  assignee_type        VARCHAR(16)  NULL,
  brand_id             VARCHAR(24)  NULL,
  project_id           VARCHAR(24)  NULL,
  operational_status   VARCHAR(32)  NOT NULL,
  allocation_status    VARCHAR(32)  NOT NULL,
  plan_expiry_date     DATE         NULL,
  last_verified_date   DATE         NULL,
  notes                TEXT         NOT NULL,
  archived             TINYINT(1)   NOT NULL DEFAULT 0,
  created_at           DATETIME(3)  NOT NULL,
  updated_at           DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  -- Duplicate numbers are a real data-quality problem, but the register must be
  -- able to hold one while it is being resolved, so this is an index not a
  -- unique constraint. The API rejects duplicates among non-archived rows.
  KEY ix_sims_phone (phone_number),
  KEY ix_sims_archived (archived),
  KEY ix_sims_expiry (plan_expiry_date),
  KEY ix_sims_brand (brand_id),
  CONSTRAINT fk_sims_country FOREIGN KEY (country_code) REFERENCES countries (code) ON DELETE RESTRICT,
  CONSTRAINT fk_sims_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL,
  CONSTRAINT fk_sims_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Agents (never logins) ───────────────────────────────────────────────────
CREATE TABLE agents (
  id                    VARCHAR(24)  NOT NULL,
  name                  VARCHAR(160) NOT NULL,
  agent_type            VARCHAR(32)  NOT NULL,
  contact_number        VARCHAR(32)  NOT NULL DEFAULT '',
  email                 VARCHAR(320) NOT NULL DEFAULT '',
  preferred_channel     VARCHAR(32)  NOT NULL,
  manager_id            VARCHAR(24)  NULL,
  cooperation_status    VARCHAR(32)  NOT NULL,
  start_date            DATE         NULL,
  last_contacted_date   DATE         NULL,
  next_follow_up_date   DATE         NULL,
  agreement_ref         VARCHAR(200) NOT NULL DEFAULT '',
  notes                 TEXT         NOT NULL,
  archived              TINYINT(1)   NOT NULL DEFAULT 0,
  created_at            DATETIME(3)  NOT NULL,
  updated_at            DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_agents_status (cooperation_status),
  KEY ix_agents_followup (next_follow_up_date),
  KEY ix_agents_archived (archived),
  CONSTRAINT fk_agents_manager FOREIGN KEY (manager_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE agent_brands (
  agent_id  VARCHAR(24) NOT NULL,
  brand_id  VARCHAR(24) NOT NULL,
  PRIMARY KEY (agent_id, brand_id),
  KEY ix_ab_brand (brand_id),
  CONSTRAINT fk_ab_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE,
  CONSTRAINT fk_ab_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE agent_projects (
  agent_id    VARCHAR(24) NOT NULL,
  project_id  VARCHAR(24) NOT NULL,
  PRIMARY KEY (agent_id, project_id),
  KEY ix_ap_project (project_id),
  CONSTRAINT fk_ap_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE,
  CONSTRAINT fk_ap_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE agent_channels (
  agent_id  VARCHAR(24)  NOT NULL,
  position  SMALLINT     NOT NULL,
  url       VARCHAR(2048) NOT NULL,
  PRIMARY KEY (agent_id, position),
  CONSTRAINT fk_ac_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Credential references (never secrets) ───────────────────────────────────
-- There is deliberately no column here that could hold a password, token,
-- recovery code or session cookie. Only a pointer into an external vault.
CREATE TABLE credentials (
  id                        VARCHAR(24)  NOT NULL,
  resource_type             VARCHAR(32)  NOT NULL,
  resource_id               VARCHAR(24)  NOT NULL,
  provider                  VARCHAR(160) NOT NULL,
  login_identifier          VARCHAR(200) NOT NULL DEFAULT '',
  vault_ref                 VARCHAR(200) NOT NULL DEFAULT '',
  owner_user_id             VARCHAR(24)  NULL,
  access_status             VARCHAR(32)  NOT NULL,
  last_rotation_date        DATE         NULL,
  two_fa_enabled            TINYINT(1)   NOT NULL DEFAULT 0,
  recovery_ready            TINYINT(1)   NOT NULL DEFAULT 0,
  last_access_verified_date DATE         NULL,
  notes                     TEXT         NOT NULL,
  archived                  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at                DATETIME(3)  NOT NULL,
  updated_at                DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_cred_resource (resource_type, resource_id),
  KEY ix_cred_status (access_status),
  CONSTRAINT fk_cred_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Social accounts ─────────────────────────────────────────────────────────
CREATE TABLE social_accounts (
  id                         VARCHAR(24)   NOT NULL,
  platform_id                VARCHAR(24)   NOT NULL,
  platform_account_id        VARCHAR(200)  NOT NULL DEFAULT '',
  asset_type                 VARCHAR(32)   NOT NULL,
  display_name               VARCHAR(160)  NOT NULL,
  username                   VARCHAR(160)  NOT NULL,
  profile_url                VARCHAR(2048) NOT NULL DEFAULT '',
  brand_id                   VARCHAR(24)   NULL,
  project_id                 VARCHAR(24)   NULL,
  target_country_code        CHAR(2)       NULL,
  content_language           VARCHAR(160)  NOT NULL DEFAULT '',
  responsible_user_id        VARCHAR(24)   NULL,
  login_email_ref            VARCHAR(200)  NOT NULL DEFAULT '',
  credential_id              VARCHAR(24)   NULL,
  recovery_method            VARCHAR(32)   NOT NULL DEFAULT 'None',
  recovery_ref               VARCHAR(200)  NOT NULL DEFAULT '',
  two_fa_enabled             TINYINT(1)    NOT NULL DEFAULT 0,
  two_fa_method              VARCHAR(32)   NOT NULL DEFAULT 'None',
  operational_status         VARCHAR(32)   NOT NULL,
  allocation_status          VARCHAR(32)   NOT NULL,
  last_access_verified_date  DATE          NULL,
  last_posting_date          DATE          NULL,
  -- Mirrors the newest follower_snapshots row; written through on save so the
  -- register, exports and the growth module can never disagree.
  follower_count             INT UNSIGNED  NULL,
  follower_count_measured_at DATE          NULL,
  reserved_for_project_id    VARCHAR(24)   NULL,
  notes                      TEXT          NOT NULL,
  archived                   TINYINT(1)    NOT NULL DEFAULT 0,
  created_at                 DATETIME(3)   NOT NULL,
  updated_at                 DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  -- Handle and platform ID uniqueness is per platform, and only among live rows,
  -- so it is enforced in the API rather than by a constraint that would also
  -- block archived history.
  KEY ix_acc_platform_username (platform_id, username),
  KEY ix_acc_platform_extid (platform_id, platform_account_id),
  KEY ix_acc_allocation (allocation_status),
  KEY ix_acc_operational (operational_status),
  KEY ix_acc_brand (brand_id),
  KEY ix_acc_archived (archived),
  CONSTRAINT fk_acc_platform FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE RESTRICT,
  CONSTRAINT fk_acc_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL,
  CONSTRAINT fk_acc_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
  CONSTRAINT fk_acc_reserved FOREIGN KEY (reserved_for_project_id) REFERENCES projects (id) ON DELETE SET NULL,
  CONSTRAINT fk_acc_country FOREIGN KEY (target_country_code) REFERENCES countries (code) ON DELETE SET NULL,
  CONSTRAINT fk_acc_user FOREIGN KEY (responsible_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_acc_credential FOREIGN KEY (credential_id) REFERENCES credentials (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One SIM may legitimately serve several accounts; high fan-out is flagged for
-- review by the application, not forbidden here.
CREATE TABLE account_sims (
  account_id  VARCHAR(24) NOT NULL,
  sim_id      VARCHAR(24) NOT NULL,
  PRIMARY KEY (account_id, sim_id),
  KEY ix_as_sim (sim_id),
  CONSTRAINT fk_as_account FOREIGN KEY (account_id) REFERENCES social_accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_as_sim FOREIGN KEY (sim_id) REFERENCES sims (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Assignments and handovers ───────────────────────────────────────────────
CREATE TABLE assignments (
  id                      VARCHAR(24)  NOT NULL,
  resource_type           VARCHAR(32)  NOT NULL,
  resource_id             VARCHAR(24)  NOT NULL,
  previous_assignee_id    VARCHAR(24)  NULL,
  previous_assignee_type  VARCHAR(16)  NULL,
  new_assignee_id         VARCHAR(24)  NOT NULL,
  new_assignee_type       VARCHAR(16)  NOT NULL,
  role                    VARCHAR(32)  NOT NULL,
  brand_id                VARCHAR(24)  NULL,
  project_id              VARCHAR(24)  NULL,
  start_date              DATE         NOT NULL,
  expected_return_date    DATE         NULL,
  purpose                 VARCHAR(600) NOT NULL DEFAULT '',
  handover_status         VARCHAR(32)  NOT NULL,
  acknowledged_at         DATETIME(3)  NULL,
  acknowledged_by         VARCHAR(160) NULL,
  returned_date           DATE         NULL,
  -- What happened to access, never the secret itself.
  credential_action       VARCHAR(32)  NOT NULL DEFAULT 'None',
  active                  TINYINT(1)   NOT NULL DEFAULT 1,
  notes                   TEXT         NOT NULL,
  created_at              DATETIME(3)  NOT NULL,
  updated_at              DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  -- Supports the "one active primary custodian per resource" check.
  KEY ix_asg_resource_active (resource_type, resource_id, active, role),
  KEY ix_asg_assignee (new_assignee_type, new_assignee_id),
  KEY ix_asg_handover (handover_status),
  CONSTRAINT fk_asg_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL,
  CONSTRAINT fk_asg_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Domains ─────────────────────────────────────────────────────────────────
CREATE TABLE domains (
  id               VARCHAR(24)  NOT NULL,
  domain_name      VARCHAR(253) NOT NULL,
  target_country   VARCHAR(32)  NOT NULL,
  rotation_date    DATE         NULL,
  registered_date  DATE         NOT NULL,
  expiration_date  DATE         NOT NULL,
  status           VARCHAR(32)  NOT NULL,
  brand_id         VARCHAR(24)  NULL,
  notes            TEXT         NOT NULL,
  archived         TINYINT(1)   NOT NULL DEFAULT 0,
  created_at       DATETIME(3)  NOT NULL,
  updated_at       DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  -- Domain names are normalised to lowercase before storage, so a plain unique
  -- index is genuinely unique. Archived rows keep their name reserved on purpose.
  UNIQUE KEY uq_domains_name (domain_name),
  KEY ix_domains_expiry (expiration_date),
  KEY ix_domains_country (target_country),
  CONSTRAINT fk_domains_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Growth ──────────────────────────────────────────────────────────────────
-- Absolute totals, one row per account per day. The gain is derived, which is
-- what makes a missed day harmless.
CREATE TABLE follower_snapshots (
  id              VARCHAR(24)  NOT NULL,
  account_id      VARCHAR(24)  NOT NULL,
  snapshot_date   DATE         NOT NULL,
  follower_count  INT UNSIGNED NOT NULL,
  recorded_by_id  VARCHAR(24)  NULL,
  recorded_at     DATETIME(3)  NOT NULL,
  note            VARCHAR(600) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  -- The upsert contract: re-saving a date corrects that day rather than adding
  -- a second row.
  UNIQUE KEY uq_snapshot_account_date (account_id, snapshot_date),
  KEY ix_snapshot_date (snapshot_date),
  CONSTRAINT fk_snap_account FOREIGN KEY (account_id) REFERENCES social_accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_snap_user FOREIGN KEY (recorded_by_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE content_posts (
  id                   VARCHAR(24)   NOT NULL,
  account_id           VARCHAR(24)   NOT NULL,
  platform_id          VARCHAR(24)   NOT NULL,
  format               VARCHAR(32)   NOT NULL,
  title                VARCHAR(160)  NOT NULL,
  url                  VARCHAR(2048) NOT NULL DEFAULT '',
  published_date       DATE          NOT NULL,
  views                INT UNSIGNED  NOT NULL DEFAULT 0,
  likes                INT UNSIGNED  NOT NULL DEFAULT 0,
  comments             INT UNSIGNED  NOT NULL DEFAULT 0,
  shares               INT UNSIGNED  NOT NULL DEFAULT 0,
  follower_gain        INT UNSIGNED  NULL,
  -- Every manually read metric carries the date it was read.
  metrics_measured_at  DATE          NOT NULL,
  notes                TEXT          NOT NULL,
  archived             TINYINT(1)    NOT NULL DEFAULT 0,
  created_at           DATETIME(3)   NOT NULL,
  updated_at           DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_post_account (account_id),
  KEY ix_post_platform (platform_id),
  KEY ix_post_published (published_date),
  CONSTRAINT fk_post_account FOREIGN KEY (account_id) REFERENCES social_accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_post_platform FOREIGN KEY (platform_id) REFERENCES platforms (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Audit ───────────────────────────────────────────────────────────────────
-- Actor name and role are denormalised on purpose: history must stay readable
-- after the person leaves and their row is deactivated or removed.
CREATE TABLE audit_entries (
  id            VARCHAR(24)  NOT NULL,
  actor_id      VARCHAR(24)  NULL,
  actor_name    VARCHAR(160) NOT NULL,
  actor_role    VARCHAR(32)  NOT NULL,
  occurred_at   DATETIME(3)  NOT NULL,
  record_type   VARCHAR(64)  NOT NULL,
  record_id     VARCHAR(64)  NOT NULL,
  record_label  VARCHAR(200) NOT NULL,
  action        VARCHAR(32)  NOT NULL,
  reason        VARCHAR(600) NOT NULL DEFAULT '',
  PRIMARY KEY (id),
  KEY ix_audit_record (record_type, record_id),
  KEY ix_audit_time (occurred_at),
  KEY ix_audit_actor (actor_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Field-level diff. Values arrive already redacted for credential and contact
-- fields; this table must never receive a secret or a phone number.
CREATE TABLE audit_changes (
  audit_id    VARCHAR(24)  NOT NULL,
  position    SMALLINT     NOT NULL,
  field       VARCHAR(120) NOT NULL,
  value_from  VARCHAR(600) NULL,
  value_to    VARCHAR(600) NULL,
  PRIMARY KEY (audit_id, position),
  CONSTRAINT fk_change_audit FOREIGN KEY (audit_id) REFERENCES audit_entries (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Identifier allocation ───────────────────────────────────────────────────
-- Readable ids are handed out from here inside the writing transaction, so two
-- concurrent creates cannot both take SIM-0042.
CREATE TABLE id_sequences (
  prefix      VARCHAR(8)   NOT NULL,
  next_value  INT UNSIGNED NOT NULL DEFAULT 1,
  width       TINYINT      NOT NULL DEFAULT 4,
  PRIMARY KEY (prefix)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO id_sequences (prefix, next_value, width) VALUES
  ('TM',  1, 4),
  ('SIM', 1, 4),
  ('AGT', 1, 3),
  ('ACC', 1, 4),
  ('CRD', 1, 4),
  ('ASG', 1, 4),
  ('DOM', 1, 4),
  ('FSN', 1, 5),
  ('CNT', 1, 4),
  ('AUD', 1, 6),
  ('BRD', 1, 2),
  ('PRJ', 1, 2);
