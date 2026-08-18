-- Align persisted AI reply limits with the modern multi-turn agent runtime.
-- Legacy installations may still have either of two historical CHECK
-- constraint names. Remove both before changing rows so values such as 50
-- are not rejected by an older 1..20/1..10 constraint.

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
