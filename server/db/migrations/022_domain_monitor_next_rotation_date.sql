-- A plain, manually-set reminder date — independent of the rotation groups
-- feature (migration 019), for anyone tracking their next rotation by hand
-- rather than through a configured batch/group.
ALTER TABLE domain_monitors ADD COLUMN next_rotation_date DATE NULL AFTER enabled_date;
