-- Website chat database foundation.
-- Additive and backward-compatible: all existing conversations remain WhatsApp.
-- Safe to apply before deploying the website-chat application code.

BEGIN;

-- -----------------------------------------------------------------------------
-- Conversations: introduce an explicit channel without changing current rows.
-- -----------------------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'whatsapp',
  ADD COLUMN IF NOT EXISTS source_metadata JSONB DEFAULT '{}'::jsonb;

-- Heal a partially-applied migration, if any, before enforcing NOT NULL.
UPDATE conversations SET channel = 'whatsapp' WHERE channel IS NULL;
UPDATE conversations SET source_metadata = '{}'::jsonb WHERE source_metadata IS NULL;

ALTER TABLE conversations
  ALTER COLUMN channel SET DEFAULT 'whatsapp',
  ALTER COLUMN channel SET NOT NULL,
  ALTER COLUMN source_metadata SET DEFAULT '{}'::jsonb,
  ALTER COLUMN source_metadata SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_channel_check'
      AND conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_channel_check
      CHECK (channel IN ('whatsapp', 'website'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel_last_message
  ON conversations(account_id, channel, last_message_at DESC);

-- -----------------------------------------------------------------------------
-- One website-chat configuration per CRM account.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS website_channels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Website',
  public_key TEXT NOT NULL DEFAULT replace(uuid_generate_v4()::text, '-', ''),
  allowed_origins TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id),
  UNIQUE(public_key)
);

CREATE INDEX IF NOT EXISTS idx_website_channels_public_key
  ON website_channels(public_key)
  WHERE is_active = TRUE;

ALTER TABLE website_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account members can view website channel" ON website_channels;
CREATE POLICY "Account members can view website channel"
  ON website_channels
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

-- -----------------------------------------------------------------------------
-- Anonymous browser sessions. Raw session tokens are never stored; the app
-- stores only their SHA-256 hash. Writes are server-side through service_role.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS website_chat_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  website_channel_id UUID NOT NULL REFERENCES website_channels(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL,
  origin TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(website_channel_id, visitor_id),
  UNIQUE(session_token_hash)
);

CREATE INDEX IF NOT EXISTS idx_website_chat_sessions_conversation
  ON website_chat_sessions(conversation_id);

ALTER TABLE website_chat_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Account members can view website sessions" ON website_chat_sessions;
CREATE POLICY "Account members can view website sessions"
  ON website_chat_sessions
  FOR SELECT
  USING (is_account_member(account_id, 'viewer'));

COMMIT;
