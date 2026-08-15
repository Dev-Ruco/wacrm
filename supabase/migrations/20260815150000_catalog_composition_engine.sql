-- Generic Product Relation Graph + Composition Engine foundation.
--
-- The schema is intentionally domain-neutral. Fashion, automotive, hospitality,
-- services, rentals, etc. define their own templates, slot labels and relation
-- keys as tenant data; the runtime only understands graph weight, eligibility,
-- required slots and persistent slot selections.

create table if not exists wacrm.catalog_product_relations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  source_product_id uuid not null,
  target_product_id uuid not null,
  relation_key text not null check (relation_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  score numeric(4,3) not null default 1 check (score >= 0 and score <= 1),
  source text not null default 'manual' check (source in ('manual', 'import', 'ai', 'observed')),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  verified boolean not null default false,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_product_relations_no_self check (source_product_id <> target_product_id),
  constraint catalog_product_relations_source_fk
    foreign key (source_product_id, account_id)
    references wacrm.catalog_products(id, account_id) on delete cascade,
  constraint catalog_product_relations_target_fk
    foreign key (target_product_id, account_id)
    references wacrm.catalog_products(id, account_id) on delete cascade,
  constraint catalog_product_relations_unique
    unique (account_id, source_product_id, target_product_id, relation_key)
);

create index if not exists catalog_product_relations_source_idx
  on wacrm.catalog_product_relations (account_id, source_product_id, relation_key, score desc);
create index if not exists catalog_product_relations_target_idx
  on wacrm.catalog_product_relations (account_id, target_product_id, relation_key, score desc);

drop trigger if exists set_updated_at on wacrm.catalog_product_relations;
create trigger set_updated_at before update on wacrm.catalog_product_relations
for each row execute function wacrm.update_updated_at_column();

create table if not exists wacrm.composition_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  description text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint composition_templates_account_key_unique unique (account_id, key),
  constraint composition_templates_id_account_unique unique (id, account_id)
);

create table if not exists wacrm.composition_slots (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  template_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  description text,
  required boolean not null default true,
  min_items integer not null default 1 check (min_items >= 0 and min_items <= 20),
  max_items integer not null default 1 check (max_items >= 1 and max_items <= 20 and max_items >= min_items),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint composition_slots_template_fk
    foreign key (template_id, account_id)
    references wacrm.composition_templates(id, account_id) on delete cascade,
  constraint composition_slots_template_key_unique unique (template_id, key),
  constraint composition_slots_id_account_unique unique (id, account_id)
);

create table if not exists wacrm.composition_slot_offering_types (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  slot_id uuid not null,
  offering_type_id uuid not null,
  created_at timestamptz not null default now(),
  constraint composition_slot_offering_types_slot_fk
    foreign key (slot_id, account_id)
    references wacrm.composition_slots(id, account_id) on delete cascade,
  constraint composition_slot_offering_types_type_fk
    foreign key (offering_type_id, account_id)
    references wacrm.offering_types(id, account_id) on delete cascade,
  constraint composition_slot_offering_types_unique unique (slot_id, offering_type_id)
);

create index if not exists composition_templates_account_idx
  on wacrm.composition_templates (account_id, enabled, sort_order);
create index if not exists composition_slots_template_idx
  on wacrm.composition_slots (account_id, template_id, sort_order);
create index if not exists composition_slot_offering_types_slot_idx
  on wacrm.composition_slot_offering_types (account_id, slot_id);

drop trigger if exists set_updated_at on wacrm.composition_templates;
create trigger set_updated_at before update on wacrm.composition_templates
for each row execute function wacrm.update_updated_at_column();
drop trigger if exists set_updated_at on wacrm.composition_slots;
create trigger set_updated_at before update on wacrm.composition_slots
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.conversation_catalog_state
  add column if not exists composition_template_id uuid,
  add column if not exists composition_state jsonb not null default '{}'::jsonb;

alter table wacrm.conversation_catalog_state
  drop constraint if exists conversation_catalog_state_composition_state_object;
alter table wacrm.conversation_catalog_state
  add constraint conversation_catalog_state_composition_state_object
  check (jsonb_typeof(composition_state) = 'object');

-- The composition template belongs to the same tenant; keep it restrictive so
-- deleting a template cannot silently leave a semantically invalid live state.
create unique index if not exists conversation_catalog_state_id_account_unique_idx
  on wacrm.conversation_catalog_state (id, account_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversation_catalog_state_template_fk'
      and conrelid = 'wacrm.conversation_catalog_state'::regclass
  ) then
    alter table wacrm.conversation_catalog_state
      add constraint conversation_catalog_state_template_fk
      foreign key (composition_template_id, account_id)
      references wacrm.composition_templates(id, account_id)
      on delete restrict;
  end if;
end $$;

alter table wacrm.catalog_product_relations enable row level security;
alter table wacrm.composition_templates enable row level security;
alter table wacrm.composition_slots enable row level security;
alter table wacrm.composition_slot_offering_types enable row level security;

revoke all on table wacrm.catalog_product_relations from public, anon;
revoke all on table wacrm.composition_templates from public, anon;
revoke all on table wacrm.composition_slots from public, anon;
revoke all on table wacrm.composition_slot_offering_types from public, anon;

grant select, insert, update, delete on table wacrm.catalog_product_relations to authenticated;
grant select, insert, update, delete on table wacrm.composition_templates to authenticated;
grant select, insert, update, delete on table wacrm.composition_slots to authenticated;
grant select, insert, update, delete on table wacrm.composition_slot_offering_types to authenticated;
grant all on table wacrm.catalog_product_relations to service_role;
grant all on table wacrm.composition_templates to service_role;
grant all on table wacrm.composition_slots to service_role;
grant all on table wacrm.composition_slot_offering_types to service_role;

-- Members may inspect graph/template configuration; administrators mutate it.
drop policy if exists catalog_product_relations_select on wacrm.catalog_product_relations;
create policy catalog_product_relations_select on wacrm.catalog_product_relations
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_product_relations_write on wacrm.catalog_product_relations;
create policy catalog_product_relations_write on wacrm.catalog_product_relations
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists composition_templates_select on wacrm.composition_templates;
create policy composition_templates_select on wacrm.composition_templates
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists composition_templates_write on wacrm.composition_templates;
create policy composition_templates_write on wacrm.composition_templates
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists composition_slots_select on wacrm.composition_slots;
create policy composition_slots_select on wacrm.composition_slots
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists composition_slots_write on wacrm.composition_slots;
create policy composition_slots_write on wacrm.composition_slots
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists composition_slot_offering_types_select on wacrm.composition_slot_offering_types;
create policy composition_slot_offering_types_select on wacrm.composition_slot_offering_types
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists composition_slot_offering_types_write on wacrm.composition_slot_offering_types;
create policy composition_slot_offering_types_write on wacrm.composition_slot_offering_types
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

-- `compose_solution` is a code-owned read capability. It returns verified
-- catalogue selections but does not send media or mutate CRM entities.
insert into wacrm.tool_definitions (
  key, label, description, action_class, reversible, external_impact,
  default_enabled, enabled, input_schema, sort_order
)
values (
  'compose_solution',
  'Compor solução',
  'Constrói ou revê uma solução multi-oferta a partir de templates, relações e catálogo verificado.',
  'read', true, false, false, true, '{"type":"object"}'::jsonb, 25
)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  action_class = excluded.action_class,
  reversible = excluded.reversible,
  external_impact = excluded.external_impact,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;
