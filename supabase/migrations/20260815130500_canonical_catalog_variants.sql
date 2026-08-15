-- Canonical variants/SKUs for mirrored offerings.
-- Variant fields are intentionally generic; business-specific facts belong in
-- Business Offering attributes, not new industry columns here.

create table if not exists wacrm.catalog_product_variants (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  product_id uuid not null,
  source_id uuid,
  external_id text,
  sku text,
  size text,
  color text,
  price numeric(14,2) check (price is null or price >= 0),
  stock_quantity integer,
  image_url text,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_product_variants_product_fk
    foreign key (product_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint catalog_product_variants_source_fk
    foreign key (source_id, account_id)
    references wacrm.catalog_sources(id, account_id)
    on delete set null
);

create unique index if not exists catalog_product_variants_source_external_unique_idx
  on wacrm.catalog_product_variants (source_id, external_id)
  where source_id is not null and external_id is not null;
create index if not exists catalog_product_variants_product_idx
  on wacrm.catalog_product_variants (account_id, product_id, is_active);
create index if not exists catalog_product_variants_source_idx
  on wacrm.catalog_product_variants (account_id, source_id, is_active);

drop trigger if exists set_updated_at on wacrm.catalog_product_variants;
create trigger set_updated_at
before update on wacrm.catalog_product_variants
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.catalog_product_variants enable row level security;
revoke all on table wacrm.catalog_product_variants from public, anon;
grant select, insert, update, delete on table wacrm.catalog_product_variants to authenticated;
grant all on table wacrm.catalog_product_variants to service_role;

drop policy if exists catalog_product_variants_select on wacrm.catalog_product_variants;
create policy catalog_product_variants_select on wacrm.catalog_product_variants
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_product_variants_insert on wacrm.catalog_product_variants;
create policy catalog_product_variants_insert on wacrm.catalog_product_variants
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_product_variants_update on wacrm.catalog_product_variants;
create policy catalog_product_variants_update on wacrm.catalog_product_variants
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_product_variants_delete on wacrm.catalog_product_variants;
create policy catalog_product_variants_delete on wacrm.catalog_product_variants
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

comment on table wacrm.catalog_product_variants is
  'Canonical purchasable/rentable variants attached to WA CRM catalogue products.';