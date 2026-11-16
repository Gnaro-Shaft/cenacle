-- The reminders (ADR-0041, T-10): text I typed on Telegram, the instant it is
-- due, the instant I set it, the instant it rang — nothing else: no sender, no
-- address, no attachment. The bot rings it, then marks it rung (ring, then
-- confirm: at worst twice, never lost). Erased for real: a cancelled reminder
-- at once, a rung one `rappels_jours` (cadre.toml) after it rang; one not yet
-- rung is never purged — it is still due. The application role may read, add,
-- erase, and set the instant it rang, nothing else (migrate.ts).
-- Idempotent: the migration runs again at every `db:migrate`.
CREATE TABLE IF NOT EXISTS rappels (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- One line of 1 to 300 characters, no control character (a line break included).
  texte     TEXT NOT NULL CHECK (length(texte) BETWEEN 1 AND 300 AND texte !~ '[[:cntrl:]]'),
  echeance  TIMESTAMPTZ NOT NULL,
  pose_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
  sonne_le  TIMESTAMPTZ,
  -- It rings when due or later, never before it was set.
  CHECK (sonne_le IS NULL OR sonne_le >= pose_le)
);
-- What is still due, by its instant: the bot's relève every minute.
CREATE INDEX IF NOT EXISTS rappels_dus ON rappels (echeance) WHERE sonne_le IS NULL;
-- What rang, by when: the purge.
CREATE INDEX IF NOT EXISTS rappels_sonnes ON rappels (sonne_le) WHERE sonne_le IS NOT NULL;
