-- A plan's step makes one action, once (ADR-0035). The store launches the step
-- and inserts its action in one transaction; this index is the database's own
-- refusal of a second action still to run for the same step of a plan —
-- whoever asks, whatever the code believes. Plan actions have no finding, so
-- `serveur_actions_one_pending` (finding_id, action) never covered them.
-- Idempotent: the migration runs again at every `db:migrate`.
CREATE UNIQUE INDEX IF NOT EXISTS serveur_actions_one_pending_per_plan
  ON serveur_actions (plan_id, host, action)
  WHERE plan_id IS NOT NULL AND state IN ('confirmee', 'en_cours');
