-- R4 (ADR-0040): Legion stopped on 22/11/2026, and with it the comparison of
-- the two rondes (`ronde_comparaison`) left the security agent. Its findings
-- would stay open for ever — only a check that really ran can close one — so
-- they are closed here, quietly, as an expired finding is: `caduc` is never
-- announced (only `resolu` is). My decisions stay as they are: an accepted
-- finding is not touched (on 22/11/2026 there was none among the 265). No personal data: machine names and ports.
-- Idempotent: the migration runs again at every `db:migrate`; no check writes
-- `ronde_comparaison` any more, so it finds nothing left to close.

UPDATE securite_constats
SET status = 'caduc', closed_at = now(), button_token = NULL
WHERE check_name = 'ronde_comparaison' AND status IN ('candidat', 'ouvert');
