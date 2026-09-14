-- The team's own SIM tracking sheet, as columns on the SIM record.
--
-- Created For: what the SIM was used to create — 'Email + Telegram', 'Email',
-- 'Telegram', 'Other', or '' when nothing yet.
-- Email and Telegram username: the accounts registered with the SIM. Stored on
-- the SIM, matching the sheet, rather than as linked account records.
--
-- All three default to '' so every existing SIM stays valid without a backfill.
-- The indexes support the duplicate check: an email or Telegram username belongs
-- to one live SIM.

ALTER TABLE sims
  ADD COLUMN created_for        VARCHAR(32)  NOT NULL DEFAULT '' AFTER form,
  ADD COLUMN email              VARCHAR(320) NOT NULL DEFAULT '' AFTER created_for,
  ADD COLUMN telegram_username  VARCHAR(64)  NOT NULL DEFAULT '' AFTER email,
  ADD KEY ix_sims_email (email),
  ADD KEY ix_sims_telegram (telegram_username);
