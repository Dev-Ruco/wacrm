-- Align persisted AI reply limits with the modern multi-turn agent runtime.
-- Legacy values such as 3 or 10 can interrupt a healthy sales/service journey
-- even though the agent is still making progress. Keep the existing bounded
-- 1..100 safety constraint, but use 50 as the practical floor/default.

ALTER TABLE wacrm.ai_configs
  ALTER COLUMN auto_reply_max_per_conversation SET DEFAULT 50;

UPDATE wacrm.ai_configs
SET auto_reply_max_per_conversation = 50
WHERE auto_reply_max_per_conversation < 50;
