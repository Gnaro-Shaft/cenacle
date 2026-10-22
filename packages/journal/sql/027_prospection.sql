-- The prospection agent (ADR-0032, 2026-10-22): one card per mission found in
-- a platform's alert, or typed by me. Closed fields only: never the mail's
-- text or subject, never a person's name or address, never a sender key.
-- Kept 60 days after the card's creation or my last move of it
-- (prospection_jours, cadre.toml), purged by the agent at each pass.
CREATE TABLE IF NOT EXISTS prospection_cartes (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source         TEXT NOT NULL CHECK (source IN ('mail', 'me')),
  platform       TEXT CHECK (length(platform) BETWEEN 1 AND 40),
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  company        TEXT CHECK (length(company) BETWEEN 1 AND 80),
  intermediary   TEXT NOT NULL CHECK (intermediary IN ('esn', 'direct', 'inconnu')),
  stack          TEXT[] NOT NULL CHECK (cardinality(stack) <= 10),
  rate_min       INTEGER CHECK (rate_min BETWEEN 1 AND 5000),
  rate_max       INTEGER CHECK (rate_max BETWEEN 1 AND 5000),
  remote         TEXT NOT NULL CHECK (remote IN ('total', 'partiel', 'aucun', 'inconnu')),
  place          TEXT CHECK (length(place) BETWEEN 1 AND 60),
  link           TEXT CHECK (link ~ '^https://[^\s"''<>]+$' AND length(link) <= 2000),
  note           TEXT CHECK (length(note) BETWEEN 1 AND 280),
  board_column   TEXT NOT NULL CHECK (board_column IN (
                   'detected', 'direct', 'profile', 'alert',
                   'contacted', 'applied', 'interview', 'won', 'lost', 'dismissed')),
  reason         TEXT CHECK (reason IN (
                   'esn_list', 'esn_phrase', 'esn_model', 'intermediary_unknown',
                   'stack', 'rate', 'remote')),
  decided_by     TEXT NOT NULL CHECK (decided_by IN ('rule', 'model', 'me')),
  to_check       BOOLEAN NOT NULL,
  duplicate_key  TEXT UNIQUE CHECK (length(duplicate_key) <= 400),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  moved_at       TIMESTAMPTZ,
  -- A rate is both bounds or neither, in order.
  CHECK ((rate_min IS NULL) = (rate_max IS NULL) AND (rate_min IS NULL OR rate_min <= rate_max)),
  -- A mail's card names its platform; a card I typed has none, and a note only it has.
  CHECK ((source = 'mail') = (platform IS NOT NULL)),
  CHECK (source = 'me' OR note IS NULL),
  -- The model never decides for a card I typed.
  CHECK (source = 'mail' OR decided_by <> 'model')
);
CREATE INDEX IF NOT EXISTS prospection_cartes_created_at ON prospection_cartes (created_at);

-- The alerts already read, by Iris's fixed id (ADR-0016): a moved mail is not
-- read again. Nothing else: no folder, no UID, no content. Erased with the
-- mail's memory (90 days, ADR-0012), in the same transaction.
CREATE TABLE IF NOT EXISTS prospection_mails_lus (
  mail_id   BIGINT PRIMARY KEY CHECK (mail_id > 0),
  outcome   TEXT NOT NULL CHECK (outcome IN (
              'read', 'floor', 'too_big', 'not_platform', 'unauthenticated',
              'unparsable', 'no_offer')),
  read_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION mail_items_drop_prospection_read() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.mailbox = 'inbox' AND OLD.uid_validity = '0' THEN
    DELETE FROM prospection_mails_lus WHERE mail_id = OLD.uid;
  END IF;
  RETURN OLD;
END
$$;

DROP TRIGGER IF EXISTS mail_items_drop_prospection_read ON mail_items;
CREATE TRIGGER mail_items_drop_prospection_read
  AFTER DELETE ON mail_items
  FOR EACH ROW EXECUTE FUNCTION mail_items_drop_prospection_read();
