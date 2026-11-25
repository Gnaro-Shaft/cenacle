-- A demand to the house drafted from a mail (ADR-0049, L3): the local model
-- drafts it from a mail I filed in the « travail » folder; it is born waiting,
-- like any demand, and leaves only once I accepted it on the page.
-- - `origine` admits `mail`, always with `mail_ref`, Iris's fixed id of the mail:
--   one mail, one draft at most, ever; the link never changes.
-- - `liaison_mails_lus`: the mails already read by the drafting program, and how.
-- - A mail Iris forgets (90 days, or a person's erasure) takes its drafts along:
--   those still open lapse, and the text of every closed one is wiped.
-- Idempotent: the migration runs again at every `db:migrate`.
ALTER TABLE liaison_demandes DROP CONSTRAINT IF EXISTS liaison_demandes_origine_check;
ALTER TABLE liaison_demandes DROP CONSTRAINT IF EXISTS liaison_demandes_origine;
ALTER TABLE liaison_demandes ADD CONSTRAINT liaison_demandes_origine
  CHECK (origine IN ('directe', 'mail'));
ALTER TABLE liaison_demandes ADD COLUMN IF NOT EXISTS mail_ref BIGINT;
ALTER TABLE liaison_demandes DROP CONSTRAINT IF EXISTS liaison_demandes_mail_ref;
ALTER TABLE liaison_demandes ADD CONSTRAINT liaison_demandes_mail_ref
  CHECK ((origine = 'mail') = (mail_ref IS NOT NULL) AND (mail_ref IS NULL OR mail_ref > 0));
CREATE UNIQUE INDEX IF NOT EXISTS liaison_demandes_un_brouillon_par_mail
  ON liaison_demandes (mail_ref) WHERE mail_ref IS NOT NULL;

-- The link to the mail never changes, whatever the state (038's cycle holds the rest).
CREATE OR REPLACE FUNCTION liaison_demandes_mail_fige() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mail_ref IS DISTINCT FROM OLD.mail_ref THEN
    RAISE EXCEPTION 'demand %: its mail never changes', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS liaison_demandes_mail_fige ON liaison_demandes;
CREATE TRIGGER liaison_demandes_mail_fige
  BEFORE UPDATE ON liaison_demandes
  FOR EACH ROW EXECUTE FUNCTION liaison_demandes_mail_fige();

CREATE TABLE IF NOT EXISTS liaison_mails_lus (
  mail_id  BIGINT PRIMARY KEY CHECK (mail_id > 0),
  -- brouillon, plancher, illisible, sortie, or a category of the filter.
  issue    TEXT NOT NULL CHECK (issue ~ '^[a-z_]{1,20}$'),
  lu_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION mail_items_drop_liaison() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.mailbox = 'inbox' AND OLD.uid_validity = '0' THEN
    DELETE FROM liaison_mails_lus WHERE mail_id = OLD.uid;
    UPDATE liaison_demandes
      SET statut = 'caduque', clos_le = clock_timestamp(),
          decide_le = coalesce(decide_le, clock_timestamp())
      WHERE mail_ref = OLD.uid AND statut IN ('attente', 'acceptee');
    UPDATE liaison_demandes SET titre = NULL, description = NULL
      WHERE mail_ref = OLD.uid AND clos_le IS NOT NULL AND titre IS NOT NULL;
  END IF;
  RETURN OLD;
END
$$;
DROP TRIGGER IF EXISTS mail_items_drop_liaison ON mail_items;
CREATE TRIGGER mail_items_drop_liaison
  AFTER DELETE ON mail_items
  FOR EACH ROW EXECUTE FUNCTION mail_items_drop_liaison();
