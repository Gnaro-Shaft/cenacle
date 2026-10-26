-- The proof of a restart knows the spared ones (ADR-0035, point 7; 2026-10-26):
-- on the site's VPS, a restart left only what the script spares by principle,
-- more than Legion had counted before, and was told "still there". The script
-- now folds the spared count into its exit code (20 + n, 120 + n, kept in
-- exit_code); a verdict counting at most n says:
--   epargnes  only the spared ones remain.
-- NOT VALID, like 024: every migration is replayed at each run.
ALTER TABLE serveur_actions DROP CONSTRAINT IF EXISTS serveur_actions_verified_check;
ALTER TABLE serveur_actions ADD CONSTRAINT serveur_actions_verified_check
  CHECK (verified IN ('disparu', 'toujours_la', 'pas_revenue', 'reduit', 'epargnes')) NOT VALID;
