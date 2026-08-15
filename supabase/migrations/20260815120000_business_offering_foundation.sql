-- Business Offering foundation + dynamic tool capability registry.
--
-- Goals:
--   1. Keep the runtime generic across industries: products are one current
--      representation of an offering, not the schema definition itself.
--   2. Replace rigid tool-key CHECK constraints with a registry of capabilities.
--   3. Preserve all existing catalogue behaviour and migrate the temporary
--      catalog_attribute_* data non-destructively.
--
-- Runtime handlers remain code-owned. A row in tool_definitions describes an
-- implemented capability; it does not dynamically execute arbitrary code.

-- ---------------------------------------------------------------------------
-- Tool registry
-- ---------------------------------------------------------------------------

create table if not exists wacrm.tool_definitions (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  description text,
  action_class text not null default 'read'
    check (action_class in ('read', 'communication', 'mutation', 'handoff')),
  reversible boolean not null default true,
  external_impact boolean not null default false,
  default_enabled boolean not null default true,
  enabled boolean not null default true,
  input_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_schema) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on wacrm.tool_definitions;
create trigger set_updated_at
before update on wacrm.tool_definitions
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.tool_definitions enable row level security;
revoke all on table wacrm.tool_definitions from public, anon;
grant select on table wacrm.tool_definitions to authenticated;
grant all on table wacrm.tool_definitions to service_role;

drop policy if exists tool_definitions_select on wacrm.tool_definitions;
create policy tool_definitions_select
on wacrm.tool_definitions
for select
to authenticated
using (true);

insert into wacrm.tool_definitions (
  key, label, description, action_class, reversible, external_impact,
  default_enabled, enabled, input_schema, sort_order
)
values
  ('search_catalog', 'Consultar catálogo', 'Pesquisa ofertas no catálogo e nas fontes activas.', 'read', true, false, true, true, '{"type":"object"}'::jsonb, 10),
  ('send_product', 'Enviar produtos', 'Envia ao cliente media de uma oferta já encontrada e validada.', 'communication', false, true, true, true, '{"type":"object"}'::jsonb, 20),
  ('search_knowledge', 'Consultar conhecimento', 'Pesquisa documentos e conhecimento da conta.', 'read', true, false, true, true, '{"type":"object"}'::jsonb, 30),
  ('add_tag', 'Adicionar tag ao contacto', 'Aplica ao contacto uma tag existente na conta.', 'mutation', true, true, false, true, '{"type":"object"}'::jsonb, 40),
  ('create_deal', 'Criar negócio no pipeline', 'Cria uma oportunidade comercial no pipeline da conta.', 'mutation', true, true, false, true, '{"type":"object"}'::jsonb, 50),
  ('schedule_visit', 'Agendar visita', 'Agenda uma visita ou marcação para o contacto.', 'mutation', true, true, false, true, '{"type":"object"}'::jsonb, 60),
  ('get_style_opinion', 'Opinião visual', 'Analisa media validada para apoiar uma recomendação.', 'read', true, false, true, true, '{"type":"object"}'::jsonb, 70),
  ('handoff_human', 'Encaminhar para humano', 'Suspende a resposta automática e transfere o atendimento.', 'handoff', true, true, true, true, '{"type":"object"}'::jsonb, 80)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  action_class = excluded.action_class,
  reversible = excluded.reversible,
  external_impact = excluded.external_impact,
  default_enabled = excluded.default_enabled,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;

-- Remove the historical allow-lists. Referential integrity now comes from the
-- registry instead of requiring a database migration every time the runtime
-- gains a new implemented tool.
alter table wacrm.agent_tools
  drop constraint if exists agent_tools_tool_key_check;
alter table wacrm.agent_tool_calls
  drop constraint if exists agent_tool_calls_tool_key_check;

-- Existing rows are covered by the seed above. The FK prevents a tenant from
-- configuring a key that is not registered as a platform capability.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_tools_tool_definition_fk'
      and conrelid = 'wacrm.agent_tools'::regclass
  ) then
    alter table wacrm.agent_tools
      add constraint agent_tools_tool_definition_fk
      foreign key (tool_key) references wacrm.tool_definitions(key)
      on update cascade on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_tool_calls_tool_definition_fk'
      and conrelid = 'wacrm.agent_tool_calls'::regclass
  ) then
    alter table wacrm.agent_tool_calls
      add constraint agent_tool_calls_tool_definition_fk
      foreign key (tool_key) references wacrm.tool_definitions(key)
      on update cascade on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Business Offering schema
