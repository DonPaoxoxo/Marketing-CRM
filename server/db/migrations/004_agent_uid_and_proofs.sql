-- Agent UID and proof images.
--
--   * agents.external_uid: the agent's own UID, typed in by the team. Unique
--     among live agents when filled in, enforced by the API (archived agents
--     may keep an old one), so only an ordinary index here.
--   * agent_proofs: a screenshot proving an agent's post plus its Post URL.
--     Images are PNG, JPEG or WebP, 500 KB at most, checked by their bytes in the
--     API. Kept in the database rather than on disk so a database backup is the
--     whole record, and so no file is ever reachable without a signed-in session.

ALTER TABLE agents
  ADD COLUMN external_uid VARCHAR(64) NOT NULL DEFAULT '' AFTER name,
  ADD KEY ix_agents_external_uid (external_uid);

CREATE TABLE agent_proofs (
  id           VARCHAR(24)   NOT NULL,
  agent_id     VARCHAR(24)   NOT NULL,
  post_url     VARCHAR(2048) NOT NULL,
  post_url_key VARCHAR(2048) NOT NULL,
  mime_type    VARCHAR(32)   NOT NULL,
  size_bytes   INT UNSIGNED  NOT NULL,
  image        MEDIUMBLOB    NOT NULL,
  uploaded_by  VARCHAR(24)   NULL,
  uploaded_by_name VARCHAR(160) NOT NULL DEFAULT '',
  archived     TINYINT(1)    NOT NULL DEFAULT 0,
  created_at   DATETIME(3)   NOT NULL,
  updated_at   DATETIME(3)   NOT NULL,
  PRIMARY KEY (id),
  KEY ix_agent_proofs_agent (agent_id, created_at),
  KEY ix_agent_proofs_url (post_url_key(191)),
  CONSTRAINT fk_agent_proofs_agent FOREIGN KEY (agent_id) REFERENCES agents (id),
  CONSTRAINT fk_agent_proofs_user FOREIGN KEY (uploaded_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO id_sequences (prefix, next_value, width) VALUES ('PRF', 1, 4);
