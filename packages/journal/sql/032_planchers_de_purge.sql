-- The floors of the purges (charter rule 4; audit of 2026-11-13).
-- purge_events() and purge_proposals() run as the owner, for an application
-- role that may not delete by itself (010). They only refused a cutoff in the
-- future: `select purge_events(now())` erased the whole journal, from any
-- program holding the application password. The retention now binds the
-- database too: a cutoff more recent than its floor is refused.
-- The floors are the retentions of the cadre (journal_jours,
-- propositions_jours), written by `npm run db:migrate` as the owner. The
-- application role can neither read nor change them. No floor set: every
-- purge is refused (deny by default). No personal data: two numbers.
-- Idempotent: the migration runs again at every `db:migrate`.
CREATE TABLE IF NOT EXISTS purge_planchers (
  cle      TEXT PRIMARY KEY CHECK (cle IN ('journal_jours', 'propositions_jours')),
  jours    INTEGER NOT NULL CHECK (jours BETWEEN 1 AND 730),
  pose_le  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Raises unless the cutoff is at least the floor's days old. Days are counted
-- as 24 hours each, as the programs count them (never calendar days: a change
-- of hour would refuse a rightful purge). One hour of margin: the programs'
-- clock and the database's are two clocks (the database runs in a container).
-- The table is named with its schema, and pg_temp comes last in the search
-- path: a temporary table of the same name, which any role may create, is
-- otherwise read first — and would set its own floor.
--   PC001: the cutoff is more recent than the retention;
--   PC002: no floor is set.
CREATE OR REPLACE FUNCTION purge_floor_holds(la_cle TEXT, cutoff TIMESTAMPTZ) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  floor_days INTEGER;
BEGIN
  SELECT jours INTO floor_days FROM public.purge_planchers WHERE cle = la_cle;
  IF floor_days IS NULL THEN
    RAISE EXCEPTION 'purge: no floor is set for %', la_cle USING ERRCODE = 'PC002';
  END IF;
  IF cutoff IS NULL
     OR cutoff > clock_timestamp() - make_interval(hours => floor_days * 24) + interval '1 hour' THEN
    RAISE EXCEPTION 'purge: the cutoff is more recent than the % days of %', floor_days, la_cle
      USING ERRCODE = 'PC001';
  END IF;
END
$$;

-- The two purges of 010, unchanged but for the floor checked first.
CREATE OR REPLACE FUNCTION purge_proposals(cutoff TIMESTAMPTZ) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n INTEGER;
BEGIN
  IF cutoff > clock_timestamp() THEN
    RAISE EXCEPTION 'purge_proposals: the cutoff cannot be in the future';
  END IF;
  PERFORM purge_floor_holds('propositions_jours', cutoff);
  DELETE FROM proposals
    WHERE status IN ('sent', 'failed', 'refused', 'lapsed', 'cancelled', 'skipped')
      AND closed_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    INSERT INTO events (agent, type, payload)
      VALUES ('cenacle', 'proposals.purged', jsonb_build_object('count', n, 'before', cutoff));
  END IF;
  RETURN n;
END
$$;

CREATE OR REPLACE FUNCTION purge_events(cutoff TIMESTAMPTZ) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  n INTEGER;
BEGIN
  IF cutoff > clock_timestamp() THEN
    RAISE EXCEPTION 'purge_events: the cutoff cannot be in the future';
  END IF;
  PERFORM purge_floor_holds('journal_jours', cutoff);
  PERFORM set_config('cenacle.purging_events', 'on', true);
  -- The states shown are projected from the journal: a proposal's creation
  -- goes only together with its closing, or the projection would meet a
  -- closing for a proposal it never saw (and an open proposal keeps its own).
  DELETE FROM events e
    WHERE e.occurred_at < cutoff
      AND (e.type <> 'proposal.created'
           OR EXISTS (SELECT 1 FROM events c
                      WHERE c.agent = e.agent AND c.type = 'proposal.closed'
                        AND c.payload->>'proposalId' = e.payload->>'proposalId'
                        AND c.occurred_at < cutoff));
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM set_config('cenacle.purging_events', 'off', true);
  IF n > 0 THEN
    INSERT INTO events (agent, type, payload)
      VALUES ('cenacle', 'journal.purged', jsonb_build_object('count', n, 'before', cutoff));
  END IF;
  RETURN n;
END
$$;

REVOKE ALL ON purge_planchers FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_floor_holds(TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_proposals(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_events(TIMESTAMPTZ) FROM PUBLIC;
