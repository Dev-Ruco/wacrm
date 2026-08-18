-- Keep every write path aligned with the runtime's practical reply-cap floor.
-- This migration is intentionally repair-safe: it removes both historical
-- CHECK constraint names, normalises any pre-existing out-of-range rows, then
-- installs the trigger and one canonical 50..100 constraint.

ALTER TABLE wacrm.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_check;

ALTER TABLE wacrm.ai_configs
  DROP CONSTRAINT IF EXISTS ai_configs_auto_reply_max_per_conversation_check;

ALTER TABLE wacrm.ai_configs
  ALTER COLUMN auto_reply_max_per_conversation SET DEFAULT 50;

UPDATE wacrm.ai_configs
SET auto_reply_max_per_conversation = LEAST(
  100,
  GREATEST(50, auto_reply_max_per_conversation)
);

CREATE OR REPLACE FUNCTION wacrm.enforce_ai_reply_cap_floor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.auto_reply_max_per_conversation := LEAST(
    100,
    GREATEST(50, NEW.auto_reply_max_per_conversation)
  );
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
  ADD CONSTRAINT ai_configs_auto_reply_max_per_conversation_check
  CHECK (auto_reply_max_per_conversation BETWEEN 50 AND 100);
