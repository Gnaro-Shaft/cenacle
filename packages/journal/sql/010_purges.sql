-- Phase 5, C1: purges that really erase, for the stores the application role
-- may not delete from (ADR-0009, charter rule 4).
-- The application role has no DELETE on proposals nor on events, and keeps
-- none: it may only call these two functions, which run as the owner, erase
-- what is older than the retention of cadre.toml, and say so in the journal
-- (how many, before when — never what).
-- Idempotent: the migration runs again at every `db:migrate`.

-- Closed proposals, a while after closing. Open ones are never touched.
CREATE OR REPLACE FUNCTION purge_proposals(cutoff TIMESTAMPTZ) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER;
BEGIN
  IF cutoff > clock_timestamp() THEN
    RAISE EXCEPTION 'purge_proposals: the cutoff cannot be in the future';
  END IF;
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

-- Journal events. The journal stays append-only for everyone, owner included,
-- except inside this function: it flags its own transaction, and the trigger
-- lets only that through. The application role cannot set the flag and
-- delete by itself: it has no DELETE privilege on events.
CREATE OR REPLACE FUNCTION purge_events(cutoff TIMESTAMPTZ) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER;
BEGIN
  IF cutoff > clock_timestamp() THEN
    RAISE EXCEPTION 'purge_events: the cutoff cannot be in the future';
  END IF;
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

CREATE OR REPLACE FUNCTION events_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('cenacle.purging_events', true) = 'on'
     AND current_user = (SELECT tableowner FROM pg_tables WHERE tablename = 'events') THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'events are append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

REVOKE ALL ON FUNCTION purge_proposals(TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION purge_events(TIMESTAMPTZ) FROM PUBLIC;
