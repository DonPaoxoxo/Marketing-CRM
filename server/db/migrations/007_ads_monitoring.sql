-- Ads Monitoring: campaigns, daily performance, creatives, references, imports,
-- follow-ups and alert settings. Additive only — no existing table is changed.
--
--   * Money is DECIMAL(18,4): exact, with room for VND amounts and precise costs.
--   * One daily record per campaign per report date, enforced by the database.
--   * Counts are BIGINT UNSIGNED and NULL when unavailable — never a fake zero.
--   * created_by is set by the server from the session and never changes; it is
--     what decides who may edit (the creator or the System Owner).
--   * Files are stored privately in the database in chunks of at most 512 KB, the
--     same way Team Reports stores them, and are removed softly (removed_at) so
--     a creative's history survives new uploads.

CREATE TABLE ads_campaigns (
  id                    VARCHAR(24)   NOT NULL,
  reference             VARCHAR(40)   NOT NULL,
  name                  VARCHAR(160)  NOT NULL,
  platform_id           VARCHAR(24)   NOT NULL,
  brand_id              VARCHAR(24)   NULL,
  project_id            VARCHAR(24)   NULL,
  target_country_code   CHAR(2)       NOT NULL,
  social_account_id     VARCHAR(24)   NULL,
  assigned_staff_id     VARCHAR(24)   NULL,
  objective             VARCHAR(24)   NOT NULL,
  currency              CHAR(3)       NOT NULL,
  budget                DECIMAL(18,4) NULL,
  start_date            DATE          NOT NULL,
  end_date              DATE          NOT NULL,
  status                VARCHAR(16)   NOT NULL DEFAULT 'Draft',
  status_before_archive VARCHAR(16)   NULL,
  ads_url               VARCHAR(2048) NOT NULL DEFAULT '',
  reporting_timezone    VARCHAR(40)   NOT NULL DEFAULT 'UTC',
  notes                 TEXT          NOT NULL,
  created_by            VARCHAR(24)   NOT NULL,
  created_at            DATETIME(3)   NOT NULL,
  updated_by            VARCHAR(24)   NULL,
  updated_at            DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_campaigns_reference (reference),
  KEY ix_ads_campaigns_status (status),
  KEY ix_ads_campaigns_dates (start_date, end_date),
  KEY ix_ads_campaigns_created_by (created_by),
  KEY ix_ads_campaigns_currency (currency),
  KEY ix_ads_campaigns_country (target_country_code),
  CONSTRAINT fk_ads_campaigns_platform FOREIGN KEY (platform_id) REFERENCES platforms (id),
  CONSTRAINT fk_ads_campaigns_brand FOREIGN KEY (brand_id) REFERENCES brands (id) ON DELETE SET NULL,
  CONSTRAINT fk_ads_campaigns_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
  CONSTRAINT fk_ads_campaigns_country FOREIGN KEY (target_country_code) REFERENCES countries (code),
  CONSTRAINT fk_ads_campaigns_account FOREIGN KEY (social_account_id) REFERENCES social_accounts (id) ON DELETE SET NULL,
  CONSTRAINT fk_ads_campaigns_staff FOREIGN KEY (assigned_staff_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_ads_campaigns_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_ads_campaigns_updater FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Pause/resume history, so missing-report and pacing checks count only active days.
CREATE TABLE ads_campaign_status_log (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  campaign_id  VARCHAR(24)     NOT NULL,
  status       VARCHAR(16)     NOT NULL,
  changed_at   DATETIME(3)     NOT NULL,
  changed_by   VARCHAR(24)     NULL,
  PRIMARY KEY (id),
  KEY ix_ads_status_log_campaign (campaign_id, changed_at),
  CONSTRAINT fk_ads_status_log_campaign FOREIGN KEY (campaign_id) REFERENCES ads_campaigns (id) ON DELETE CASCADE,
  CONSTRAINT fk_ads_status_log_user FOREIGN KEY (changed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ads_daily_records (
  id                         VARCHAR(24)     NOT NULL,
  campaign_id                VARCHAR(24)     NOT NULL,
  report_date                DATE            NOT NULL,
  amount_spent               DECIMAL(18,4)   NULL,
  reach                      BIGINT UNSIGNED NULL,
  impressions                BIGINT UNSIGNED NULL,
  clicks_all                 BIGINT UNSIGNED NULL,
  link_clicks                BIGINT UNSIGNED NULL,
  landing_page_views         BIGINT UNSIGNED NULL,
  reactions                  BIGINT UNSIGNED NULL,
  comments                   BIGINT UNSIGNED NULL,
  shares                     BIGINT UNSIGNED NULL,
  saves                      BIGINT UNSIGNED NULL,
  new_followers              BIGINT UNSIGNED NULL,
  app_installs               BIGINT UNSIGNED NULL,
  platform_post_engagements  BIGINT UNSIGNED NULL,
  notes                      TEXT            NOT NULL,
  created_by                 VARCHAR(24)     NOT NULL,
  created_at                 DATETIME(3)     NOT NULL,
  updated_by                 VARCHAR(24)     NULL,
  updated_at                 DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_daily_campaign_date (campaign_id, report_date),
  KEY ix_ads_daily_date (report_date),
  CONSTRAINT fk_ads_daily_campaign FOREIGN KEY (campaign_id) REFERENCES ads_campaigns (id),
  CONSTRAINT fk_ads_daily_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_ads_daily_updater FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ads_creatives (
  id           VARCHAR(24)   NOT NULL,
  campaign_id  VARCHAR(24)   NOT NULL,
  file_name    VARCHAR(200)  NOT NULL,
  mime_type    VARCHAR(40)   NOT NULL,
  width        SMALLINT UNSIGNED NOT NULL,
  height       SMALLINT UNSIGNED NOT NULL,
  size_bytes   INT UNSIGNED  NOT NULL,
  ads_url      VARCHAR(2048) NOT NULL DEFAULT '',
  used_from    DATE          NULL,
  used_to      DATE          NULL,
  description  VARCHAR(500)  NOT NULL DEFAULT '',
  created_by   VARCHAR(24)   NOT NULL,
  created_at   DATETIME(3)   NOT NULL,
  removed_at   DATETIME(3)   NULL,
  removed_by   VARCHAR(24)   NULL,
  PRIMARY KEY (id),
  KEY ix_ads_creatives_campaign (campaign_id, created_at),
  CONSTRAINT fk_ads_creatives_campaign FOREIGN KEY (campaign_id) REFERENCES ads_campaigns (id),
  CONSTRAINT fk_ads_creatives_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_ads_creatives_remover FOREIGN KEY (removed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ads_references (
  id               VARCHAR(24)  NOT NULL,
  campaign_id      VARCHAR(24)  NOT NULL,
  daily_record_id  VARCHAR(24)  NULL,
  file_name        VARCHAR(200) NOT NULL,
  mime_type        VARCHAR(120) NOT NULL,
  kind             VARCHAR(8)   NOT NULL,
  size_bytes       INT UNSIGNED NOT NULL,
  description      VARCHAR(500) NOT NULL DEFAULT '',
  created_by       VARCHAR(24)  NOT NULL,
  created_at       DATETIME(3)  NOT NULL,
  removed_at       DATETIME(3)  NULL,
  removed_by       VARCHAR(24)  NULL,
  PRIMARY KEY (id),
  KEY ix_ads_references_campaign (campaign_id, created_at),
  KEY ix_ads_references_daily (daily_record_id),
  CONSTRAINT fk_ads_references_campaign FOREIGN KEY (campaign_id) REFERENCES ads_campaigns (id),
  CONSTRAINT fk_ads_references_daily FOREIGN KEY (daily_record_id) REFERENCES ads_daily_records (id) ON DELETE SET NULL,
  CONSTRAINT fk_ads_references_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_ads_references_remover FOREIGN KEY (removed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- File bytes for creatives and references, keyed by their id (ADK-… or ADF-…).
CREATE TABLE ads_file_chunks (
  file_id  VARCHAR(24)       NOT NULL,
  seq      SMALLINT UNSIGNED NOT NULL,
  data     MEDIUMBLOB        NOT NULL,
  PRIMARY KEY (file_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ads_import_history (
  id                 VARCHAR(24)  NOT NULL,
  user_id            VARCHAR(24)  NULL,
  user_name          VARCHAR(160) NOT NULL,
  file_name          VARCHAR(200) NOT NULL,
  mode               VARCHAR(8)   NOT NULL,
  campaigns_created  INT UNSIGNED NOT NULL DEFAULT 0,
  created_count      INT UNSIGNED NOT NULL DEFAULT 0,
  updated_count      INT UNSIGNED NOT NULL DEFAULT 0,
  skipped_count      INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_count     INT UNSIGNED NOT NULL DEFAULT 0,
  errors_json        MEDIUMTEXT   NOT NULL,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ads_import_history_created (created_at),
  CONSTRAINT fk_ads_import_history_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ads_followups (
  id              VARCHAR(24)  NOT NULL,
  campaign_id     VARCHAR(24)  NOT NULL,
  note            TEXT         NOT NULL,
  recommendation  TEXT         NOT NULL,
  owner_user_id   VARCHAR(24)  NULL,
  due_date        DATE         NULL,
  completed       TINYINT(1)   NOT NULL DEFAULT 0,
  completed_at    DATETIME(3)  NULL,
  created_by      VARCHAR(24)  NOT NULL,
  created_at      DATETIME(3)  NOT NULL,
  updated_at      DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ads_followups_campaign (campaign_id),
  KEY ix_ads_followups_due (completed, due_date),
  CONSTRAINT fk_ads_followups_campaign FOREIGN KEY (campaign_id) REFERENCES ads_campaigns (id),
  CONSTRAINT fk_ads_followups_owner FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_ads_followups_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row of alert thresholds, changed only by the System Owner.
CREATE TABLE ads_settings (
  id                        TINYINT UNSIGNED NOT NULL,
  stable_pct                DECIMAL(6,2) NOT NULL DEFAULT 5,
  budget_warning_pct        DECIMAL(6,2) NOT NULL DEFAULT 80,
  ending_soon_days          SMALLINT UNSIGNED NOT NULL DEFAULT 7,
  rising_cost_pct           DECIMAL(6,2) NOT NULL DEFAULT 15,
  declining_engagement_pct  DECIMAL(6,2) NOT NULL DEFAULT 15,
  updated_by                VARCHAR(24)  NULL,
  updated_at                DATETIME(3)  NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO ads_settings (id) VALUES (1);

INSERT INTO id_sequences (prefix, next_value, width) VALUES
  ('ADC', 1, 4), ('ADR', 1, 5), ('ADK', 1, 4), ('ADF', 1, 4), ('ADI', 1, 4), ('ADU', 1, 4);
