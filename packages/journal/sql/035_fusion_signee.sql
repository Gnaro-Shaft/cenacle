-- My ✅ Fusionner is signed by the bot (ADR-0036, second step).
-- merge_sig: the bot's Ed25519 signature over the finding, the pull
-- request's address, the commit I was shown and merge_confirmed_at. The
-- security agent verifies it before `gh pr merge`: a row written
-- "fusion_demandee" by any other program is never merged.
-- The first time only, the merge buttons already sent are withdrawn: they
-- carry no commit and no request of theirs was signed. Their findings go back
-- to "pr_ouverte"; the next round sends new buttons if the CI is still green.
-- No personal data: a signature over numbers, an address, a commit and a date.
-- Idempotent: the migration runs again at every `db:migrate`.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'securite_constats'
      AND column_name = 'merge_sig'
  ) THEN
    ALTER TABLE securite_constats ADD COLUMN merge_sig TEXT;
    UPDATE securite_constats SET action_state = 'pr_ouverte'
    WHERE action_state IN ('ci_verte', 'fusion_demandee');
  END IF;
END
$$;

ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS merge_confirmed_at TIMESTAMPTZ;
ALTER TABLE securite_constats DROP CONSTRAINT IF EXISTS securite_constats_merge_sig_form;
ALTER TABLE securite_constats ADD CONSTRAINT securite_constats_merge_sig_form
  CHECK (merge_sig ~ '^[A-Za-z0-9_-]{86}$') NOT VALID;
