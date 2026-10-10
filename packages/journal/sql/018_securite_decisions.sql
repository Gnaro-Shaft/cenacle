-- J6b (ADR-0025): my decisions on the security agent's findings, from
-- Telegram buttons. Two more statuses:
--  - pris_en_charge: "I'm on it" — still followed until a check sees it fixed;
--  - refuse: "this proposal does not suit me" — quiet for its occurrence,
--    asked again 30 days after the decision (purged by the agent).
-- Each finding offered with buttons carries a random single-use token: a
-- forged, replayed or stale button does nothing. No chat id is kept.
ALTER TABLE securite_constats DROP CONSTRAINT IF EXISTS securite_constats_status_check;
ALTER TABLE securite_constats ADD CONSTRAINT securite_constats_status_check
  CHECK (status IN ('candidat', 'ouvert', 'pris_en_charge', 'resolu', 'accepte', 'refuse', 'caduc'));
ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;
ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS button_token TEXT
  CHECK (button_token ~ '^[0-9a-f]{16}$');
DROP INDEX IF EXISTS securite_constats_active;
CREATE UNIQUE INDEX IF NOT EXISTS securite_constats_active
  ON securite_constats (type, target, occurrence)
  WHERE status IN ('candidat', 'ouvert', 'pris_en_charge', 'accepte', 'refuse');

-- A reason asked for ("keep the risk"): only a direct reply to that very
-- message, within its deadline, is taken. Removed once used or expired.
CREATE TABLE IF NOT EXISTS securite_raisons (
  prompt_message_id BIGINT PRIMARY KEY,
  finding_id        BIGINT NOT NULL REFERENCES securite_constats (id) ON DELETE CASCADE,
  expires_at        TIMESTAMPTZ NOT NULL
);
