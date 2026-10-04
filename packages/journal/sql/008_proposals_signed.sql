-- Phase 4, B6 (ADR-0013): only the page can accept.
-- 1. The page signs my acceptance (Ed25519, key held by the page's server
--    alone); the executor verifies it before sending. The signature lives here.
-- 2. The database holds the life cycle itself, whatever role asks: a closed
--    proposal is final (only its text may be wiped after 7 days), the text and
--    the signature never change once decided, no state goes back.
-- The application role does not own the table: it cannot drop these triggers.
-- Idempotent: the migration runs again at every `db:migrate`.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS acceptance_sig TEXT;

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_acceptance_sig_form;
ALTER TABLE proposals ADD CONSTRAINT proposals_acceptance_sig_form
  CHECK (acceptance_sig ~ '^[A-Za-z0-9_-]{86}$');

-- Acceptances from before B6 carry no signature and can never be verified:
-- they are called off (lapsed). Must run before the constraint and the trigger.
UPDATE proposals SET status = 'lapsed', send_after = NULL, closed_at = clock_timestamp()
  WHERE status = 'accepted' AND acceptance_sig IS NULL;

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_signed_acceptance;
ALTER TABLE proposals ADD CONSTRAINT proposals_signed_acceptance
  CHECK ((status = 'pending' AND acceptance_sig IS NULL)
         OR (status = 'accepted' AND acceptance_sig IS NOT NULL)
         OR status NOT IN ('pending', 'accepted'));

CREATE OR REPLACE FUNCTION proposals_guard_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status NOT IN ('pending', 'skipped') OR NEW.acceptance_sig IS NOT NULL
     OR NEW.decided_at IS NOT NULL AND NEW.status = 'pending' THEN
    RAISE EXCEPTION 'a proposal is born pending (or skipped), never decided'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS proposals_born_pending ON proposals;
CREATE TRIGGER proposals_born_pending
  BEFORE INSERT ON proposals
  FOR EACH ROW EXECUTE FUNCTION proposals_guard_insert();

CREATE OR REPLACE FUNCTION proposals_guard_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  same_but_draft BOOLEAN :=
    ROW(NEW.id, NEW.created_at, NEW.mail_uid_validity, NEW.mail_uid, NEW.reason, NEW.trame,
        NEW.status, NEW.decided_at, NEW.send_after, NEW.closed_at, NEW.sent_at, NEW.acceptance_sig)
    IS NOT DISTINCT FROM
    ROW(OLD.id, OLD.created_at, OLD.mail_uid_validity, OLD.mail_uid, OLD.reason, OLD.trame,
        OLD.status, OLD.decided_at, OLD.send_after, OLD.closed_at, OLD.sent_at, OLD.acceptance_sig);
BEGIN
  -- A closed proposal is final: only its text may be wiped.
  IF OLD.status IN ('sent', 'failed', 'refused', 'lapsed', 'cancelled', 'skipped') THEN
    IF same_but_draft AND NEW.draft IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'proposal % is closed (%): it cannot change', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Within a state, only my edit of a pending text.
  IF NEW.status = OLD.status THEN
    IF OLD.status = 'pending' AND same_but_draft THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'proposal % (%): nothing may change but a pending text', OLD.id, OLD.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Forward only.
  IF (OLD.status, NEW.status) NOT IN (
       ('pending', 'accepted'), ('pending', 'refused'), ('pending', 'lapsed'),
       ('accepted', 'cancelled'), ('accepted', 'lapsed'), ('accepted', 'sending'),
       ('accepted', 'failed'), -- B7: an unsigned acceptance, refused by the executor
       ('sending', 'sent'), ('sending', 'failed')) THEN
    RAISE EXCEPTION 'proposal %: % -> % refused', OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- What the signature covers never changes once decided; who it is for never changes.
  IF NEW.draft IS DISTINCT FROM OLD.draft
     OR (OLD.decided_at IS NOT NULL AND NEW.decided_at IS DISTINCT FROM OLD.decided_at)
     OR (OLD.acceptance_sig IS NOT NULL AND NEW.acceptance_sig IS DISTINCT FROM OLD.acceptance_sig)
     OR ROW(NEW.id, NEW.created_at, NEW.mail_uid_validity, NEW.mail_uid, NEW.reason, NEW.trame)
        IS DISTINCT FROM
        ROW(OLD.id, OLD.created_at, OLD.mail_uid_validity, OLD.mail_uid, OLD.reason, OLD.trame) THEN
    RAISE EXCEPTION 'proposal %: its text, decision or signature cannot change', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The undo delay is the database's too.
  IF NEW.status = 'accepted'
     AND (NEW.send_after IS NULL OR NEW.send_after < NEW.decided_at + INTERVAL '2 minutes') THEN
    RAISE EXCEPTION 'proposal %: the undo delay is 2 minutes', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS proposals_life_cycle ON proposals;
CREATE TRIGGER proposals_life_cycle
  BEFORE UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION proposals_guard_update();
