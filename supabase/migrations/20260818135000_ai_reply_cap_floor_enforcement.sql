-- Keep every write path aligned with the runtime's practical reply-cap floor.
-- The public configuration endpoint historically accepted values as low as 1;
-- coercing them here prevents API clients or older UIs from reintroducing a
-- mid-conversation cap such as 3 or 10. Higher per-account choices are kept.

CREATE OR REPLACE FUNCTION wacrm.enforce_ai_reply_cap_floor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.auto_reply_max_per_conversation < 50 THEN
    NEW.auto_reply_max_per_conversation := 50;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_configs_reply_cap_floor ON wacrm.ai_configs;
CREATE TRIGGER ai_configs_reply_cap_floor
BEFORE INSERT OR UPDATE OF auto_reply_max_per_conversation
ON wacrm.ai_configs
FOR EACH ROW
EXECUTE FUNCTION wacrm.enforce_ai_reply_cap_floor();

ALTER TABLE wacrm.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;

ALTER TABLE wacrm.ai_configs
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation BETWEEN 50 AND 100);