-- ---------------------------------------------------------------------------

create table if not exists wacrm.offering_types (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  description text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offering_types_account_key_unique unique (account_id, key),
  constraint offering_types_id_account_unique unique (id, account_id)
);

create table if not exists wacrm.offering_attribute_definitions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  offering_type_id uuid,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  value_type text not null check (value_type in ('text', 'number', 'boolean', 'enum')),
  unit text check (unit is null or char_length(unit) <= 40),
  is_filterable boolean not null default true,
  allow_multiple boolean not null default false,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb
    check (jsonb_typeof(options) = 'array'),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offering_attribute_definitions_type_fk
    foreign key (offering_type_id, account_id)
    references wacrm.offering_types(id, account_id)
    on delete cascade,
  constraint offering_attribute_definitions_scope_key_unique
    unique nulls not distinct (account_id, offering_type_id, key),
  constraint offering_attribute_definitions_id_account_unique
    unique (id, account_id)
);

create table if not exists wacrm.offering_attribute_values (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  product_id uuid not null,
  definition_id uuid not null,
  value_key text not null check (char_length(value_key) between 1 and 180),
  value jsonb not null,
  source text not null default 'manual'
    check (source in ('manual', 'import', 'sync', 'ai')),
  confidence numeric(4,3)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offering_attribute_values_product_fk
    foreign key (product_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint offering_attribute_values_definition_fk
    foreign key (definition_id, account_id)
    references wacrm.offering_attribute_definitions(id, account_id)
    on delete cascade,
  constraint offering_attribute_values_unique
    unique (product_id, definition_id, value_key)
);

create index if not exists offering_types_account_idx
  on wacrm.offering_types (account_id, enabled, sort_order);
create index if not exists offering_attribute_definitions_account_idx
  on wacrm.offering_attribute_definitions (account_id, offering_type_id, enabled, sort_order);
create index if not exists offering_attribute_values_product_idx
  on wacrm.offering_attribute_values (account_id, product_id, definition_id);
create index if not exists offering_attribute_values_lookup_idx
  on wacrm.offering_attribute_values (account_id, definition_id, value_key);

alter table wacrm.catalog_products
  add column if not exists offering_type_id uuid;

-- catalog_products.metadata already exists in the original catalogue schema;
-- make the invariant explicit for installations that were created differently.
alter table wacrm.catalog_products
  add column if not exists metadata jsonb not null default '{}'::jsonb;
update wacrm.catalog_products set metadata = '{}'::jsonb where metadata is null;
alter table wacrm.catalog_products alter column metadata set default '{}'::jsonb;
alter table wacrm.catalog_products alter column metadata set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'catalog_products_offering_type_fk'
      and conrelid = 'wacrm.catalog_products'::regclass
  ) then
    alter table wacrm.catalog_products
      add constraint catalog_products_offering_type_fk
      foreign key (offering_type_id, account_id)
      references wacrm.offering_types(id, account_id)
      on delete set null;
  end if;
end $$;

create index if not exists catalog_products_offering_type_idx
  on wacrm.catalog_products (account_id, offering_type_id, is_active);

-- updated_at triggers
drop trigger if exists set_updated_at on wacrm.offering_types;
create trigger set_updated_at
before update on wacrm.offering_types
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.offering_attribute_definitions;
create trigger set_updated_at
before update on wacrm.offering_attribute_definitions
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.offering_attribute_values;
create trigger set_updated_at
before update on wacrm.offering_attribute_values
for each row execute function wacrm.update_updated_at_column();

-- RLS / grants
alter table wacrm.offering_types enable row level security;
alter table wacrm.offering_attribute_definitions enable row level security;
alter table wacrm.offering_attribute_values enable row level security;

revoke all on table wacrm.offering_types from public, anon;
revoke all on table wacrm.offering_attribute_definitions from public, anon;
revoke all on table wacrm.offering_attribute_values from public, anon;

grant select, insert, update, delete on table wacrm.offering_types to authenticated;
grant select, insert, update, delete on table wacrm.offering_attribute_definitions to authenticated;
grant select, insert, update, delete on table wacrm.offering_attribute_values to authenticated;
grant all on table wacrm.offering_types to service_role;
grant all on table wacrm.offering_attribute_definitions to service_role;
grant all on table wacrm.offering_attribute_values to service_role;

