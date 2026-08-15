-- Generic, tenant-defined catalogue attributes.
--
-- This is deliberately additive: existing category/color/size fields remain
-- valid and keep working. These tables provide the typed attribute layer used
-- by richer catalogue retrieval without baking any business-domain vocabulary
-- into the runtime.

create unique index if not exists catalog_products_id_account_unique_idx
  on wacrm.catalog_products (id, account_id);

create unique index if not exists catalog_taxonomy_terms_id_account_unique_idx
  on wacrm.catalog_taxonomy_terms (id, account_id);

create table if not exists wacrm.catalog_attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  value_type text not null check (value_type in ('text', 'number', 'boolean', 'enum')),
  unit text check (unit is null or char_length(unit) <= 40),
  is_filterable boolean not null default true,
  allow_multiple boolean not null default false,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_attribute_definitions_account_key_unique unique (account_id, key),
  constraint catalog_attribute_definitions_id_account_unique unique (id, account_id)
);

create table if not exists wacrm.catalog_attribute_options (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  definition_id uuid not null,
  canonical_value text not null check (char_length(canonical_value) between 1 and 120),
  label text not null check (char_length(label) between 1 and 120),
  aliases text[] not null default '{}',
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_attribute_options_definition_fk
    foreign key (definition_id, account_id)
    references wacrm.catalog_attribute_definitions(id, account_id)
    on delete cascade,
  constraint catalog_attribute_options_definition_value_unique
    unique (definition_id, canonical_value),
  constraint catalog_attribute_options_id_account_unique unique (id, account_id),
  constraint catalog_attribute_options_id_definition_account_unique
    unique (id, definition_id, account_id)
);

create table if not exists wacrm.catalog_category_attributes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  category_term_id uuid not null,
  definition_id uuid not null,
  required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint catalog_category_attributes_category_fk
    foreign key (category_term_id, account_id)
    references wacrm.catalog_taxonomy_terms(id, account_id)
    on delete cascade,
  constraint catalog_category_attributes_definition_fk
    foreign key (definition_id, account_id)
    references wacrm.catalog_attribute_definitions(id, account_id)
    on delete cascade,
  constraint catalog_category_attributes_unique
    unique (category_term_id, definition_id)
);

