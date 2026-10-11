-- J6f (ADR-0027): an action on a server, from my button to its proof. The
-- catalogue is closed (`services` first: restart the services running on a
-- replaced library); the script on the server decides the rest. No personal
-- data: a machine name, states, an exit code. Purged by the operator 365 days
-- after the request.
--   demandee        I pressed the button: waiting for my confirmation;
--   confirmee       confirmed within its 60 seconds: the operator will act;
--   expiree         not confirmed in time: nothing done;
--   en_cours        the operator is running it (one at a time, all machines);
--   faite           the script did it (exit 0);
--   rien_a_faire    the script found nothing to do (exit 10);
--   refusee_serveur a guard of the script refused (exit 11);
--   refusee         the operator refused before acting (see refusal);
--   echouee         the script failed, or the server could not be reached.
-- verified: what Legion's next verdict showed after a done action.
CREATE TABLE IF NOT EXISTS serveur_actions (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  finding_id     BIGINT NOT NULL REFERENCES securite_constats (id) ON DELETE CASCADE,
  host           TEXT NOT NULL CHECK (host ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  action         TEXT NOT NULL CHECK (action IN ('services')),
  state          TEXT NOT NULL CHECK (state IN ('demandee', 'confirmee', 'expiree', 'en_cours',
                   'faite', 'rien_a_faire', 'refusee_serveur', 'refusee', 'echouee')),
  confirm_token  TEXT CHECK (confirm_token ~ '^[0-9a-f]{16}$'),
  requested_at   TIMESTAMPTZ NOT NULL,
  confirm_until  TIMESTAMPTZ NOT NULL,
  confirmed_at   TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  exit_code      INTEGER CHECK (exit_code BETWEEN -1 AND 255),
  refusal        TEXT CHECK (refusal ~ '^[a-z_]{1,40}$'),
  verified       TEXT CHECK (verified IN ('disparu', 'toujours_la')),
  verified_at    TIMESTAMPTZ,
  told           BOOLEAN NOT NULL DEFAULT false,
  CHECK (confirm_until > requested_at),
  CHECK ((state = 'refusee') = (refusal IS NOT NULL))
);
-- One action at a time, whatever the machine: the database refuses a second.
CREATE UNIQUE INDEX IF NOT EXISTS serveur_actions_one_running
  ON serveur_actions ((true)) WHERE state = 'en_cours';
-- One pending request per finding and action.
CREATE UNIQUE INDEX IF NOT EXISTS serveur_actions_one_pending
  ON serveur_actions (finding_id, action) WHERE state IN ('demandee', 'confirmee', 'en_cours');
