-- Proposals (phase 4, B1 — ADR-0004): Iris proposes, I decide, an executor
-- without AI acts. The table enforces the life cycle itself:
--   pending → accepted → sent | cancelled (within the undo delay) | lapsed
--   pending → refused | lapsed
-- One situation = one proposal, ever: a refused proposal never comes back for
-- the same mail. The recipient is NOT stored: the executor reads it again from
-- the mail on the server when it sends (the sender of the thread, imposed).
-- The draft is content: it is wiped 7 days after the proposal is closed.

CREATE TABLE IF NOT EXISTS proposals (
  id               TEXT PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  mail_uid_validity TEXT NOT NULL CHECK (mail_uid_validity ~ '^[0-9]{1,20}$'),
  mail_uid         BIGINT NOT NULL CHECK (mail_uid > 0),
  reason           TEXT NOT NULL CHECK (reason IN ('follow_up_due')),
  trame            TEXT CHECK (trame ~ '^[a-z][a-z0-9_]{1,40}$'),
  draft            TEXT CHECK (char_length(draft) BETWEEN 1 AND 5000),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'accepted', 'refused', 'lapsed', 'cancelled', 'sent')),
  decided_at       TIMESTAMPTZ,
  send_after       TIMESTAMPTZ,
  closed_at        TIMESTAMPTZ,
  UNIQUE (mail_uid_validity, mail_uid),
  -- A draft still holding a slot left for me ({delai ?}) can never be accepted.
  CHECK (status NOT IN ('accepted', 'sent') OR draft !~ '\{[a-z_]+ \?\}'),
  CHECK ((status = 'accepted') = (send_after IS NOT NULL AND closed_at IS NULL)),
  CHECK ((status = 'pending') = (decided_at IS NULL)),
  CHECK (status IN ('pending', 'accepted') OR closed_at IS NOT NULL),
  CHECK (draft IS NOT NULL OR closed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS proposals_status ON proposals (status);
