-- The maintenance plan (ADR-0035, J7d): the summary's steps, validated once by
-- me, confirmed within 2 minutes, then chained by the operator one step at a
-- time. Machine names, catalogue actions, states and dates; no person's data,
-- no server output. One plan runs at a time, guaranteed by the database.
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  state          TEXT NOT NULL CHECK (state IN ('proposee', 'a_confirmer', 'confirmee', 'en_cours',
                                                'terminee', 'arretee', 'expiree', 'remplacee')),
  created_at     TIMESTAMPTZ NOT NULL,
  button_token   TEXT CHECK (button_token ~ '^[0-9a-f]{16}$'),
  message_id     BIGINT,
  confirm_token  TEXT CHECK (confirm_token ~ '^[0-9a-f]{16}$'),
  confirm_until  TIMESTAMPTZ,
  confirmed_at   TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  stop_reason    TEXT CHECK (stop_reason ~ '^[a-z_]{1,40}$'),
  CHECK (state NOT IN ('confirmee', 'en_cours') OR confirmed_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_plans_one_running
  ON maintenance_plans ((true)) WHERE state IN ('confirmee', 'en_cours');

CREATE TABLE IF NOT EXISTS maintenance_etapes (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  plan_id            BIGINT NOT NULL REFERENCES maintenance_plans (id) ON DELETE CASCADE,
  position           SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 99),
  host               TEXT NOT NULL CHECK (host ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  action             TEXT NOT NULL CHECK (action IN ('services', 'redemarrer', 'maj_securite')),
  conditional        BOOLEAN NOT NULL,
  state              TEXT NOT NULL CHECK (state IN ('attente', 'retiree', 'lancee', 'faite', 'sautee',
                                                    'arretee', 'annulee')),
  serveur_action_id  BIGINT REFERENCES serveur_actions (id) ON DELETE SET NULL,
  reason             TEXT CHECK (reason ~ '^[a-z_]{1,40}$'),
  UNIQUE (plan_id, position)
);

-- A step of a plan is an ordinary action of ADR-0027, tied to its plan rather
-- than to a finding: its 🔁 or 🔄 "if needed" has no finding yet when I
-- validate (the finding comes 10 to 15 minutes after the update, J7d).
ALTER TABLE serveur_actions ALTER COLUMN finding_id DROP NOT NULL;
ALTER TABLE serveur_actions ADD COLUMN IF NOT EXISTS plan_id BIGINT
  REFERENCES maintenance_plans (id) ON DELETE CASCADE;
ALTER TABLE serveur_actions DROP CONSTRAINT IF EXISTS serveur_actions_origin_check;
ALTER TABLE serveur_actions ADD CONSTRAINT serveur_actions_origin_check
  CHECK ((finding_id IS NULL) <> (plan_id IS NULL)) NOT VALID;
