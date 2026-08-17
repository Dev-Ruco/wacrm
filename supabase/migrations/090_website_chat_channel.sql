-- Website chat channel: conversations created by a public web widget
-- live in the same shared Inbox as WhatsApp, but never pass through Meta.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'whatsapp'
    CHECK (channel IN ('whatsapp', 'website')),
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_conversations_account_channel_last_message
  ON conversations(account_id, channel, last_message_at DESC);

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
  ON website_channels(public_key) WHERE is_active = TRUE;

ALTER TABLE website_channels ENABLE ROW LEVEL SECURITY;

-- Public widget access is deliberately server-only (service role). The
-- dashboard provisions/edits channels through authenticated API routes.
DROP POLICY IF EXISTS "Account members can view website channel" ON website_channels;
CREATE POLICY "Account members can view website channel"
  ON website_channels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = website_channels.account_id
    )
  );

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
  ON website_chat_sessions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_id = website_chat_sessions.account_id
    )
  );
