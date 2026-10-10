-- The opposition list gets a retention (decided on 2026-10-10): a key is
-- purged `opposition_jours` after the person's last trace — the later of their
-- request (`since`) and the date of the last mail from or to them that the
-- collection met and ignored (`last_seen`). As long as their mails may still
-- be in my mailbox (three years), the list keeps them unread.
ALTER TABLE opposed_keys ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ;
