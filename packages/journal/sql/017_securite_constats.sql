-- The security agent's findings (J6, ADR-0025): what the checks saw on the
-- Mac and in Cénacle's dependencies, followed until it is resolved, accepted
-- or gone. No personal data: package names, update labels, settings of the
-- Mac. One active finding at most per (type, target, occurrence).
-- Purged by the agent: closed ones 365 days after closing; an accepted risk
-- 90 days after it was accepted, so that it is asked again.
CREATE TABLE IF NOT EXISTS securite_constats (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type           TEXT NOT NULL CHECK (type ~ '^[a-z_]{1,40}$'),
  target         TEXT NOT NULL CHECK (length(target) BETWEEN 1 AND 120),
  occurrence     TEXT NOT NULL CHECK (length(occurrence) BETWEEN 1 AND 60),
  check_name     TEXT NOT NULL CHECK (check_name ~ '^[a-z_]{1,40}$'),
  severity       TEXT NOT NULL CHECK (severity IN ('info', 'faible', 'moyen', 'eleve', 'critique')),
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
  params         JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         TEXT NOT NULL CHECK (status IN ('candidat', 'ouvert', 'resolu', 'accepte', 'caduc')),
  first_seen     TIMESTAMPTZ NOT NULL,
  last_seen      TIMESTAMPTZ NOT NULL,
  seen_count     INTEGER NOT NULL DEFAULT 1 CHECK (seen_count >= 1),
  closed_at      TIMESTAMPTZ,
  reason         TEXT CHECK (length(reason) BETWEEN 3 AND 200),
  accepted_at    TIMESTAMPTZ,
  signaled_open  BOOLEAN NOT NULL DEFAULT false,
  signaled_close BOOLEAN NOT NULL DEFAULT false,
  CHECK ((status IN ('resolu', 'caduc')) = (closed_at IS NOT NULL)),
  CHECK ((status = 'accepte') = (reason IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS securite_constats_active
  ON securite_constats (type, target, occurrence)
  WHERE status IN ('candidat', 'ouvert', 'accepte');
