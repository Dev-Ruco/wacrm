-- Tenant-owned catalogue collections.
--
-- `catalog_products` remains the canonical offering table used by the agent.
-- Collections are a presentation/organisation boundary above those offerings:
-- one account can maintain several catalogues without changing the search,
-- composition, stock or source-provenance model.

create table if not exists wacrm.catalog_collections (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  description text check (description is null or char_length(description) <= 1200),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_collections_account_name_unique unique (account_id, name),
  constraint catalog_collections_id_account_unique unique (id, account_id)
);

create unique index if not exists catalog_collections_one_default_idx
  on wacrm.catalog_collections (account_id)
  where is_default = true;

create index if not exists catalog_collections_account_idx
  on wacrm.catalog_collections (account_id, is_active, updated_at desc);

alter table wacrm.catalog_products
  add column if not exists catalog_id uuid;

-- Existing canonical offerings are never orphaned by this migration. Every
-- account that already has products receives one default catalogue and all
-- existing rows are assigned to it.
insert into wacrm.catalog_collections (account_id, name, description, is_default)
select distinct
  product.account_id,
  'Catálogo principal',
  'Catálogo criado automaticamente para organizar as ofertas existentes.',
  true
from wacrm.catalog_products product
where not exists (
  select 1
  from wacrm.catalog_collections collection
  where collection.account_id = product.account_id
    and collection.is_default = true
)
on conflict (account_id, name) do nothing;

update wacrm.catalog_products product
set catalog_id = collection.id
from wacrm.catalog_collections collection
where product.catalog_id is null
  and collection.account_id = product.account_id
  and collection.is_default = true;

alter table wacrm.catalog_products
  drop constraint if exists catalog_products_catalog_collection_fk;
alter table wacrm.catalog_products
  add constraint catalog_products_catalog_collection_fk
  foreign key (catalog_id, account_id)
  references wacrm.catalog_collections(id, account_id)
  on delete restrict;

create index if not exists catalog_products_catalog_idx
  on wacrm.catalog_products (account_id, catalog_id, is_active, created_at desc);

-- Canonical ingestion paths that pre-date collections do not know a catalog_id.
-- Give those inserts the account's default collection automatically. If the
-- account has never created a collection, the trigger creates the first one.
create or replace function wacrm.assign_default_catalog_collection()
returns trigger
language plpgsql
security definer
set search_path = wacrm, public
as $$
declare
  default_catalog_id uuid;
begin
  if new.catalog_id is not null then
    return new;
  end if;

  select collection.id
    into default_catalog_id
  from wacrm.catalog_collections collection
  where collection.account_id = new.account_id
    and collection.is_default = true
  limit 1;

  if default_catalog_id is null then
    insert into wacrm.catalog_collections (
      account_id,
      name,
      description,
      is_default,
      is_active
    )
    values (
      new.account_id,
      'Catálogo principal',
      'Catálogo criado automaticamente para novas ofertas.',
      true,
      true
    )
    on conflict (account_id, name) do update
      set is_default = true,
          is_active = true,
          updated_at = now()
    returning id into default_catalog_id;
  end if;

  new.catalog_id := default_catalog_id;
  return new;
end;
$$;

revoke all on function wacrm.assign_default_catalog_collection() from public;

drop trigger if exists assign_default_catalog_collection on wacrm.catalog_products;
create trigger assign_default_catalog_collection
before insert on wacrm.catalog_products
for each row
execute function wacrm.assign_default_catalog_collection();

drop trigger if exists set_updated_at on wacrm.catalog_collections;
create trigger set_updated_at
before update on wacrm.catalog_collections
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.catalog_collections enable row level security;

revoke all on table wacrm.catalog_collections from public, anon;
grant select, insert, update, delete on table wacrm.catalog_collections to authenticated;
grant all on table wacrm.catalog_collections to service_role;

drop policy if exists catalog_collections_select on wacrm.catalog_collections;
create policy catalog_collections_select on wacrm.catalog_collections
for select to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists catalog_collections_write on wacrm.catalog_collections;
create policy catalog_collections_write on wacrm.catalog_collections
for all to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
