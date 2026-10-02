-- Phase 3, S2: a mail whose sender's domain never expects a reply by mail
-- (platform notifications, regles [sans_suivi]) is never followed up.
-- Decided at collection time, when the domain is known — the domain itself
-- is still not stored.
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS no_follow_up BOOLEAN NOT NULL DEFAULT false;
