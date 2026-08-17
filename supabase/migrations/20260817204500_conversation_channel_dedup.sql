-- Allow the same CRM contact to keep one conversation per channel.
-- Existing installations enforced one conversation per (account, contact),
-- which prevented a real website lead from also having a WhatsApp thread.

BEGIN;

DROP INDEX IF EXISTS wacrm.idx_conversations_account_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON wacrm.conversations (account_id, contact_id, channel);

COMMIT;