drop policy if exists offering_types_select on wacrm.offering_types;
create policy offering_types_select on wacrm.offering_types
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists offering_types_insert on wacrm.offering_types;
create policy offering_types_insert on wacrm.offering_types
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists offering_types_update on wacrm.offering_types;
create policy offering_types_update on wacrm.offering_types
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists offering_types_delete on wacrm.offering_types;
create policy offering_types_delete on wacrm.offering_types
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists offering_attribute_definitions_select on wacrm.offering_attribute_definitions;
create policy offering_attribute_definitions_select on wacrm.offering_attribute_definitions
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists offering_attribute_definitions_insert on wacrm.offering_attribute_definitions;
create policy offering_attribute_definitions_insert on wacrm.offering_attribute_definitions
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists offering_attribute_definitions_update on wacrm.offering_attribute_definitions;
create policy offering_attribute_definitions_update on wacrm.offering_attribute_definitions
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists offering_attribute_definitions_delete on wacrm.offering_attribute_definitions;
create policy offering_attribute_definitions_delete on wacrm.offering_attribute_definitions
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists offering_attribute_values_select on wacrm.offering_attribute_values;
create policy offering_attribute_values_select on wacrm.offering_attribute_values
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists offering_attribute_values_insert on wacrm.offering_attribute_values;
create policy offering_attribute_values_insert on wacrm.offering_attribute_values
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists offering_attribute_values_update on wacrm.offering_attribute_values;
create policy offering_attribute_values_update on wacrm.offering_attribute_values
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists offering_attribute_values_delete on wacrm.offering_attribute_values;
create policy offering_attribute_values_delete on wacrm.offering_attribute_values
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

-- ---------------------------------------------------------------------------
-- Non-destructive compatibility migration from the temporary catalogue schema
-- ---------------------------------------------------------------------------
-- Preserve definition UUIDs so existing value rows can migrate without an
-- artificial mapping table. Definitions remain tenant-global (type = null)
-- until an administrator assigns them to an offering type.

insert into wacrm.offering_attribute_definitions (
  id, account_id, offering_type_id, key, label, value_type, unit,
  is_filterable, allow_multiple, required, options, enabled, sort_order,
  created_at, updated_at
)
select
  d.id,
  d.account_id,
  null,
  d.key,
  d.label,
  d.value_type,
  d.unit,
  d.is_filterable,
  d.allow_multiple,
  false,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'value', o.canonical_value,
        'label', o.label,
        'aliases', coalesce(to_jsonb(o.aliases), '[]'::jsonb),
        'enabled', o.enabled,
        'sort_order', o.sort_order
      )
      order by o.sort_order, o.label
    )
    from wacrm.catalog_attribute_options o
    where o.account_id = d.account_id
      and o.definition_id = d.id
  ), '[]'::jsonb),
  d.enabled,
  d.sort_order,
  d.created_at,
  d.updated_at
from wacrm.catalog_attribute_definitions d
on conflict (id) do nothing;

insert into wacrm.offering_attribute_values (
  id, account_id, product_id, definition_id, value_key, value,
  source, confidence, verified, created_at, updated_at
)
select
  v.id,
  v.account_id,
  v.product_id,
  v.definition_id,
  v.value_key,
  v.value,
  v.source,
  v.confidence,
  v.verified,
  v.created_at,
  v.updated_at
from wacrm.catalog_product_attribute_values v
join wacrm.offering_attribute_definitions d
  on d.id = v.definition_id
 and d.account_id = v.account_id
on conflict (id) do nothing;

comment on table wacrm.offering_types is
  'Tenant-defined kinds of business offering. No industry vocabulary belongs in the runtime.';
comment on table wacrm.offering_attribute_definitions is
  'Typed tenant schema for offering facts and deterministic filters.';
comment on table wacrm.offering_attribute_values is
  'Canonical offering facts attached to internal catalogue products with provenance.';
comment on table wacrm.catalog_attribute_definitions is
  'Deprecated compatibility table. New code uses wacrm.offering_attribute_definitions.';
comment on table wacrm.catalog_product_attribute_values is
  'Deprecated compatibility table. New code uses wacrm.offering_attribute_values.';