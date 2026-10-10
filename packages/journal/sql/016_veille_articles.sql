-- The CTO's veille archive (J5, ADR-0024): each article that was really sent
-- to me, as I received it — to never send it twice, and to reuse it later
-- (npm run veille:archive). Public articles and the names of my own projects:
-- no personal data. The score, summary and idea are AI-generated. Purged
-- `veille_jours` (veille.toml) after sending, by the veille itself.
CREATE TABLE IF NOT EXISTS veille_articles (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- Normalized (no fragment, no tracking parameters): one article, one row.
  link         TEXT NOT NULL UNIQUE CHECK (length(link) BETWEEN 8 AND 2048),
  source       TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 60),
  theme        TEXT NOT NULL CHECK (theme IN ('actualite', 'version')),
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  published_at TIMESTAMPTZ NOT NULL,
  score        SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 10),
  resume       TEXT CHECK (length(resume) <= 400),
  project      TEXT CHECK (length(project) <= 40),
  idea         TEXT CHECK (length(idea) <= 250)
);
CREATE INDEX IF NOT EXISTS veille_articles_sent_at ON veille_articles (sent_at);
