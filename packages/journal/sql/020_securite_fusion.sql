-- J6d (ADR-0026): merging an agent's pull request from my Telegram button,
-- and the trust record. More states for an action:
--   ci_verte            CI green, the ✅ Fusionner / ❌ Fermer buttons sent;
--   fusion_demandee     I pressed ✅: the next round merges, if nothing moved;
--   fermeture_demandee  I pressed ❌: the next round closes the PR;
--   fusionnee, fermee   done.
-- action_head_sha: the commit the CI tested when the buttons were sent — a
-- merge goes through only on that very commit. action_delegated: the fix was
-- prepared under a delegation (securite.toml), not on my 🔧.
ALTER TABLE securite_constats DROP CONSTRAINT IF EXISTS securite_constats_action_state_check;
ALTER TABLE securite_constats ADD CONSTRAINT securite_constats_action_state_check
  CHECK (action_state IN ('demandee', 'pr_ouverte', 'ci_echouee', 'abandonnee', 'echouee',
                          'ci_verte', 'fusion_demandee', 'fermeture_demandee', 'fusionnee', 'fermee'));
ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS action_head_sha TEXT
  CHECK (action_head_sha ~ '^[0-9a-f]{40}$');
ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS action_delegated BOOLEAN NOT NULL DEFAULT false;
