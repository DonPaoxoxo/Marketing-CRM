-- Telegram username, payment term and a list of specific post links on agents.
--
--   * telegram_username mirrors a SIM's: stored without the leading "@", shown
--     with it.
--   * payment_term is open per agent type: Net 7/15/30 for Individual/Agency,
--     Per Post/Commission/Monthly Retainer for Promoter/Influencer — the split
--     lives in src/lib/agents.ts, not the database. NULL until chosen.
--   * agent_post_links is an ordered list, the same shape as agent_channels,
--     but for specific posts rather than the agent's own channel/profile.

ALTER TABLE agents
  ADD COLUMN telegram_username VARCHAR(80) NOT NULL DEFAULT '' AFTER contact_number,
  ADD COLUMN payment_term      VARCHAR(32) NULL AFTER cooperation_status;

CREATE TABLE agent_post_links (
  agent_id  VARCHAR(24)   NOT NULL,
  position  SMALLINT      NOT NULL,
  url       VARCHAR(2048) NOT NULL,
  PRIMARY KEY (agent_id, position),
  CONSTRAINT fk_apl_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
