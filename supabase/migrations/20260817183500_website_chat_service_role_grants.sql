-- Grant the WA CRM server-side service role access to the website chat tables.
-- RLS remains enabled; anon/authenticated roles are not granted access here.

BEGIN;

GRANT USAGE ON SCHEMA wacrm TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE wacrm.website_channels
  TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE wacrm.website_chat_sessions
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
