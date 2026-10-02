-- The event log (ADR-0008). Append-only: the database itself refuses
-- UPDATE, DELETE and TRUNCATE, whoever asks. The application role can
-- only INSERT and SELECT; it does not own the table, so it cannot
-- disable these triggers either.

CREATE TABLE IF NOT EXISTS events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  agent       TEXT NOT NULL CHECK (agent ~ '^[a-z][a-z0-9_-]{0,31}$'),
  type        TEXT NOT NULL CHECK (type ~ '^[a-z][a-z0-9_.]{0,63}$'),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb
              CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS events_agent_id ON events (agent, id);

CREATE OR REPLACE FUNCTION events_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only: % refused', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

DROP TRIGGER IF EXISTS events_no_update_delete ON events;
CREATE TRIGGER events_no_update_delete
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION events_refuse_change();

DROP TRIGGER IF EXISTS events_no_truncate ON events;
CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events
  FOR EACH STATEMENT EXECUTE FUNCTION events_refuse_change();
