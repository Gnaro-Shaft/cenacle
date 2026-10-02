-- What Iris remembers of each mail between two passes (phase 3, S1).
--
-- Pseudonymous on purpose (GDPR art. 4(5)): addresses and message identifiers
-- are stored only as HMAC keys (64 hex chars) under a secret kept in .env.
-- No subject, no body, no name, no address in clear. Rows older than the
-- retention period (90 days after arrival) are deleted by the application.

CREATE TABLE IF NOT EXISTS mail_items (
  mailbox        TEXT NOT NULL CHECK (mailbox IN ('inbox', 'sent')),
  uid_validity   TEXT NOT NULL CHECK (uid_validity ~ '^[0-9]{1,20}$'),
  uid            BIGINT NOT NULL CHECK (uid > 0),
  at             TIMESTAMPTZ NOT NULL,
  -- Inbox only: the category, and who decided it.
  category       TEXT CHECK (category IN ('clients_prospects', 'administratif', 'bruit', 'a_trier')),
  decided_by     TEXT CHECK (decided_by IN ('rule', 'unreadable', 'model')),
  -- Inbox only: the sender's domain is NOT kept; its key is.
  sender_key     TEXT CHECK (sender_key ~ '^[0-9a-f]{64}$'),
  -- Sent only: keys of every To/Cc address.
  recipient_keys TEXT[] NOT NULL DEFAULT '{}',
  message_key    TEXT CHECK (message_key ~ '^[0-9a-f]{64}$'),
  thread_keys    TEXT[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (mailbox, uid_validity, uid),
  CHECK ((category IS NULL) = (decided_by IS NULL)),
  CHECK (mailbox = 'inbox' OR (category IS NULL AND sender_key IS NULL)),
  CHECK (mailbox = 'sent' OR recipient_keys = '{}'),
  CHECK (cardinality(recipient_keys) <= 100 AND cardinality(thread_keys) <= 100)
);

CREATE INDEX IF NOT EXISTS mail_items_at ON mail_items (at);
