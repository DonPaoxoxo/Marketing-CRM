-- One screenshot per social media post, proving it went out. Kept apart from
-- social_media_posts (never a SELECT * away from the main register) the same
-- way agent_proofs is kept apart from agents — the image is fetched on its
-- own only when shown, never carried in the bootstrap payload.

CREATE TABLE social_post_screenshots (
  post_id           VARCHAR(24)   NOT NULL,
  mime_type         VARCHAR(32)   NOT NULL,
  size_bytes        INT UNSIGNED  NOT NULL,
  image             MEDIUMBLOB    NOT NULL,
  uploaded_by       VARCHAR(24)   NULL,
  uploaded_by_name  VARCHAR(160)  NOT NULL DEFAULT '',
  uploaded_at       DATETIME(3)   NOT NULL,
  PRIMARY KEY (post_id),
  CONSTRAINT fk_social_post_screenshots_post FOREIGN KEY (post_id) REFERENCES social_media_posts (id) ON DELETE CASCADE,
  CONSTRAINT fk_social_post_screenshots_user FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
