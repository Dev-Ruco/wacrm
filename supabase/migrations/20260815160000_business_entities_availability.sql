-- Generic Business Entities + schedule availability foundation.
--
-- This deliberately does not add a live AI tool yet. The schema first gives
-- every tenant a neutral way to model people, places and resources that
-- participate in an offering, plus recurring availability and explicit
-- exceptions. Stock/inventory remains a separate catalogue concern.

create table if not exists wacrm.business_entity_types (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,79}$'),
  label text not null check (char_length(label) between 1 and 120),
  description text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_entity_types_account_key_unique unique (account_id, key),
  constraint business_entity_types_id_account_unique unique (id, account_id)
);

create table if not exists wacrm.business_entities (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  entity_type_id uuid not null,
  name text not null check (char_length(name) between 1 and 180),
  external_ref text,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_entities_type_fk
    foreign key (entity_type_id, account_id)
    references wacrm.business_entity_types(id, account_id)
    on delete restrict,
  constraint business_entities_id_account_unique unique (id, account_id)
);

create unique index if not exists business_entities_external_ref_unique_idx
  on wacrm.business_entities (account_id, entity_type_id, external_ref)
  where external_ref is not null;

-- `offering_id` points at the current canonical offering representation in
-- catalog_products. The relation key is tenant vocabulary: provided_by,
-- available_at, requires_resource, assigned_to, etc. Runtime code must not
-- branch on those values.
create table if not exists wacrm.offering_entity_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  offering_id uuid not null,
  entity_id uuid not null,
  relation_key text not null check (relation_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  priority integer not null default 0,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint offering_entity_links_offering_fk
    foreign key (offering_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint offering_entity_links_entity_fk
    foreign key (entity_id, account_id)
    references wacrm.business_entities(id, account_id)
    on delete cascade,
  constraint offering_entity_links_unique unique (account_id, offering_id, entity_id, relation_key)
);

-- Recurring local-time schedule windows. Overnight schedules should be stored
-- as two windows (e.g. 22:00-23:59 and 00:00-02:00), which keeps evaluation
-- deterministic and avoids implicit day-rollover semantics.
create table if not exists wacrm.availability_windows (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  offering_id uuid,
  entity_id uuid,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 80),
  capacity integer check (capacity is null or capacity >= 1),
  valid_from date,
  valid_until date,
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_windows_target_check check (offering_id is not null or entity_id is not null),
  constraint availability_windows_time_check check (end_time > start_time),
  constraint availability_windows_validity_check check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint availability_windows_offering_fk
    foreign key (offering_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint availability_windows_entity_fk
    foreign key (entity_id, account_id)
    references wacrm.business_entities(id, account_id)
    on delete cascade
);

-- Explicit date/time overrides. `unavailable` wins over a recurring window;
-- `available` can open an exceptional period. These are operational facts,
-- not model-generated advice.
create table if not exists wacrm.availability_exceptions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  offering_id uuid,
  entity_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null check (status in ('available', 'unavailable')),
  capacity integer check (capacity is null or capacity >= 1),
  reason text check (reason is null or char_length(reason) <= 500),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_exceptions_target_check check (offering_id is not null or entity_id is not null),
  constraint availability_exceptions_range_check check (ends_at > starts_at),
  constraint availability_exceptions_offering_fk
    foreign key (offering_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint availability_exceptions_entity_fk
    foreign key (entity_id, account_id)
    references wacrm.business_entities(id, account_id)
    on delete cascade
);

create index if not exists business_entity_types_account_idx
  on wacrm.business_entity_types (account_id, enabled, sort_order);
create index if not exists business_entities_account_idx
  on wacrm.business_entities (account_id, entity_type_id, enabled, name);
create index if not exists offering_entity_links_offering_idx
  on wacrm.offering_entity_links (account_id, offering_id, enabled, priority desc);
create index if not exists offering_entity_links_entity_idx
  on wacrm.offering_entity_links (account_id, entity_id, enabled, priority desc);
create index if not exists availability_windows_offering_idx
  on wacrm.availability_windows (account_id, offering_id, weekday, enabled);
create index if not exists availability_windows_entity_idx
  on wacrm.availability_windows (account_id, entity_id, weekday, enabled);
create index if not exists availability_exceptions_offering_idx
  on wacrm.availability_exceptions (account_id, offering_id, starts_at, ends_at)
  where enabled = true;
create index if not exists availability_exceptions_entity_idx
  on wacrm.availability_exceptions (account_id, entity_id, starts_at, ends_at)
  where enabled = true;

-- updated_at triggers
drop trigger if exists set_updated_at on wacrm.business_entity_types;
create trigger set_updated_at before update on wacrm.business_entity_types
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.business_entities;
create trigger set_updated_at before update on wacrm.business_entities
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.offering_entity_links;
create trigger set_updated_at before update on wacrm.offering_entity_links
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.availability_windows;
create trigger set_updated_at before update on wacrm.availability_windows
for each row execute function wacrm.update_updated_at_column();

drop trigger if exists set_updated_at on wacrm.availability_exceptions;
create trigger set_updated_at before update on wacrm.availability_exceptions
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.business_entity_types enable row level security;
alter table wacrm.business_entities enable row level security;
alter table wacrm.offering_entity_links enable row level security;
alter table wacrm.availability_windows enable row level security;
alter table wacrm.availability_exceptions enable row level security;

revoke all on table wacrm.business_entity_types from public, anon;
revoke all on table wacrm.business_entities from public, anon;
revoke all on table wacrm.offering_entity_links from public, anon;
revoke all on table wacrm.availability_windows from public, anon;
revoke all on table wacrm.availability_exceptions from public, anon;

grant select, insert, update, delete on table wacrm.business_entity_types to authenticated;
grant select, insert, update, delete on table wacrm.business_entities to authenticated;
grant select, insert, update, delete on table wacrm.offering_entity_links to authenticated;
grant select, insert, update, delete on table wacrm.availability_windows to authenticated;
grant select, insert, update, delete on table wacrm.availability_exceptions to authenticated;
grant all on table wacrm.business_entity_types to service_role;
grant all on table wacrm.business_entities to service_role;
grant all on table wacrm.offering_entity_links to service_role;
grant all on table wacrm.availability_windows to service_role;
grant all on table wacrm.availability_exceptions to service_role;

-- All account members can inspect operational knowledge; administrators own
-- configuration mutations. Runtime service-role access remains explicit.
drop policy if exists business_entity_types_select on wacrm.business_entity_types;
create policy business_entity_types_select on wacrm.business_entity_types
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists business_entity_types_write on wacrm.business_entity_types;
create policy business_entity_types_write on wacrm.business_entity_types
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists business_entities_select on wacrm.business_entities;
create policy business_entities_select on wacrm.business_entities
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists business_entities_write on wacrm.business_entities;
create policy business_entities_write on wacrm.business_entities
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists offering_entity_links_select on wacrm.offering_entity_links;
create policy offering_entity_links_select on wacrm.offering_entity_links
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists offering_entity_links_write on wacrm.offering_entity_links;
create policy offering_entity_links_write on wacrm.offering_entity_links
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists availability_windows_select on wacrm.availability_windows;
create policy availability_windows_select on wacrm.availability_windows
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists availability_windows_write on wacrm.availability_windows;
create policy availability_windows_write on wacrm.availability_windows
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists availability_exceptions_select on wacrm.availability_exceptions;
create policy availability_exceptions_select on wacrm.availability_exceptions
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists availability_exceptions_write on wacrm.availability_exceptions;
create policy availability_exceptions_write on wacrm.availability_exceptions
for all to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
