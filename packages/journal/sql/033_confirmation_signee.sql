-- My confirmation of an action on a server is signed by the bot (ADR-0036).
-- 1. The signature lives with what it confirms: an action of my button, or a
--    plan (whose steps it covers). The bot alone holds the private key; the
--    operator verifies before acting. A step of a plan carries none: it is
--    covered by its plan's.
-- 2. The database freezes what I was shown. A step is added only while its
--    plan is being proposed — never once I was asked to confirm, or the list
--    I read would not be the list I sign. A step never changes its plan,
--    rank, machine, action or condition. A removed step never comes back,
--    and nothing is removed once I confirmed.
-- The application role does not own the tables: it cannot drop this trigger.
-- No personal data: signatures over machine names, numbers and dates.
-- Idempotent: the migration runs again at every `db:migrate`.

ALTER TABLE serveur_actions ADD COLUMN IF NOT EXISTS confirm_sig TEXT;
ALTER TABLE serveur_actions DROP CONSTRAINT IF EXISTS serveur_actions_confirm_sig_form;
ALTER TABLE serveur_actions ADD CONSTRAINT serveur_actions_confirm_sig_form
  CHECK (confirm_sig ~ '^[A-Za-z0-9_-]{86}$') NOT VALID;

ALTER TABLE maintenance_plans ADD COLUMN IF NOT EXISTS confirm_sig TEXT;
ALTER TABLE maintenance_plans DROP CONSTRAINT IF EXISTS maintenance_plans_confirm_sig_form;
ALTER TABLE maintenance_plans ADD CONSTRAINT maintenance_plans_confirm_sig_form
  CHECK (confirm_sig ~ '^[A-Za-z0-9_-]{86}$') NOT VALID;

-- The plan is named with its schema, and pg_temp comes last in the search
-- path: a temporary table of the same name would otherwise be read first, and
-- answer "proposee" for a plan I confirmed.
CREATE OR REPLACE FUNCTION maintenance_etapes_frozen() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  plan_state TEXT;
BEGIN
  SELECT state INTO plan_state FROM public.maintenance_plans WHERE id = NEW.plan_id;
  IF TG_OP = 'INSERT' THEN
    IF plan_state IS DISTINCT FROM 'proposee' OR NEW.state <> 'attente' THEN
      RAISE EXCEPTION 'plan %: a step is added waiting, and only while its plan is proposed',
        NEW.plan_id USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id, NEW.plan_id, NEW.position, NEW.host, NEW.action, NEW.conditional)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.plan_id, OLD.position, OLD.host, OLD.action, OLD.conditional) THEN
    RAISE EXCEPTION 'step %: its plan, rank, machine, action and condition never change', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.state = 'retiree' AND NEW.state <> 'retiree' THEN
    RAISE EXCEPTION 'step %: a removed step never comes back', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.state = 'retiree' AND OLD.state <> 'retiree'
     AND plan_state IS DISTINCT FROM 'proposee' AND plan_state IS DISTINCT FROM 'a_confirmer' THEN
    RAISE EXCEPTION 'step %: nothing is removed from a plan once confirmed', OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS maintenance_etapes_frozen ON maintenance_etapes;
CREATE TRIGGER maintenance_etapes_frozen
  BEFORE INSERT OR UPDATE ON maintenance_etapes
  FOR EACH ROW EXECUTE FUNCTION maintenance_etapes_frozen();
