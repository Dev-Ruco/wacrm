-- Canonical catalogue ingestion.
--
-- External systems remain sources of truth for their own stock/ERP data, but
-- the agent should ultimately reason over the WA CRM canonical catalogue rather
-- than querying operational databases in the customer-facing critical path.
-- Existing sources keep `live` mode by default, so this migration is backwards
-- compatible until an administrator explicitly switches a source to `mirror`.

alter table wacrm.catalog_sources
  add column if not exists sync_mode text not null default 'live';

alter table wacrm.catalog_sources
  drop constraint if exists catalog_sources_sync_mode_check;
alter table wacrm.catalog_sources
  add constraint catalog_sources_sync_mode_check
  check (sync_mode in ('live', 'mirror'));

alter table wacrm.catalog_sources
  add column if not exists sync_path text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_status text,
  add column if not exists last_sync_error text;

alter table wacrm.catalog_sources
  drop constraint if exists catalog_sources_last_sync_status_check;
alter table wacrm.catalog_sources
  add constraint catalog_sources_last_sync_status_check
  check (last_sync_status is null or last_sync_status in ('running', 'succeeded', 'failed'));

create unique index if not exists catalog_sources_id_account_unique_idx
  on wacrm.catalog_sources (id, account_id);

-- Source records are provenance/mapping records, not a second product catalogue.
-- They let a new external snapshot update the same canonical product without
-- trusting mutable names or generating duplicate products.
create table if not exists wacrm.catalog_source_records (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  source_id uuid not null,
  external_id text not null check (char_length(external_id) between 1 and 500),
  product_id uuid not null,
  normalized_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(normalized_payload) = 'object'),
  content_hash text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  missing_since timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_source_records_source_fk
    foreign key (source_id, account_id)
    references wacrm.catalog_sources(id, account_id)
    on delete cascade,
  constraint catalog_source_records_product_fk
    foreign key (product_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint catalog_source_records_source_external_unique
    unique (source_id, external_id),
  constraint catalog_source_records_source_product_unique
    unique (source_id, product_id)
);

create table if not exists wacrm.catalog_sync_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  source_id uuid not null,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  trigger_type text not null default 'manual'
    check (trigger_type in ('manual', 'scheduled', 'system')),
  fetched_count integer not null default 0 check (fetched_count >= 0),
  created_count integer not null default 0 check (created_count >= 0),
  updated_count integer not null default 0 check (updated_count >= 0),
  unchanged_count integer not null default 0 check (unchanged_count >= 0),
  missing_count integer not null default 0 check (missing_count >= 0),
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint catalog_sync_runs_source_fk
    foreign key (source_id, account_id)
    references wacrm.catalog_sources(id, account_id)
    on delete cascade
);

create index if not exists catalog_source_records_account_source_idx
  on wacrm.catalog_source_records (account_id, source_id, last_seen_at desc);
create index if not exists catalog_source_records_product_idx
  on wacrm.catalog_source_records (account_id, product_id);
create index if not exists catalog_sync_runs_account_source_idx
  on wacrm.catalog_sync_runs (account_id, source_id, started_at desc);

-- Enforce tenant-safe source assignment for canonical products. The historical
-- single-column FK may coexist; this composite FK adds the account invariant.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'catalog_products_source_account_fk'
      and conrelid = 'wacrm.catalog_products'::regclass
  ) then
    alter table wacrm.catalog_products
      add constraint catalog_products_source_account_fk
      foreign key (source_id, account_id)
      references wacrm.catalog_sources(id, account_id)
      on delete set null;
  end if;
end $$;

drop trigger if exists set_updated_at on wacrm.catalog_source_records;
create trigger set_updated_at
before update on wacrm.catalog_source_records
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.catalog_source_records enable row level security;
alter table wacrm.catalog_sync_runs enable row level security;

revoke all on table wacrm.catalog_source_records from public, anon;
revoke all on table wacrm.catalog_sync_runs from public, anon;
grant select, insert, update, delete on table wacrm.catalog_source_records to authenticated;
grant select, insert, update, delete on table wacrm.catalog_sync_runs to authenticated;
grant all on table wacrm.catalog_source_records to service_role;
grant all on table wacrm.catalog_sync_runs to service_role;

drop policy if exists catalog_source_records_select on wacrm.catalog_source_records;
create policy catalog_source_records_select on wacrm.catalog_source_records
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_source_records_insert on wacrm.catalog_source_records;
create policy catalog_source_records_insert on wacrm.catalog_source_records
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_source_records_update on wacrm.catalog_source_records;
create policy catalog_source_records_update on wacrm.catalog_source_records
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_source_records_delete on wacrm.catalog_source_records;
create policy catalog_source_records_delete on wacrm.catalog_source_records
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists catalog_sync_runs_select on wacrm.catalog_sync_runs;
create policy catalog_sync_runs_select on wacrm.catalog_sync_runs
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_sync_runs_insert on wacrm.catalog_sync_runs;
create policy catalog_sync_runs_insert on wacrm.catalog_sync_runs
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_sync_runs_update on wacrm.catalog_sync_runs;
create policy catalog_sync_runs_update on wacrm.catalog_sync_runs
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_sync_runs_delete on wacrm.catalog_sync_runs;
create policy catalog_sync_runs_delete on wacrm.catalog_sync_runs
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

comment on table wacrm.catalog_source_records is
  'Provenance map from an external source record to its canonical WA CRM catalogue product.';
comment on table wacrm.catalog_sync_runs is
  'Observable source-to-canonical catalogue ingestion runs.';