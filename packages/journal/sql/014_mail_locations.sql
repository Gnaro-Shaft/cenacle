-- Phase 5, after M2 (ADR-0016): Iris reads every folder of the box, not only
-- the inbox — I file my mails as soon as they arrive, and a mail that left the
-- inbox used to be forgotten.
--
-- A received mail has an id of Iris's own (mail_items.uid of the 'inbox' rows,
-- under the virtual UIDVALIDITY '0'): it does not change when I move the mail.
-- Where it is on the server (folder, UIDVALIDITY, UID) lives here, and changes
-- when the mail moves. Folder names are never stored: only their HMAC key
-- (they may name clients). Idempotent: run again at every `db:migrate`.

-- How far each folder has been read: past every mail looked at, kept or not
-- (a mail older than the notice is read once, never again).
CREATE TABLE IF NOT EXISTS mail_folders (
  folder_key   TEXT PRIMARY KEY CHECK (folder_key ~ '^[0-9a-f]{64}$'),
  uid_validity TEXT NOT NULL CHECK (uid_validity ~ '^[0-9]{1,20}$'),
  last_uid     BIGINT NOT NULL CHECK (last_uid >= 0)
);

-- Where each remembered mail is now. The id is never reused, even after a
-- purge: a stale proposal can never point at another mail.
CREATE TABLE IF NOT EXISTS mail_locations (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  folder_key   TEXT NOT NULL CHECK (folder_key ~ '^[0-9a-f]{64}$'),
  uid_validity TEXT NOT NULL CHECK (uid_validity ~ '^[0-9]{1,20}$'),
  uid          BIGINT NOT NULL CHECK (uid > 0),
  message_key  TEXT CHECK (message_key ~ '^[0-9a-f]{64}$'),
  UNIQUE (folder_key, uid_validity, uid)
);

CREATE INDEX IF NOT EXISTS mail_locations_message_key ON mail_locations (message_key);

-- A remembered mail that is erased (retention, a person's erasure, gone from
-- the server) loses its location in the same transaction: nothing of it is
-- left behind, not even a key.
CREATE OR REPLACE FUNCTION mail_items_drop_location() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.mailbox = 'inbox' AND OLD.uid_validity = '0' THEN
    DELETE FROM mail_locations WHERE id = OLD.uid;
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS mail_items_drop_location ON mail_items;
CREATE TRIGGER mail_items_drop_location
  AFTER DELETE ON mail_items
  FOR EACH ROW EXECUTE FUNCTION mail_items_drop_location();
