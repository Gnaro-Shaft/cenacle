-- J6f2 (ADR-0027): rebooting a machine joins the closed catalogue. A done
-- reboot is proven by Legion's verdict — the machine back, no reboot
-- required any more (disparu) — or, 30 minutes on without that, said loud:
--   pas_revenue   the machine was not seen back 30 minutes after the reboot.
-- NOT VALID: the next migration widens this list again; a replay of this file
-- must not reject the rows that list allows. New writes are checked all the same.
ALTER TABLE serveur_actions DROP CONSTRAINT IF EXISTS serveur_actions_action_check;
ALTER TABLE serveur_actions ADD CONSTRAINT serveur_actions_action_check
  CHECK (action IN ('services', 'redemarrer')) NOT VALID;
ALTER TABLE serveur_actions DROP CONSTRAINT IF EXISTS serveur_actions_verified_check;
ALTER TABLE serveur_actions ADD CONSTRAINT serveur_actions_verified_check
  CHECK (verified IN ('disparu', 'toujours_la', 'pas_revenue')) NOT VALID;
