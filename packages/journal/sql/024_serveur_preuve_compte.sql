-- The proof of a restart, counted (2026-10-12): a node went from 26 services
-- on a replaced library to 8 — the ones the script spares — and was told "still
-- there". The operator now keeps what Legion counted before and after:
--   reduit   fewer than before, not none (the spared ones remain).
ALTER TABLE serveur_actions ADD COLUMN IF NOT EXISTS before_count INTEGER CHECK (before_count >= 0);
ALTER TABLE serveur_actions ADD COLUMN IF NOT EXISTS after_count INTEGER CHECK (after_count >= 0);
-- NOT VALID: every migration is replayed at each run; a list a later migration
-- widens must not reject, on replay, the rows that later list allows. New writes
-- are checked all the same.
ALTER TABLE serveur_actions DROP CONSTRAINT IF EXISTS serveur_actions_verified_check;
ALTER TABLE serveur_actions ADD CONSTRAINT serveur_actions_verified_check
  CHECK (verified IN ('disparu', 'toujours_la', 'pas_revenue', 'reduit')) NOT VALID;
