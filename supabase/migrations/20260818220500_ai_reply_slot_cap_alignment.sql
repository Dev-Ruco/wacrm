-- Keep the atomic reply-slot guard aligned with ai_configs.
-- The account-level setting now allows values up to 100, so the RPC
-- that atomically increments conversations.ai_reply_count must accept
-- the same range. This migration is intentionally idempotent.

CREATE OR REPLACE FUNCTION wacrm.claim_ai_reply_slot(
  conversation_id uuid,
  max_replies integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = wacrm, public
AS $$
DECLARE
  claimed boolean;
BEGIN
  IF max_replies IS NULL OR max_replies < 1 OR max_replies > 100 THEN
    RAISE EXCEPTION 'max_replies must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;

  WITH updated AS (
    UPDATE wacrm.conversations
    SET ai_reply_count = ai_reply_count + 1
    WHERE id = conversation_id
      AND ai_reply_count < max_replies
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM updated) INTO claimed;

  RETURN claimed;
END;
$$;

REVOKE ALL ON FUNCTION wacrm.claim_ai_reply_slot(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wacrm.claim_ai_reply_slot(uuid, integer) TO service_role;
