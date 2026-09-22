-- Pakistan Competitor register: where competitor brands are found on each
-- platform and how to reach them (WhatsApp, Telegram, other references).
-- No performance figures — this is a contact and presence register, not a
-- metrics table, so it carries none of Growth's daily-snapshot machinery.

CREATE TABLE pakistan_competitors (
  id             VARCHAR(24)   NOT NULL,
  platform_id    VARCHAR(24)   NOT NULL,
  link_domain    VARCHAR(600)  NOT NULL,
  whatsapp       VARCHAR(160)  NOT NULL DEFAULT '',
  telegram       VARCHAR(160)  NOT NULL DEFAULT '',
  others         VARCHAR(600)  NOT NULL DEFAULT '',
  notes          TEXT          NOT NULL,
  archived       TINYINT(1)    NOT NULL DEFAULT 0,
  created_at     DATETIME(3)   NOT NULL,
  updated_at     DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_pakistan_competitors_platform (platform_id),
  CONSTRAINT fk_pakistan_competitors_platform FOREIGN KEY (platform_id) REFERENCES platforms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO id_sequences (prefix, next_value, width) VALUES ('CMP', 1, 4);
