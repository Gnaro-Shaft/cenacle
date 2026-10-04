-- Phase 4, B4: the executor. Two new states:
--   accepted → sending (claimed by the executor, atomically) → sent | failed
-- "sending" is taken BEFORE talking to the mail server, so two executors, or
-- one restarted, never send the same mail twice: a row left in "sending"
-- (crash in the middle) is never retried by itself — at most once, never
-- twice. "failed" is closed and shown to me; nothing retries it.
-- Idempotent: the migration runs again at every `db:migrate`.

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending', 'accepted', 'sending', 'sent', 'failed',
                    'refused', 'lapsed', 'cancelled', 'skipped'));

-- No slot left for me, ever, from acceptance to sending (replaces proposals_check).
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_check;
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_no_slot_left;
ALTER TABLE proposals ADD CONSTRAINT proposals_no_slot_left
  CHECK (status NOT IN ('accepted', 'sending', 'sent') OR draft !~ '\{[a-z_]+ \?\}');

-- Open states are pending, accepted and sending; every other one is closed (replaces proposals_check3).
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_check3;
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_closed_states;
ALTER TABLE proposals ADD CONSTRAINT proposals_closed_states
  CHECK ((status IN ('pending', 'accepted', 'sending')) = (closed_at IS NULL));

-- A mail being sent has its text and was decided by me.
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_sending_ready;
ALTER TABLE proposals ADD CONSTRAINT proposals_sending_ready
  CHECK (status <> 'sending' OR (draft IS NOT NULL AND decided_at IS NOT NULL));

-- When the executor claimed it: the daily limit counts attempts, sent or not.
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
-- (The final rule, B7's included: every migration runs again at each
-- db:migrate, and this one must not refuse rows written by later ones — a
-- failed proposal refused as unsigned has no sending time. See 009.)
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_sent_at;
ALTER TABLE proposals ADD CONSTRAINT proposals_sent_at
  CHECK ((status IN ('sending', 'sent') AND sent_at IS NOT NULL)
         OR status = 'failed'
         OR (status NOT IN ('sending', 'sent', 'failed') AND sent_at IS NULL));
CREATE INDEX IF NOT EXISTS proposals_sent_at ON proposals (sent_at);
