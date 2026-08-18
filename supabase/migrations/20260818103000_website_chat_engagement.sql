-- Website-chat engagement: verified WhatsApp leads, transient activity states,
-- browser push subscriptions and optional WhatsApp offline recovery.
-- Additive and disabled by default so it can be deployed before channel setup.

BEGIN;

SET LOCAL search_path = wacrm, public, extensions;

ALTER TABLE wacrm.website_channels
  ADD COLUMN IF NOT EXISTS require_whatsapp_verification BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS otp_template_id UUID,
  ADD COLUMN IF NOT EXISTS offline_whatsapp_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS offline_reply_template_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'website_channels_otp_template_fk'
      AND conrelid = 'wacrm.website_channels'::regclass
  ) THEN
    ALTER TABLE wacrm.website_channels
      ADD CONSTRAINT website_channels_otp_template_fk
      FOREIGN KEY (otp_template_id)
      REFERENCES wacrm.message_templates(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'website_channels_offline_reply_template_fk'
      AND conrelid = 'wacrm.website_channels'::regclass
  ) THEN
    ALTER TABLE wacrm.website_channels
      ADD CONSTRAINT website_channels_offline_reply_template_fk
      FOREIGN KEY (offline_reply_template_id)
      REFERENCES wacrm.message_templates(id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE wacrm.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_verified_at TIMESTAMPTZ;

ALTER TABLE wacrm.website_chat_sessions
  ADD COLUMN IF NOT EXISTS last_visible_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_offline_whatsapp_notified_at TIMESTAMPTZ;

ALTER TABLE wacrm.conversations
  ADD COLUMN IF NOT EXISTS website_activity_state TEXT,
  ADD COLUMN IF NOT EXISTS website_activity_updated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversations_website_activity_state_check'
      AND conrelid = 'wacrm.conversations'::regclass
  ) THEN
    ALTER TABLE wacrm.conversations
      ADD CONSTRAINT conversations_website_activity_state_check
      CHECK (
        website_activity_state IS NULL
        OR website_activity_state IN (
          'analyzing',
          'searching_catalog',
          'writing',
          'human_typing'
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS wacrm.website_chat_otp_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES wacrm.accounts(id) ON DELETE CASCADE,
  website_channel_id UUID NOT NULL REFERENCES wacrm.website_channels(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  verification_token_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  verification_expires_at TIMESTAMPTZ,
  delivery_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_website_chat_otp_lookup
  ON wacrm.website_chat_otp_challenges(website_channel_id, visitor_id, phone_normalized, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_website_chat_otp_verified_token
  ON wacrm.website_chat_otp_challenges(verification_token_hash)
  WHERE verification_token_hash IS NOT NULL;

ALTER TABLE wacrm.website_chat_otp_challenges ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS wacrm.website_chat_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES wacrm.accounts(id) ON DELETE CASCADE,
  website_channel_id UUID NOT NULL REFERENCES wacrm.website_channels(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES wacrm.conversations(id) ON DELETE CASCADE,
  visitor_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(website_channel_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_website_chat_push_conversation
  ON wacrm.website_chat_push_subscriptions(conversation_id);

ALTER TABLE wacrm.website_chat_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Browser access always goes through the WACRM server. Do not grant anon or
-- authenticated direct write access to these security-sensitive tables.
GRANT USAGE ON SCHEMA wacrm TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE wacrm.website_chat_otp_challenges,
           wacrm.website_chat_push_subscriptions
  TO service_role;
GRANT SELECT, UPDATE
  ON TABLE wacrm.website_channels,
           wacrm.website_chat_sessions,
           wacrm.conversations,
           wacrm.contacts
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
