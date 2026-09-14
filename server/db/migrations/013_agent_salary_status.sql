-- Salary status on agents: Hold, Advance, or Customize with a typed-in status.
--
--   * NULL until set. Set only by the System Administrator, through its own API
--     route; an ordinary agent edit cannot change it.
--   * salary_note holds the typed-in text for Customize and is empty otherwise.
--   * Who set it last, and when, is kept beside it; every change is also audited.

ALTER TABLE agents
  ADD COLUMN salary_status          VARCHAR(16)  NULL AFTER agreement_ref,
  ADD COLUMN salary_note            VARCHAR(80)  NOT NULL DEFAULT '' AFTER salary_status,
  ADD COLUMN salary_updated_by_name VARCHAR(160) NOT NULL DEFAULT '' AFTER salary_note,
  ADD COLUMN salary_updated_at      DATETIME(3)  NULL AFTER salary_updated_by_name;
