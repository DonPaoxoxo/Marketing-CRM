-- Data Leads: prospective creators to reach out to, scraped from sheets such as
-- india_casino_creator_leads_youtube_v2.csv — one platform's search results for
-- one country and niche. Not a tracked-account register (see social_accounts):
-- these are outside creators, found and never yet contacted.
--
-- Country and niche are set once per upload batch (the sheet's own filename
-- convention is {country}_{niche}_creator_leads_{platform}_v{n}), so they are
-- plain columns here, not a join table. Platform may still vary per row.
--
-- A lead is unique per (platform, country, channel URL): the same creator
-- reappearing in a later scrape must update nothing and create nothing, so a
-- re-run of the same sheet is harmless. channel_url is indexed by its first
-- 255 bytes — long URLs still compare safely because distinct URLs almost never
-- share that prefix, and a false collision would only block an insert, never
-- silently merge two different creators.

CREATE TABLE data_leads (
  id                 VARCHAR(24)   NOT NULL,
  country_code       CHAR(2)       NOT NULL,
  platform_id        VARCHAR(24)   NOT NULL,
  niche              VARCHAR(160)  NOT NULL DEFAULT '',
  creator            VARCHAR(160)  NOT NULL,
  channel_url        VARCHAR(2048) NOT NULL,
  follower_count     INT UNSIGNED  NULL,
  tier               VARCHAR(160)  NOT NULL DEFAULT '',
  keyword            VARCHAR(160)  NOT NULL DEFAULT '',
  promo_confidence   VARCHAR(40)   NOT NULL DEFAULT '',
  evidence_title     VARCHAR(600)  NOT NULL DEFAULT '',
  evidence_url       VARCHAR(2048) NOT NULL DEFAULT '',
  public_email       VARCHAR(160)  NOT NULL DEFAULT '',
  public_telegram    VARCHAR(160)  NOT NULL DEFAULT '',
  public_instagram   VARCHAR(160)  NOT NULL DEFAULT '',
  status             VARCHAR(40)   NOT NULL DEFAULT 'Not contacted',
  contacted_at       DATETIME(3)   NULL,
  contacted_by_id    VARCHAR(24)   NULL,
  -- Who on the outreach team owns this lead — a fixed roster (CJ, Tonyo, Renze,
  -- Godwin, Ace), not a foreign key: these are the people doing outreach, not
  -- necessarily people who sign in to the CRM. NULL until assigned.
  assigned_to        VARCHAR(40)   NULL,
  notes              TEXT          NOT NULL,
  created_at         DATETIME(3)   NOT NULL,
  updated_at         DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_data_leads_channel (platform_id, country_code, channel_url(255)),
  KEY ix_data_leads_country (country_code),
  KEY ix_data_leads_platform (platform_id),
  KEY ix_data_leads_status (status),
  KEY ix_data_leads_assigned_to (assigned_to),
  CONSTRAINT fk_data_leads_country FOREIGN KEY (country_code) REFERENCES countries (code),
  CONSTRAINT fk_data_leads_platform FOREIGN KEY (platform_id) REFERENCES platforms (id),
  CONSTRAINT fk_data_leads_contacted_by FOREIGN KEY (contacted_by_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO id_sequences (prefix, next_value, width) VALUES ('LED', 1, 4);
