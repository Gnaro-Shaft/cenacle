-- The "missions" box (ADR-0031, 2026-10-22): the mission alerts of the
-- platforms, decided by a [missions] rule on an exact sender address, for an
-- authenticated domain only. The model never answers it.
-- The list of boxes was an unnamed check written in 002 (PostgreSQL named it
-- mail_items_category_check); no migration had widened it until now.
-- NOT VALID, as in 011, 013 and 025: every migration is replayed at each run,
-- and a later list must not be rejected, on replay, by an earlier one. New
-- writes are checked all the same.
ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_category_check;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_category_check
  CHECK (category IN ('clients_prospects', 'administratif', 'bruit', 'missions', 'a_trier')) NOT VALID;
-- Only a rule puts a mail in "missions": never the model, never a fallback.
ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_missions_by_rule;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_missions_by_rule
  CHECK (category IS DISTINCT FROM 'missions' OR decided_by = 'rule');
