-- The liaison with the house (ADR-0048, T-12): work I type, accept on the page,
-- and a program without AI hands over to the house's VM by a forced ssh command.
-- The table holds the life cycle itself, whatever role asks (the ADR-0013 way):
--   attente → acceptee → en_cours → transmise | echouee
--   attente → refusee | caduque ; acceptee → annulee (within the undo delay)
--   acceptee → caduque (not handed over within 24 h) | echouee (unsigned, before any claim)
-- A closed demand is final: only its text may be wiped (liaison_texte_jours).
-- The text never changes once decided, and the page's signature covers it.
-- Idempotent: the migration runs again at every `db:migrate`.
CREATE TABLE IF NOT EXISTS liaison_demandes (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cree_le      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- `mail` comes with L3, by a migration of its own: refused until then.
  origine      TEXT NOT NULL CHECK (origine IN ('directe')),
  dossier      TEXT NOT NULL CHECK (dossier ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  -- One line of 1 to 120 characters; 1 to 4000 with line breaks and tabs only.
  titre        TEXT CHECK (char_length(titre) BETWEEN 1 AND 120 AND titre !~ '[[:cntrl:]]'),
  description  TEXT CHECK (char_length(description) BETWEEN 1 AND 4000
                           AND description !~ '[\x01-\x08\x0b-\x1f\x7f]'),
  statut       TEXT NOT NULL DEFAULT 'attente' CHECK (statut IN (
                 'attente', 'acceptee', 'refusee', 'annulee', 'caduque',
                 'en_cours', 'transmise', 'echouee')),
  decide_le    TIMESTAMPTZ,
  partir_apres TIMESTAMPTZ,
  pris_le      TIMESTAMPTZ,
  clos_le      TIMESTAMPTZ,
  signature    TEXT CHECK (signature ~ '^[A-Za-z0-9_-]{86}$'),
  ticket       TEXT CHECK (ticket ~ '^[A-Z][A-Z0-9]{0,9}-[0-9]{1,9}$'),
  categorie    TEXT CHECK (categorie ~ '^[a-z_]{1,20}$'),
  CHECK ((titre IS NULL) = (description IS NULL)),
  CHECK (titre IS NOT NULL OR clos_le IS NOT NULL),
  CHECK ((statut = 'attente') = (decide_le IS NULL)),
  CHECK (statut <> 'attente' OR signature IS NULL),
  CHECK (statut NOT IN ('acceptee', 'en_cours', 'transmise') OR signature IS NOT NULL),
  CHECK (statut <> 'acceptee' OR (partir_apres IS NOT NULL AND pris_le IS NULL)),
  CHECK ((statut IN ('attente', 'acceptee', 'en_cours')) = (clos_le IS NULL)),
  CHECK (statut NOT IN ('en_cours', 'transmise') OR pris_le IS NOT NULL),
  CHECK ((statut = 'transmise') = (ticket IS NOT NULL)),
  CHECK ((statut = 'echouee') = (categorie IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS liaison_demandes_ouvertes
  ON liaison_demandes (statut) WHERE clos_le IS NULL;
CREATE INDEX IF NOT EXISTS liaison_demandes_prises
  ON liaison_demandes (pris_le) WHERE pris_le IS NOT NULL;

-- Born waiting, with its text, never decided, never taken, never closed.
CREATE OR REPLACE FUNCTION liaison_demandes_naissance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.statut <> 'attente' OR NEW.decide_le IS NOT NULL OR NEW.signature IS NOT NULL
     OR NEW.partir_apres IS NOT NULL OR NEW.pris_le IS NOT NULL OR NEW.clos_le IS NOT NULL
     OR NEW.ticket IS NOT NULL OR NEW.categorie IS NOT NULL OR NEW.titre IS NULL THEN
    RAISE EXCEPTION 'a demand is born waiting, with its text, never decided'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS liaison_demandes_naissance ON liaison_demandes;
CREATE TRIGGER liaison_demandes_naissance
  BEFORE INSERT ON liaison_demandes
  FOR EACH ROW EXECUTE FUNCTION liaison_demandes_naissance();

CREATE OR REPLACE FUNCTION liaison_demandes_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  meme_sauf_texte BOOLEAN :=
    ROW(NEW.id, NEW.cree_le, NEW.origine, NEW.dossier, NEW.statut, NEW.decide_le,
        NEW.partir_apres, NEW.pris_le, NEW.clos_le, NEW.signature, NEW.ticket, NEW.categorie)
    IS NOT DISTINCT FROM
    ROW(OLD.id, OLD.cree_le, OLD.origine, OLD.dossier, OLD.statut, OLD.decide_le,
        OLD.partir_apres, OLD.pris_le, OLD.clos_le, OLD.signature, OLD.ticket, OLD.categorie);
  prises INTEGER;
BEGIN
  -- Closed is final: only the text may be wiped, both fields at once.
  IF OLD.statut IN ('transmise', 'echouee', 'refusee', 'annulee', 'caduque') THEN
    IF meme_sauf_texte AND NEW.titre IS NULL AND NEW.description IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'demand % is closed (%): it cannot change', OLD.id, OLD.statut
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Within a state: only my edit of a waiting text (and its folder).
  IF NEW.statut = OLD.statut THEN
    IF OLD.statut = 'attente'
       AND ROW(NEW.id, NEW.cree_le, NEW.origine, NEW.decide_le, NEW.partir_apres, NEW.pris_le,
               NEW.clos_le, NEW.signature, NEW.ticket, NEW.categorie)
           IS NOT DISTINCT FROM
           ROW(OLD.id, OLD.cree_le, OLD.origine, OLD.decide_le, OLD.partir_apres, OLD.pris_le,
               OLD.clos_le, OLD.signature, OLD.ticket, OLD.categorie)
       AND NEW.titre IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'demand % (%): nothing may change but a waiting text', OLD.id, OLD.statut
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Forward only.
  IF (OLD.statut, NEW.statut) NOT IN (
       ('attente', 'acceptee'), ('attente', 'refusee'), ('attente', 'caduque'),
       ('acceptee', 'annulee'), ('acceptee', 'caduque'), ('acceptee', 'en_cours'),
       ('acceptee', 'echouee'), ('en_cours', 'transmise'), ('en_cours', 'echouee')) THEN
    RAISE EXCEPTION 'demand %: % -> % refused', OLD.id, OLD.statut, NEW.statut
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- What the signature covers, and who the demand is, never change once decided.
  IF ROW(NEW.id, NEW.cree_le, NEW.origine, NEW.dossier, NEW.titre, NEW.description)
     IS DISTINCT FROM ROW(OLD.id, OLD.cree_le, OLD.origine, OLD.dossier, OLD.titre, OLD.description)
     OR (OLD.decide_le IS NOT NULL AND NEW.decide_le IS DISTINCT FROM OLD.decide_le)
     OR (OLD.signature IS NOT NULL AND NEW.signature IS DISTINCT FROM OLD.signature)
     OR (OLD.partir_apres IS NOT NULL AND NEW.partir_apres IS DISTINCT FROM OLD.partir_apres)
     OR (OLD.pris_le IS NOT NULL AND NEW.pris_le IS DISTINCT FROM OLD.pris_le) THEN
    RAISE EXCEPTION 'demand %: its text, decision or signature cannot change', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- The undo delay is the database's too: 2 minutes at least, cancelled only within it.
  IF NEW.statut = 'acceptee'
     AND (NEW.partir_apres IS NULL OR NEW.partir_apres < NEW.decide_le + INTERVAL '2 minutes') THEN
    RAISE EXCEPTION 'demand %: the undo delay is 2 minutes', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.statut = 'annulee' AND clock_timestamp() >= OLD.partir_apres THEN
    RAISE EXCEPTION 'demand %: the undo delay is over', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Refused before being taken: no claim is invented.
  IF NEW.statut = 'echouee' AND OLD.statut = 'acceptee' AND NEW.pris_le IS NOT NULL THEN
    RAISE EXCEPTION 'demand %: refused before being taken, it has no claim', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Taken: after the delay, within 24 hours of my decision, at most 10 in 24 hours.
  IF NEW.statut = 'en_cours' THEN
    IF clock_timestamp() < OLD.partir_apres
       OR OLD.decide_le < clock_timestamp() - INTERVAL '24 hours'
       OR NEW.pris_le IS NULL OR NEW.pris_le > clock_timestamp() + INTERVAL '5 minutes' THEN
      RAISE EXCEPTION 'demand %: not to be taken now', OLD.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- One claim at a time, so that the ceiling is counted right.
    PERFORM pg_advisory_xact_lock(hashtext('liaison_demandes.plafond'));
    SELECT count(*) INTO prises FROM liaison_demandes
      WHERE pris_le > clock_timestamp() - INTERVAL '24 hours';
    IF prises >= 10 THEN
      RAISE EXCEPTION 'liaison ceiling: 10 demands handed over in 24 hours'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS liaison_demandes_cycle ON liaison_demandes;
CREATE TRIGGER liaison_demandes_cycle
  BEFORE UPDATE ON liaison_demandes
  FOR EACH ROW EXECUTE FUNCTION liaison_demandes_cycle();

-- Erased for real, but only once closed: an open demand is never deleted.
CREATE OR REPLACE FUNCTION liaison_demandes_effacement() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.clos_le IS NULL THEN
    RAISE EXCEPTION 'demand % is open (%): it is not erased', OLD.id, OLD.statut
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END
$$;
DROP TRIGGER IF EXISTS liaison_demandes_effacement ON liaison_demandes;
CREATE TRIGGER liaison_demandes_effacement
  BEFORE DELETE ON liaison_demandes
  FOR EACH ROW EXECUTE FUNCTION liaison_demandes_effacement();

-- What the house said of my demands at the last reading of `etat` — one row per
-- ticket, replaced at each reading, erased when the house stops reporting it.
-- Titles are written by the house's model: data, never instructions.
CREATE TABLE IF NOT EXISTS liaison_etats (
  ticket       TEXT PRIMARY KEY CHECK (ticket ~ '^[A-Z][A-Z0-9]{0,9}-[0-9]{1,9}$'),
  statut       TEXT NOT NULL CHECK (statut ~ '^[a-z_]{1,20}$'),
  titre        TEXT NOT NULL CHECK (char_length(titre) <= 120 AND titre !~ '[[:cntrl:]]'),
  cree         TIMESTAMPTZ NOT NULL,
  sous_tickets JSONB NOT NULL CHECK (jsonb_typeof(sous_tickets) = 'array'
                                     AND jsonb_array_length(sous_tickets) <= 50),
  pr           TEXT[] NOT NULL CHECK (cardinality(pr) <= 20),
  -- The pull requests already announced on Telegram: each one once.
  pr_signalees TEXT[] NOT NULL DEFAULT '{}' CHECK (cardinality(pr_signalees) <= 40),
  lu_le        TIMESTAMPTZ NOT NULL
);
