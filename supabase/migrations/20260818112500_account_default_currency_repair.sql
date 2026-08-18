-- Repair deployments where the historical default-currency migration was
-- applied against a different search_path or was otherwise skipped.
--
-- Customer-journey deal synchronisation reads wacrm.accounts.default_currency
-- when it creates an opportunity. Keep this migration explicitly
-- schema-qualified so later journey triggers are safe on every deployment.

ALTER TABLE wacrm.accounts
  ADD COLUMN IF NOT EXISTS default_currency text NOT NULL DEFAULT 'USD';

ALTER TABLE wacrm.accounts
  DROP CONSTRAINT IF EXISTS accounts_default_currency_format;

ALTER TABLE wacrm.accounts
  ADD CONSTRAINT accounts_default_currency_format
  CHECK (default_currency ~ '^[A-Z]{3}$');
