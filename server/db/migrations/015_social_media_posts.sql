-- Social Media Posting: a daily log of what was posted, where, by whom and
-- why — not a performance tracker (see follower_snapshots/content_posts for
-- engagement figures). Archived rather than deleted by default; a permanent
-- delete is a separate, explicit action, same as Team Reports.

CREATE TABLE social_media_posts (
  id                   VARCHAR(24)   NOT NULL,
  marketing_member_id  VARCHAR(24)   NOT NULL,
  purpose              VARCHAR(32)   NOT NULL,
  custom_purpose       VARCHAR(160)  NOT NULL DEFAULT '',
  platform             VARCHAR(32)   NOT NULL,
  custom_platform      VARCHAR(160)  NOT NULL DEFAULT '',
  post_date            DATE          NOT NULL,
  post_link            VARCHAR(2048) NOT NULL,
  notes                TEXT          NOT NULL,
  status               VARCHAR(16)   NOT NULL DEFAULT 'active',
  archived_at          DATETIME(3)   NULL,
  archived_by          VARCHAR(24)   NULL,
  created_by           VARCHAR(24)   NULL,
  created_at           DATETIME(3)   NOT NULL,
  updated_at           DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_social_posts_date (post_date),
  KEY ix_social_posts_status (status),
  KEY ix_social_posts_member (marketing_member_id),
  KEY ix_social_posts_platform (platform),
  CONSTRAINT fk_social_posts_member FOREIGN KEY (marketing_member_id) REFERENCES users (id),
  CONSTRAINT fk_social_posts_archiver FOREIGN KEY (archived_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_social_posts_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO id_sequences (prefix, next_value, width) VALUES ('SMP', 1, 4);
