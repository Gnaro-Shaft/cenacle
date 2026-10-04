-- Phase 4, B7 (ADR-0013, complement): only the executor sends.
-- Claiming a proposal (sending) and closing a sending (sent, failed) are
-- refused to every role but cenacle_executor, whose password only the
-- executor holds. No other program can then mark a proposal "sent" when
-- nothing left, nor use up the daily ceiling with claims.
-- An acceptance without a valid signature is refused by the executor BEFORE
-- any claim: failed, without a sending time, so it does not count against
-- the ceiling. Idempotent: the migration runs again at every `db:migrate`.

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_sent_at;
ALTER TABLE proposals ADD CONSTRAINT proposals_sent_at
  CHECK ((status IN ('sending', 'sent') AND sent_at IS NOT NULL)
         OR status = 'failed'
         OR (status NOT IN ('sending', 'sent', 'failed') AND sent_at IS NULL));

CREATE OR REPLACE FUNCTION proposals_executor_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('sending', 'sent', 'failed')
     AND current_user <> 'cenacle_executor' THEN
    RAISE EXCEPTION 'proposal %: only the executor may move it to %', OLD.id, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS proposals_executor_only ON proposals;
CREATE TRIGGER proposals_executor_only
  BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION proposals_executor_only();
