-- J6f3 (ADR-0027): the security updates join the closed catalogue — started
-- in the background on the server, never a reboot; proven by Legion's verdict.
ALTER TABLE serveur_actions DROP CONSTRAINT IF EXISTS serveur_actions_action_check;
ALTER TABLE serveur_actions ADD CONSTRAINT serveur_actions_action_check
  CHECK (action IN ('services', 'redemarrer', 'maj_securite'));
