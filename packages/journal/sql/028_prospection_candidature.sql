-- The "Candidature" cards (ADR-0034, 2026-10-24): a platform's confirmation
-- that I applied becomes a card in "applied", decided by the code on the
-- sender's exact address. A new reason says so, and two new outcomes for a
-- read mail: a confirmation read, or one the model could not read as a single
-- mission (to add by hand, shown on the page).
-- Both lists were unnamed checks written in 027 (PostgreSQL named them).
-- NOT VALID, as in 026: every migration is replayed at each run, and a later
-- list must not be rejected, on replay, by an earlier one. New writes are
-- checked all the same.
ALTER TABLE prospection_cartes DROP CONSTRAINT IF EXISTS prospection_cartes_reason_check;
ALTER TABLE prospection_cartes ADD CONSTRAINT prospection_cartes_reason_check
  CHECK (reason IN (
    'esn_list', 'esn_phrase', 'esn_model', 'intermediary_unknown',
    'stack', 'rate', 'remote', 'application_confirmed')) NOT VALID;
ALTER TABLE prospection_mails_lus DROP CONSTRAINT IF EXISTS prospection_mails_lus_outcome_check;
ALTER TABLE prospection_mails_lus ADD CONSTRAINT prospection_mails_lus_outcome_check
  CHECK (outcome IN (
    'read', 'floor', 'too_big', 'not_platform', 'unauthenticated',
    'unparsable', 'no_offer', 'application', 'application_unreadable')) NOT VALID;
-- Only a confirmation's card carries this reason: from a mail, decided by a
-- rule, in "applied". My move clears the reason (decided_by 'me'), so it
-- never holds a card back.
ALTER TABLE prospection_cartes DROP CONSTRAINT IF EXISTS prospection_cartes_application_by_rule;
ALTER TABLE prospection_cartes ADD CONSTRAINT prospection_cartes_application_by_rule
  CHECK (reason IS DISTINCT FROM 'application_confirmed'
         OR (board_column = 'applied' AND source = 'mail' AND decided_by = 'rule')) NOT VALID;
