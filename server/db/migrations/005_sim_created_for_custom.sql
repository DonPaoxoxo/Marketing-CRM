-- Created For takes a custom purpose as well as the presets: Serper, Twilio,
-- Discord and so on. Widened from 32 to 80 characters; existing values,
-- including 'Other', are kept as they are.

ALTER TABLE sims
  MODIFY COLUMN created_for VARCHAR(80) NOT NULL DEFAULT '';
