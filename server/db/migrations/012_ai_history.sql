-- AI Assistant Learner history: each member's own past suggestions, which they can reuse or remove.
--
--   * One row per successful AI request, owned by the member who made it (user_id
--     comes from the session). Only that member sees it; the member or the System
--     Owner may remove it.
--   * input_text is the text exactly as it was sent to the AI, so phone numbers,
--     emails and secret-looking values are already replaced by placeholders.
--   * Removing a history row does not remove the ai_requests / ai_usage_logs row:
--     usage limits and the System Owner's logs (which hold no text) stay intact.
--   * The API keeps the latest 200 rows per member.

CREATE TABLE ai_history (
  ai_request_id  VARCHAR(24)   NOT NULL,
  user_id        VARCHAR(24)   NOT NULL,
  action         VARCHAR(32)   NOT NULL,
  input_text     TEXT          NOT NULL,
  context        VARCHAR(2000) NOT NULL DEFAULT '{}',
  suggestion     MEDIUMTEXT    NOT NULL,
  model          VARCHAR(120)  NOT NULL,
  model_position TINYINT UNSIGNED NOT NULL,
  spiel_id       VARCHAR(24)   NULL,
  document_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at     DATETIME(3)   NOT NULL,
  PRIMARY KEY (ai_request_id),
  KEY ix_ai_history_user (user_id, created_at),
  CONSTRAINT fk_ai_history_request FOREIGN KEY (ai_request_id) REFERENCES ai_requests (id) ON DELETE CASCADE,
  CONSTRAINT fk_ai_history_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
