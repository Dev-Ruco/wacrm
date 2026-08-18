-- Adaptive AI message buffering.
--
-- buffer_window_seconds remains the account-configured maximum grouping
-- window. The runtime normally responds after a short quiet period, but a
-- burst start timestamp prevents continuously fragmented messages from
-- postponing the agent indefinitely.

ALTER TABLE wacrm.conversations
  ADD COLUMN IF NOT EXISTS ai_dispatch_burst_started_at timestamptz;

COMMENT ON COLUMN wacrm.ai_configs.buffer_window_seconds IS
  'Maximum time to group a burst of inbound fragments before AI auto-reply runs.';

COMMENT ON COLUMN wacrm.conversations.ai_dispatch_burst_started_at IS
  'Start of the current unclaimed inbound burst; preserved while new fragments arrive and cleared on claim.';

CREATE OR REPLACE FUNCTION wacrm.schedule_ai_dispatch(
  p_account_id uuid,
  p_conversation_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE wacrm.conversations
  SET ai_dispatch_generation = ai_dispatch_generation + 1,
      ai_dispatch_burst_started_at = CASE
        WHEN ai_dispatch_pending_since IS NULL
          THEN now()
        ELSE COALESCE(ai_dispatch_burst_started_at, ai_dispatch_pending_since, now())
      END,
      ai_dispatch_pending_since = now()
  WHERE id = p_conversation_id
    AND account_id = p_account_id
  RETURNING ai_dispatch_generation;
$$;

CREATE OR REPLACE FUNCTION wacrm.claim_ai_dispatch(
  p_account_id uuid,
  p_conversation_id uuid,
  p_generation bigint
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH claimed AS (
    UPDATE wacrm.conversations
    SET ai_dispatch_claimed_generation = p_generation,
        ai_dispatch_pending_since = NULL,
        ai_dispatch_burst_started_at = NULL
    WHERE id = p_conversation_id
      AND account_id = p_account_id
      AND ai_dispatch_generation = p_generation
      AND ai_dispatch_claimed_generation < p_generation
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;

REVOKE ALL ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION wacrm.schedule_ai_dispatch(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION wacrm.claim_ai_dispatch(uuid, uuid, bigint) TO service_role;