create table if not exists wacrm.catalog_product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  product_id uuid not null,
  definition_id uuid not null,
  option_id uuid,
  value_key text not null check (char_length(value_key) between 1 and 180),
  value jsonb not null,
  source text not null default 'manual' check (source in ('manual', 'import', 'sync', 'ai')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_product_attribute_values_product_fk
    foreign key (product_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint catalog_product_attribute_values_definition_fk
    foreign key (definition_id, account_id)
    references wacrm.catalog_attribute_definitions(id, account_id)
    on delete cascade,
  constraint catalog_product_attribute_values_option_fk
    foreign key (option_id, definition_id, account_id)
    references wacrm.catalog_attribute_options(id, definition_id, account_id)
    on delete restrict,
  constraint catalog_product_attribute_values_unique
    unique (product_id, definition_id, value_key)
);

create index if not exists catalog_attribute_definitions_account_idx
  on wacrm.catalog_attribute_definitions (account_id, enabled, sort_order);
create index if not exists catalog_attribute_options_definition_idx
  on wacrm.catalog_attribute_options (account_id, definition_id, enabled, sort_order);
create index if not exists catalog_category_attributes_category_idx
  on wacrm.catalog_category_attributes (account_id, category_term_id, sort_order);
create index if not exists catalog_product_attribute_values_product_idx
  on wacrm.catalog_product_attribute_values (account_id, product_id, definition_id);
create index if not exists catalog_product_attribute_values_lookup_idx
  on wacrm.catalog_product_attribute_values (account_id, definition_id, value_key);

-- Keep updated_at semantics aligned with the existing catalogue/taxonomy tables.
drop trigger if exists set_updated_at on wacrm.catalog_attribute_definitions;
create trigger set_updated_at
before update on wacrm.catalog_attribute_definitions
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.catalog_attribute_options;
create trigger set_updated_at
before update on wacrm.catalog_attribute_options
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.catalog_product_attribute_values;
create trigger set_updated_at
before update on wacrm.catalog_product_attribute_values
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.catalog_attribute_definitions enable row level security;
alter table wacrm.catalog_attribute_options enable row level security;
alter table wacrm.catalog_category_attributes enable row level security;
alter table wacrm.catalog_product_attribute_values enable row level security;

revoke all on table wacrm.catalog_attribute_definitions from public, anon;
revoke all on table wacrm.catalog_attribute_options from public, anon;
revoke all on table wacrm.catalog_category_attributes from public, anon;
revoke all on table wacrm.catalog_product_attribute_values from public, anon;

grant select, insert, update, delete on table wacrm.catalog_attribute_definitions to authenticated;
grant select, insert, update, delete on table wacrm.catalog_attribute_options to authenticated;
grant select, insert, update, delete on table wacrm.catalog_category_attributes to authenticated;
grant select, insert, update, delete on table wacrm.catalog_product_attribute_values to authenticated;
grant all on table wacrm.catalog_attribute_definitions to service_role;
grant all on table wacrm.catalog_attribute_options to service_role;
grant all on table wacrm.catalog_category_attributes to service_role;
grant all on table wacrm.catalog_product_attribute_values to service_role;

-- Members may read catalogue configuration and values; only account admins may
-- change them. The service role bypasses these policies for the agent runtime.
drop policy if exists catalog_attribute_definitions_select on wacrm.catalog_attribute_definitions;
create policy catalog_attribute_definitions_select on wacrm.catalog_attribute_definitions
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_attribute_definitions_insert on wacrm.catalog_attribute_definitions;
create policy catalog_attribute_definitions_insert on wacrm.catalog_attribute_definitions
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_attribute_definitions_update on wacrm.catalog_attribute_definitions;
create policy catalog_attribute_definitions_update on wacrm.catalog_attribute_definitions
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_attribute_definitions_delete on wacrm.catalog_attribute_definitions;
create policy catalog_attribute_definitions_delete on wacrm.catalog_attribute_definitions
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists catalog_attribute_options_select on wacrm.catalog_attribute_options;
create policy catalog_attribute_options_select on wacrm.catalog_attribute_options
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_attribute_options_insert on wacrm.catalog_attribute_options;
create policy catalog_attribute_options_insert on wacrm.catalog_attribute_options
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_attribute_options_update on wacrm.catalog_attribute_options;
create policy catalog_attribute_options_update on wacrm.catalog_attribute_options
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_attribute_options_delete on wacrm.catalog_attribute_options;
create policy catalog_attribute_options_delete on wacrm.catalog_attribute_options
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists catalog_category_attributes_select on wacrm.catalog_category_attributes;
create policy catalog_category_attributes_select on wacrm.catalog_category_attributes
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_category_attributes_insert on wacrm.catalog_category_attributes;
create policy catalog_category_attributes_insert on wacrm.catalog_category_attributes
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_category_attributes_update on wacrm.catalog_category_attributes;
create policy catalog_category_attributes_update on wacrm.catalog_category_attributes
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_category_attributes_delete on wacrm.catalog_category_attributes;
create policy catalog_category_attributes_delete on wacrm.catalog_category_attributes
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists catalog_product_attribute_values_select on wacrm.catalog_product_attribute_values;
create policy catalog_product_attribute_values_select on wacrm.catalog_product_attribute_values
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_product_attribute_values_insert on wacrm.catalog_product_attribute_values;
create policy catalog_product_attribute_values_insert on wacrm.catalog_product_attribute_values
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_product_attribute_values_update on wacrm.catalog_product_attribute_values;
create policy catalog_product_attribute_values_update on wacrm.catalog_product_attribute_values
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_product_attribute_values_delete on wacrm.catalog_product_attribute_values;
create policy catalog_product_attribute_values_delete on wacrm.catalog_product_attribute_values
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));