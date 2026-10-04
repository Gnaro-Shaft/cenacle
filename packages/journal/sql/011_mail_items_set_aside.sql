-- Phase 5, C2: a mail kept from the model is "set aside" — by the article 9
-- floor, or because it is empty or unreadable. One mark for every reason, on
-- purpose: writing down WHY (health, opinions…) would itself record a special
-- category of data. A set-aside mail is in "À trier", for me to sort by hand.
-- Idempotent: the migration runs again at every `db:migrate`.

ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_decided_by_check;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_decided_by_check
  CHECK (decided_by IN ('rule', 'unreadable', 'model', 'set_aside'));

-- Set aside always means "À trier": nothing else is decided about it.
ALTER TABLE mail_items DROP CONSTRAINT IF EXISTS mail_items_set_aside_to_sort;
ALTER TABLE mail_items ADD CONSTRAINT mail_items_set_aside_to_sort
  CHECK (decided_by IS DISTINCT FROM 'set_aside' OR category = 'a_trier');
