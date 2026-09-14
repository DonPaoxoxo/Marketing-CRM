-- Team Reports: daily, weekly and monthly work reports, their files and replies.
--
--   * One report per person per period (UNIQUE author, type, start).
--   * Files are kept in the database — images under 1 MB, documents up to 5 MB,
--     five per report, checked by their bytes in the API — so a database backup
--     is the whole record and no file is reachable without a signed-in session.
--     The bytes are split into chunks of at most 512 KB, so a 5 MB document saves
--     even where the server's max_allowed_packet is the old 1 MB default.
--   * Reports are the one record the System Administrator may delete for good:
--     files and replies go with them (ON DELETE CASCADE); the audit history keeps
--     a single line naming who deleted which report and why.

CREATE TABLE team_reports (
  id              VARCHAR(24)  NOT NULL,
  author_id       VARCHAR(24)  NOT NULL,
  period_type     VARCHAR(8)   NOT NULL,
  period_start    DATE         NOT NULL,
  work_done       TEXT         NOT NULL,
  results         TEXT         NOT NULL,
  blockers        TEXT         NOT NULL,
  recommendation  TEXT         NOT NULL,
  status          VARCHAR(16)  NOT NULL DEFAULT 'Submitted',
  reviewed_by     VARCHAR(24)  NULL,
  reviewed_at     DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL,
  updated_at      DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_team_reports_period (author_id, period_type, period_start),
  KEY ix_team_reports_period (period_type, period_start),
  CONSTRAINT fk_team_reports_author FOREIGN KEY (author_id) REFERENCES users (id),
  CONSTRAINT fk_team_reports_reviewer FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE team_report_files (
  id           VARCHAR(24)  NOT NULL,
  report_id    VARCHAR(24)  NOT NULL,
  file_name    VARCHAR(200) NOT NULL,
  mime_type    VARCHAR(120) NOT NULL,
  kind         VARCHAR(8)   NOT NULL,
  size_bytes   INT UNSIGNED NOT NULL,
  uploaded_at  DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_team_report_files_report (report_id),
  CONSTRAINT fk_team_report_files_report FOREIGN KEY (report_id) REFERENCES team_reports (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE team_report_file_chunks (
  file_id  VARCHAR(24)       NOT NULL,
  seq      SMALLINT UNSIGNED NOT NULL,
  data     MEDIUMBLOB        NOT NULL,
  PRIMARY KEY (file_id, seq),
  CONSTRAINT fk_team_report_file_chunks_file FOREIGN KEY (file_id) REFERENCES team_report_files (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE team_report_replies (
  id           VARCHAR(24)  NOT NULL,
  report_id    VARCHAR(24)  NOT NULL,
  author_id    VARCHAR(24)  NULL,
  author_name  VARCHAR(160) NOT NULL,
  author_role  VARCHAR(32)  NOT NULL DEFAULT '',
  body         TEXT         NOT NULL,
  created_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  KEY ix_team_report_replies_report (report_id, created_at),
  CONSTRAINT fk_team_report_replies_report FOREIGN KEY (report_id) REFERENCES team_reports (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_report_replies_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO id_sequences (prefix, next_value, width) VALUES ('RPT', 1, 4), ('RPF', 1, 4), ('RPR', 1, 4);
