-- Phase 3, S4: urgency (ADR-0007). Whether an urgency term was in the
-- subject — decided at collection time; the subject itself is never stored —
-- and whether I was already told about it (alert or recap).
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS urgent_term BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE mail_items ADD COLUMN IF NOT EXISTS urgent_notified BOOLEAN NOT NULL DEFAULT false;
