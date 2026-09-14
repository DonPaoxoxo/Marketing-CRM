-- Shared Spiel Library, spiel documents, in-app notifications and the AI Assistant Learner.
-- Additive only: no existing table (Ads Monitoring included) is changed.
--
--   * created_by is set by the server from the session and is never updated, so
--     ownership cannot be transferred. It decides who may edit: the creator or
--     the System Owner (System Administrator).
--   * A spiel keeps every version. approved_version_id is what the shared
--     library shows; current_version_id is the version being worked on. While a
--     new version waits for review, the approved one stays visible.
--   * Documents are stored privately in the database in chunks of at most 512 KB,
--     like Team Reports and Ads Monitoring, and are only ever sent through an
--     authorised route. storage_name is a generated safe name, never the upload name.
--   * AI request logs hold the action, model, timing, outcome and token counts.
--     They never hold the prompt, the member text or document content.

CREATE TABLE spiel_categories (
  id          VARCHAR(24)  NOT NULL,
  name        VARCHAR(80)  NOT NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME(3)  NOT NULL,
  updated_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spiel_categories_name (name),
  KEY ix_spiel_categories_order (sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiels (
  id                    VARCHAR(24)  NOT NULL,
  status                VARCHAR(24)  NOT NULL DEFAULT 'Draft',
  status_before_archive VARCHAR(24)  NULL,
  current_version_id    VARCHAR(24)  NULL,
  approved_version_id   VARCHAR(24)  NULL,
  approved_by           VARCHAR(24)  NULL,
  approved_at           DATETIME(3)  NULL,
  usage_count           INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at          DATETIME(3)  NULL,
  created_by            VARCHAR(24)  NOT NULL,
  created_at            DATETIME(3)  NOT NULL,
  updated_at            DATETIME(3)  NOT NULL,
  deleted_at            DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_spiels_status (status),
  KEY ix_spiels_creator (created_by),
  KEY ix_spiels_approved (approved_version_id),
  CONSTRAINT fk_spiels_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_spiels_approver FOREIGN KEY (approved_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_versions (
  id               VARCHAR(24)   NOT NULL,
  spiel_id         VARCHAR(24)   NOT NULL,
  version_no       INT UNSIGNED  NOT NULL,
  title            VARCHAR(160)  NOT NULL,
  category_id      VARCHAR(24)   NOT NULL,
  content          TEXT          NOT NULL,
  situation        VARCHAR(1000) NOT NULL DEFAULT '',
  target_country   VARCHAR(16)   NOT NULL,
  language         VARCHAR(40)   NOT NULL,
  platform         VARCHAR(16)   NOT NULL,
  campaign_ref     VARCHAR(160)  NOT NULL DEFAULT '',
  tags             VARCHAR(600)  NOT NULL DEFAULT '',
  content_key      VARCHAR(64)   NOT NULL,
  status           VARCHAR(24)   NOT NULL,
  admin_feedback   VARCHAR(2000) NOT NULL DEFAULT '',
  created_by       VARCHAR(24)   NOT NULL,
  created_at       DATETIME(3)   NOT NULL,
  updated_by       VARCHAR(24)   NULL,
  updated_at       DATETIME(3)   NOT NULL,
  submitted_at     DATETIME(3)   NULL,
  reviewed_by      VARCHAR(24)   NULL,
  reviewed_at      DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spiel_versions_no (spiel_id, version_no),
  KEY ix_spiel_versions_status (status),
  KEY ix_spiel_versions_key (content_key),
  CONSTRAINT fk_spiel_versions_spiel FOREIGN KEY (spiel_id) REFERENCES spiels (id) ON DELETE CASCADE,
  CONSTRAINT fk_spiel_versions_category FOREIGN KEY (category_id) REFERENCES spiel_categories (id),
  CONSTRAINT fk_spiel_versions_creator FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_spiel_versions_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_approvals (
  id          VARCHAR(24)   NOT NULL,
  spiel_id    VARCHAR(24)   NOT NULL,
  version_id  VARCHAR(24)   NULL,
  action      VARCHAR(32)   NOT NULL,
  feedback    VARCHAR(2000) NOT NULL DEFAULT '',
  changes     VARCHAR(600)  NOT NULL DEFAULT '',
  actor_id    VARCHAR(24)   NULL,
  actor_name  VARCHAR(160)  NOT NULL,
  created_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_spiel_approvals_spiel (spiel_id, created_at),
  CONSTRAINT fk_spiel_approvals_spiel FOREIGN KEY (spiel_id) REFERENCES spiels (id) ON DELETE CASCADE,
  CONSTRAINT fk_spiel_approvals_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_comments (
  id          VARCHAR(24)   NOT NULL,
  spiel_id    VARCHAR(24)   NOT NULL,
  body        VARCHAR(2000) NOT NULL,
  created_by  VARCHAR(24)   NOT NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  deleted_at  DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_spiel_comments_spiel (spiel_id, created_at),
  CONSTRAINT fk_spiel_comments_spiel FOREIGN KEY (spiel_id) REFERENCES spiels (id) ON DELETE CASCADE,
  CONSTRAINT fk_spiel_comments_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_documents (
  id                    VARCHAR(24)   NOT NULL,
  title                 VARCHAR(160)  NOT NULL,
  category_id           VARCHAR(24)   NULL,
  spiel_id              VARCHAR(24)   NULL,
  target_country        VARCHAR(16)   NOT NULL,
  language              VARCHAR(40)   NOT NULL,
  description           VARCHAR(1000) NOT NULL DEFAULT '',
  status                VARCHAR(24)   NOT NULL DEFAULT 'Draft',
  status_before_archive VARCHAR(24)   NULL,
  current_version_id    VARCHAR(24)   NULL,
  approved_version_id   VARCHAR(24)   NULL,
  approved_at           DATETIME(3)   NULL,
  admin_feedback        VARCHAR(2000) NOT NULL DEFAULT '',
  created_by            VARCHAR(24)   NOT NULL,
  created_at            DATETIME(3)   NOT NULL,
  updated_at            DATETIME(3)   NOT NULL,
  deleted_at            DATETIME(3)   NULL,
  PRIMARY KEY (id),
  KEY ix_spiel_documents_status (status),
  KEY ix_spiel_documents_creator (created_by),
  CONSTRAINT fk_spiel_documents_category FOREIGN KEY (category_id) REFERENCES spiel_categories (id) ON DELETE SET NULL,
  CONSTRAINT fk_spiel_documents_spiel FOREIGN KEY (spiel_id) REFERENCES spiels (id) ON DELETE SET NULL,
  CONSTRAINT fk_spiel_documents_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_document_versions (
  id              VARCHAR(24)   NOT NULL,
  document_id     VARCHAR(24)   NOT NULL,
  version_no      INT UNSIGNED  NOT NULL,
  file_name       VARCHAR(200)  NOT NULL,
  storage_name    VARCHAR(64)   NOT NULL,
  mime_type       VARCHAR(120)  NOT NULL,
  kind            VARCHAR(16)   NOT NULL,
  size_bytes      INT UNSIGNED  NOT NULL,
  sha256          CHAR(64)      NOT NULL,
  extracted_text  MEDIUMTEXT    NULL,
  status          VARCHAR(24)   NOT NULL,
  admin_feedback  VARCHAR(2000) NOT NULL DEFAULT '',
  created_by      VARCHAR(24)   NOT NULL,
  created_at      DATETIME(3)   NOT NULL,
  reviewed_by     VARCHAR(24)   NULL,
  reviewed_at     DATETIME(3)   NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_spiel_document_versions_no (document_id, version_no),
  UNIQUE KEY uq_spiel_document_versions_storage (storage_name),
  CONSTRAINT fk_spiel_document_versions_doc FOREIGN KEY (document_id) REFERENCES spiel_documents (id) ON DELETE CASCADE,
  CONSTRAINT fk_spiel_document_versions_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_file_chunks (
  file_id  VARCHAR(24)   NOT NULL,
  seq      INT UNSIGNED  NOT NULL,
  data     MEDIUMBLOB    NOT NULL,
  PRIMARY KEY (file_id, seq),
  CONSTRAINT fk_spiel_file_chunks_version FOREIGN KEY (file_id) REFERENCES spiel_document_versions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_favorites (
  user_id     VARCHAR(24)  NOT NULL,
  spiel_id    VARCHAR(24)  NOT NULL,
  created_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (user_id, spiel_id),
  KEY ix_spiel_favorites_spiel (spiel_id),
  CONSTRAINT fk_spiel_favorites_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_spiel_favorites_spiel FOREIGN KEY (spiel_id) REFERENCES spiels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_notes (
  user_id     VARCHAR(24)   NOT NULL,
  spiel_id    VARCHAR(24)   NOT NULL,
  body        VARCHAR(2000) NOT NULL,
  created_at  DATETIME(3)   NOT NULL,
  updated_at  DATETIME(3)   NOT NULL,
  PRIMARY KEY (user_id, spiel_id),
  CONSTRAINT fk_spiel_notes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_spiel_notes_spiel FOREIGN KEY (spiel_id) REFERENCES spiels (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE spiel_settings (
  id            TINYINT UNSIGNED NOT NULL,
  announcement  VARCHAR(1000)    NOT NULL DEFAULT '',
  updated_by    VARCHAR(24)      NULL,
  updated_at    DATETIME(3)      NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id           VARCHAR(24)   NOT NULL,
  user_id      VARCHAR(24)   NOT NULL,
  kind         VARCHAR(40)   NOT NULL,
  title        VARCHAR(200)  NOT NULL,
  body         VARCHAR(2000) NOT NULL DEFAULT '',
  link         VARCHAR(300)  NOT NULL DEFAULT '',
  record_type  VARCHAR(40)   NOT NULL DEFAULT '',
  record_id    VARCHAR(24)   NOT NULL DEFAULT '',
  read_at      DATETIME(3)   NULL,
  created_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_notifications_user (user_id, read_at, created_at),
  CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_settings (
  id                     TINYINT UNSIGNED  NOT NULL,
  enabled                TINYINT(1)        NOT NULL DEFAULT 1,
  models                 VARCHAR(1000)     NOT NULL,
  temperature            DECIMAL(3,2)      NOT NULL DEFAULT 0.40,
  max_output_tokens      SMALLINT UNSIGNED NOT NULL DEFAULT 1200,
  timeout_ms             INT UNSIGNED      NOT NULL DEFAULT 30000,
  daily_limit_per_member SMALLINT UNSIGNED NOT NULL DEFAULT 40,
  max_regenerations      TINYINT UNSIGNED  NOT NULL DEFAULT 3,
  max_document_chars     INT UNSIGNED      NOT NULL DEFAULT 12000,
  updated_by             VARCHAR(24)       NULL,
  updated_at             DATETIME(3)       NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_requests (
  id                 VARCHAR(24)   NOT NULL,
  user_id            VARCHAR(24)   NOT NULL,
  action             VARCHAR(32)   NOT NULL,
  spiel_id           VARCHAR(24)   NULL,
  regenerate_of      VARCHAR(24)   NULL,
  status             VARCHAR(16)   NOT NULL,
  model_used         VARCHAR(120)  NOT NULL DEFAULT '',
  used_fallback      TINYINT(1)    NOT NULL DEFAULT 0,
  fallback_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  error_type         VARCHAR(40)   NOT NULL DEFAULT '',
  duration_ms        INT UNSIGNED  NOT NULL DEFAULT 0,
  prompt_tokens      INT UNSIGNED  NULL,
  completion_tokens  INT UNSIGNED  NULL,
  total_tokens       INT UNSIGNED  NULL,
  input_chars        INT UNSIGNED  NOT NULL DEFAULT 0,
  document_ids       VARCHAR(400)  NOT NULL DEFAULT '',
  created_at         DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ai_requests_user_day (user_id, created_at),
  KEY ix_ai_requests_status (status, created_at),
  CONSTRAINT fk_ai_requests_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE ai_usage_logs (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id         VARCHAR(24)   NOT NULL,
  attempt_no         TINYINT UNSIGNED NOT NULL,
  model              VARCHAR(120)  NOT NULL,
  outcome            VARCHAR(16)   NOT NULL,
  http_status        SMALLINT UNSIGNED NULL,
  error_type         VARCHAR(40)   NOT NULL DEFAULT '',
  duration_ms        INT UNSIGNED  NOT NULL DEFAULT 0,
  prompt_tokens      INT UNSIGNED  NULL,
  completion_tokens  INT UNSIGNED  NULL,
  total_tokens       INT UNSIGNED  NULL,
  created_at         DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_ai_usage_logs_request (request_id),
  KEY ix_ai_usage_logs_outcome (outcome, created_at),
  CONSTRAINT fk_ai_usage_logs_request FOREIGN KEY (request_id) REFERENCES ai_requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO spiel_categories (id, name, sort_order, active, created_at, updated_at) VALUES
  ('SCT-0001', 'Greeting Spiel', 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0002', 'Introduction Spiel', 2, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0003', 'Strategic Spiel', 3, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0004', 'Convincing Spiel', 4, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0005', 'Follow-up Spiel', 5, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0006', 'Collaboration Spiel', 6, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0007', 'Closing Spiel', 7, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0008', 'Rejection Spiel', 8, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0009', 'Objection Handling', 9, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0010', 'Re-engagement Spiel', 10, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0011', 'Payment or Cooperation Spiel', 11, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
  ('SCT-0012', 'Custom Spiel', 12, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO spiel_settings (id) VALUES (1);

INSERT INTO ai_settings (id, models) VALUES
  (1, '[{"id":"qwen/qwen3-32b:free","enabled":true},{"id":"google/gemma-3-27b-it:free","enabled":true},{"id":"meta-llama/llama-3.3-70b-instruct:free","enabled":true}]');

INSERT INTO id_sequences (prefix, next_value, width) VALUES
  ('SCT', 13, 4), ('SPL', 1, 4), ('SPV', 1, 5), ('SPA', 1, 5), ('SPC', 1, 5),
  ('SPD', 1, 4), ('SPDV', 1, 5), ('NTF', 1, 6), ('AIR', 1, 6);
