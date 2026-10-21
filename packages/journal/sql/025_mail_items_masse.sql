-- Mass mail (ADR-0029, 2026-10-21): a mail sent in bulk, by its own headers
-- (List-Unsubscribe, List-Id, Precedence), goes to "bruit" before any domain
-- rule but a client one. Its cause is kept, never the headers.
-- NOT VALID: every migration is replayed at each run; a list a later migration
-- widens must not reject, on replay, the rows that later list allows (011 and
-- 013 are NOT VALID for the same reason). New writes are checked all the same.
ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_decided_by_check;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_decided_by_check
  CHECK (decided_by IN ('rule', 'unreadable', 'model', 'set_aside', 'unauthenticated', 'masse')) NOT VALID;
-- A mass mail is noise, and only noise.
ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_masse_is_bruit;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_masse_is_bruit
  CHECK (decided_by IS DISTINCT FROM 'masse' OR category = 'bruit');
