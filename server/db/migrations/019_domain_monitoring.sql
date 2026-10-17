-- Domain Monitoring & Rotation: a manual-operation-only monitoring layer,
-- entirely separate from the `domains` register (see migration 001/003).
-- Nothing here references `domains` — these are a different pool of domains,
-- checked daily by hand for accessibility and, Invite Domains only, tracked
-- through a 5-day rotation cycle across named batches.
--
-- One `domain_monitors` table with a domain_type discriminator rather than two
-- tables: Free Cash and Invite share almost every column, and Invite only adds
-- activation_status (nullable) plus rotation-batch membership.
--
-- "The active batch" for a rotation group is the row in rotation_batches with
-- status='Active' for that group — derived, not cached on rotation_groups,
-- which would need a circular FK.
--
-- domain_check_logs is intentionally NOT part of the app's bootstrap payload
-- (see server/repositories/bootstrap.ts) — one row per domain per day is the
-- fastest-growing table this app has. domain_monitors.last_accessibility_status
-- / last_checked_date are denormalised caches, written transactionally
-- alongside each check, and are what the list views/KPIs/"Pending Today"
-- actually read; full history is fetched on demand.

CREATE TABLE domain_monitors (
  id                        VARCHAR(24)  NOT NULL,
  domain_type               VARCHAR(16)  NOT NULL,              -- 'Free Cash' | 'Invite'
  domain_name                VARCHAR(255) NOT NULL,              -- normalizeDomain()'d; unique in this table only
  activation_status          VARCHAR(16)  NULL,                  -- Invite only; NULL for Free Cash
  last_accessibility_status  VARCHAR(16)  NOT NULL DEFAULT 'Not Checked',
  last_checked_date          DATE         NULL,                  -- cache of the latest check; never the source of "Pending Today"
  last_checked_by_id         VARCHAR(24)  NULL,                  -- cache of who recorded it, so the table never joins to the log
  notes                      TEXT         NOT NULL,
  archived                   TINYINT(1)   NOT NULL DEFAULT 0,
  created_at                 DATETIME(3)  NOT NULL,
  updated_at                 DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_domain_monitors_name (domain_name),
  KEY ix_domain_monitors_type (domain_type),
  KEY ix_domain_monitors_activation (activation_status),
  CONSTRAINT fk_domain_monitors_checked_by FOREIGN KEY (last_checked_by_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE domain_check_logs (
  id                    VARCHAR(24)  NOT NULL,
  domain_monitor_id     VARCHAR(24)  NOT NULL,
  check_date            DATE         NOT NULL,                  -- operational-timezone day; one row per domain per day
  accessibility_status  VARCHAR(16)  NOT NULL,
  checked_by_id         VARCHAR(24)  NULL,
  notes                 TEXT         NOT NULL,
  created_at            DATETIME(3)  NOT NULL,
  updated_at            DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_domain_check_logs_day (domain_monitor_id, check_date),  -- resubmitting the same day UPDATEs, never duplicates
  KEY ix_domain_check_logs_date (check_date),
  CONSTRAINT fk_domain_check_logs_monitor FOREIGN KEY (domain_monitor_id) REFERENCES domain_monitors (id) ON DELETE CASCADE,
  CONSTRAINT fk_domain_check_logs_checked_by FOREIGN KEY (checked_by_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rotation_groups (
  id                      VARCHAR(24)  NOT NULL,
  name                    VARCHAR(160) NOT NULL,
  notes                   TEXT         NOT NULL,
  rotation_interval_days  SMALLINT     NOT NULL DEFAULT 5,
  cycle_started_at        DATETIME(3)  NULL,
  next_rotation_due_at    DATETIME(3)  NULL,                    -- server-authoritative; NULL until the first rotation
  archived                TINYINT(1)   NOT NULL DEFAULT 0,
  created_at              DATETIME(3)  NOT NULL,
  updated_at              DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rotation_groups_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rotation_batches (
  id                  VARCHAR(24)  NOT NULL,
  rotation_group_id   VARCHAR(24)  NOT NULL,
  name                VARCHAR(160) NOT NULL,
  status              VARCHAR(16)  NOT NULL DEFAULT 'Standby',  -- Active|Standby
  archived            TINYINT(1)   NOT NULL DEFAULT 0,
  created_at          DATETIME(3)  NOT NULL,
  updated_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_rotation_batches_name (rotation_group_id, name),
  KEY ix_rotation_batches_group (rotation_group_id),
  CONSTRAINT fk_rotation_batches_group FOREIGN KEY (rotation_group_id) REFERENCES rotation_groups (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Junction table, no own id — same shape as agent_brands / account_sims.
CREATE TABLE rotation_batch_members (
  rotation_batch_id  VARCHAR(24)  NOT NULL,
  domain_monitor_id  VARCHAR(24)  NOT NULL,
  created_at         DATETIME(3)  NOT NULL,
  PRIMARY KEY (rotation_batch_id, domain_monitor_id),
  UNIQUE KEY uq_rotation_batch_members_domain (domain_monitor_id),  -- one batch per domain, system-wide
  CONSTRAINT fk_rbm_batch FOREIGN KEY (rotation_batch_id) REFERENCES rotation_batches (id) ON DELETE CASCADE,
  CONSTRAINT fk_rbm_domain FOREIGN KEY (domain_monitor_id) REFERENCES domain_monitors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE rotation_events (
  id                      VARCHAR(24)  NOT NULL,
  rotation_group_id       VARCHAR(24)  NOT NULL,
  event_type              VARCHAR(24)  NOT NULL,  -- full_rotation|partial_rotation|postpone|early_complete|change_incoming_batch|change_interval
  outgoing_batch_id       VARCHAR(24)  NULL,
  incoming_batch_id       VARCHAR(24)  NULL,
  previous_due_at         DATETIME(3)  NULL,
  new_due_at              DATETIME(3)  NULL,
  previous_interval_days  SMALLINT     NULL,
  new_interval_days       SMALLINT     NULL,
  is_override             TINYINT(1)   NOT NULL DEFAULT 0,
  reason                  VARCHAR(600) NOT NULL,
  performed_by_id         VARCHAR(24)  NOT NULL,
  performed_at            DATETIME(3)  NOT NULL,
  created_at              DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_rotation_events_group (rotation_group_id),
  KEY ix_rotation_events_time (performed_at),
  CONSTRAINT fk_rotation_events_group FOREIGN KEY (rotation_group_id) REFERENCES rotation_groups (id) ON DELETE CASCADE,
  CONSTRAINT fk_rotation_events_outgoing FOREIGN KEY (outgoing_batch_id) REFERENCES rotation_batches (id) ON DELETE SET NULL,
  CONSTRAINT fk_rotation_events_incoming FOREIGN KEY (incoming_batch_id) REFERENCES rotation_batches (id) ON DELETE SET NULL,
  CONSTRAINT fk_rotation_events_performed_by FOREIGN KEY (performed_by_id) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Child detail rows, same shape as audit_changes (audit_id, position, field, value_from, value_to).
CREATE TABLE rotation_event_domain_changes (
  rotation_event_id      VARCHAR(24)  NOT NULL,
  position                SMALLINT     NOT NULL,
  domain_monitor_id       VARCHAR(24)  NOT NULL,
  from_batch_id            VARCHAR(24)  NULL,
  to_batch_id              VARCHAR(24)  NULL,
  from_activation_status   VARCHAR(16)  NULL,
  to_activation_status     VARCHAR(16)  NULL,
  PRIMARY KEY (rotation_event_id, position),
  KEY ix_redc_domain (domain_monitor_id),
  CONSTRAINT fk_redc_event FOREIGN KEY (rotation_event_id) REFERENCES rotation_events (id) ON DELETE CASCADE,
  CONSTRAINT fk_redc_domain FOREIGN KEY (domain_monitor_id) REFERENCES domain_monitors (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO id_sequences (prefix, next_value, width) VALUES
  ('DMN', 1, 4),
  ('DCL', 1, 6),
  ('RTG', 1, 4),
  ('RTB', 1, 4),
  ('RTE', 1, 5);
