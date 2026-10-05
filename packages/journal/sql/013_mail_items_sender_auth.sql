-- Phase 5, before M3 (ADR-0014): was the sender authenticated by our own
-- receiving server? A yes/no about the mail, kept and purged with its row.
-- False by default — the protective side: a mail remembered before this
-- migration is no longer followed up nor alerted on as a client's.
-- Idempotent: the migration runs again at every `db:migrate`.

ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS sender_authenticated BOOLEAN NOT NULL DEFAULT false;

-- "unauthenticated": a client rule refused for an unauthenticated sender.
ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_decided_by_check;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_decided_by_check
  CHECK (decided_by IN ('rule', 'unreadable', 'model', 'set_aside', 'unauthenticated'));

-- Refused means "À trier": nothing else is decided about it.
ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_unauthenticated_to_sort;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_unauthenticated_to_sort
  CHECK (decided_by IS DISTINCT FROM 'unauthenticated' OR category = 'a_trier');
