-- J6c (ADR-0025): a fix the security agent prepares when I ask (🔧). Only
-- for kinds of findings the closed catalogue can fix without privilege (a
-- dependency with a published fix): a branch, a pull request, the CI — never
-- a merge, never main. These columns follow the action; no personal data.
ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS action_state TEXT
  CHECK (action_state IN ('demandee', 'pr_ouverte', 'ci_echouee', 'abandonnee', 'echouee'));
ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS action_requested_at TIMESTAMPTZ;
ALTER TABLE securite_constats ADD COLUMN IF NOT EXISTS action_pr_url TEXT
  CHECK (action_pr_url ~ '^https://github\.com/[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}/pull/[0-9]{1,7}$');
