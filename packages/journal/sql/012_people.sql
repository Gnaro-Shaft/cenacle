-- Phase 5, C3: the rights of the people Iris reads about (GDPR art. 15 to 21).
--
-- opposed_keys: the HMAC key of each address whose owner asked to be erased
-- or objected. The collection ignores their mails from then on — without it,
-- an erasure would not hold: their mails stay in my mailbox and would be read
-- again at the next renumbering. Only the key: no address, no date of mail.
-- Kept until the person withdraws their objection, or `opposition_jours`
-- after their last trace (015_opposition_trace.sql).
CREATE TABLE IF NOT EXISTS opposed_keys (
  key   TEXT PRIMARY KEY CHECK (key ~ '^[0-9a-f]{64}$'),
  since TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- Erasing a person's proposals. The application role may not delete
-- proposals: it calls this function, which runs as the owner. Pending and
-- accepted ones go too (they will never be sent); a sending in progress makes
-- it refuse, to be tried again a minute later.
CREATE OR REPLACE FUNCTION erase_proposals_for(validity TEXT, uids BIGINT[]) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM proposals
             WHERE mail_uid_validity = validity AND mail_uid = ANY (uids) AND status = 'sending') THEN
    RAISE EXCEPTION 'erase_proposals_for: a reply is being sent, try again in a minute';
  END IF;
  DELETE FROM proposals WHERE mail_uid_validity = validity AND mail_uid = ANY (uids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;

REVOKE ALL ON FUNCTION erase_proposals_for(TEXT, BIGINT[]) FROM PUBLIC;
