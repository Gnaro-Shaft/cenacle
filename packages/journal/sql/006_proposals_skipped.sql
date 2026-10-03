-- Phase 4, B2: Iris may decide NOT to propose (the vote on the template was
-- split, or no template fits). That decision is recorded once, like a
-- proposal, so the same mail is never put to the vote again: one situation =
-- one decision, ever. A skipped row carries no text and no template.
-- Idempotent: the migration runs again at every `db:migrate`.

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending', 'accepted', 'refused', 'lapsed', 'cancelled', 'sent', 'skipped'));

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_skipped_empty;
ALTER TABLE proposals ADD CONSTRAINT proposals_skipped_empty
  CHECK (status <> 'skipped' OR (draft IS NULL AND trame IS NULL));
