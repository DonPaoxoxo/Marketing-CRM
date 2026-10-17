-- A manual on/off switch, independent of the rotation Active/Standby cycle
-- (migration 019). A domain can be pulled out of use (Disabled) without
-- touching which batch it belongs to or affecting a rotation in progress.
ALTER TABLE domain_monitors
  ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE AFTER activation_status,
  ADD COLUMN enabled_date DATE NULL AFTER enabled;

UPDATE domain_monitors SET enabled_date = DATE(created_at) WHERE enabled = TRUE;
