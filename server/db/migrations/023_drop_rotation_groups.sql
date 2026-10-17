-- The rotation-groups/batches feature (migration 019) is removed in favour
-- of a plain manual Enabled/Disabled switch and a manually-set next-rotation
-- reminder date on domain_monitors itself (migrations 020, 022). Drop the
-- child tables before their parents to satisfy foreign keys.
DROP TABLE IF EXISTS rotation_event_domain_changes;
DROP TABLE IF EXISTS rotation_events;
DROP TABLE IF EXISTS rotation_batch_members;
DROP TABLE IF EXISTS rotation_batches;
DROP TABLE IF EXISTS rotation_groups;

ALTER TABLE domain_monitors DROP COLUMN activation_status;

DELETE FROM id_sequences WHERE prefix IN ('RTG', 'RTB', 'RTE');
