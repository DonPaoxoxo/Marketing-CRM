-- Verdict and payment on agent proofs, set by the System Administrator only.
--
--   * verdict: NULL until reviewed, then 'Accepted' or 'Rejected'. A rejection
--     carries a written reason (verdict_reason), shown beside the proof.
--   * payment_status: 'Not paid' by default; only the System Administrator may
--     mark a proof 'Paid' (or back). Enforced by the API, not by the database.
--   Every change is also written to the audit trail on the agent.

ALTER TABLE agent_proofs
  ADD COLUMN verdict          VARCHAR(16)  NULL AFTER uploaded_by_name,
  ADD COLUMN verdict_reason   VARCHAR(500) NOT NULL DEFAULT '' AFTER verdict,
  ADD COLUMN reviewed_by_name VARCHAR(160) NOT NULL DEFAULT '' AFTER verdict_reason,
  ADD COLUMN reviewed_at      DATETIME(3)  NULL AFTER reviewed_by_name,
  ADD COLUMN payment_status   VARCHAR(16)  NOT NULL DEFAULT 'Not paid' AFTER reviewed_at,
  ADD COLUMN paid_by_name     VARCHAR(160) NOT NULL DEFAULT '' AFTER payment_status,
  ADD COLUMN paid_at          DATETIME(3)  NULL AFTER paid_by_name;
