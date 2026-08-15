-- Human-reviewed catalogue stewardship queue.
-- AI/import jobs may propose corrections, but proposals never overwrite trusted
-- catalogue facts automatically. Administrators explicitly approve/reject them.

create table if not exists wacrm.catalog_steward_suggestions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  product_id uuid,
  source_id uuid,
  issue_type text not null check (char_length(issue_type) between 1 and 80),
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'critical')),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  proposed_changes jsonb not null default '{}'::jsonb
    check (jsonb_typeof(proposed_changes) = 'object'),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'superseded')),
  created_by text not null default 'system'
    check (created_by in ('system', 'ai', 'import')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_steward_suggestions_product_fk
    foreign key (product_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint catalog_steward_suggestions_source_fk
    foreign key (source_id, account_id)
    references wacrm.catalog_sources(id, account_id)
    on delete cascade
);

create index if not exists catalog_steward_suggestions_pending_idx
  on wacrm.catalog_steward_suggestions (account_id, status, severity, created_at desc);
create index if not exists catalog_steward_suggestions_product_idx
  on wacrm.catalog_steward_suggestions (account_id, product_id, status);

-- One unresolved suggestion of the same issue per product/source. Nulls are
-- deliberately normalised so account-level/source-level health issues dedupe.
create unique index if not exists catalog_steward_suggestions_open_unique_idx
  on wacrm.catalog_steward_suggestions (
    account_id,
    coalesce(product_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(source_id, '00000000-0000-0000-0000-000000000000'::uuid),
    issue_type
  )
  where status = 'pending';

drop trigger if exists set_updated_at on wacrm.catalog_steward_suggestions;
create trigger set_updated_at
before update on wacrm.catalog_steward_suggestions
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.catalog_steward_suggestions enable row level security;
revoke all on table wacrm.catalog_steward_suggestions from public, anon;
grant select, insert, update, delete on table wacrm.catalog_steward_suggestions to authenticated;
grant all on table wacrm.catalog_steward_suggestions to service_role;

drop policy if exists catalog_steward_suggestions_select on wacrm.catalog_steward_suggestions;
create policy catalog_steward_suggestions_select on wacrm.catalog_steward_suggestions
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists catalog_steward_suggestions_insert on wacrm.catalog_steward_suggestions;
create policy catalog_steward_suggestions_insert on wacrm.catalog_steward_suggestions
for insert to authenticated with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_steward_suggestions_update on wacrm.catalog_steward_suggestions;
create policy catalog_steward_suggestions_update on wacrm.catalog_steward_suggestions
for update to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
drop policy if exists catalog_steward_suggestions_delete on wacrm.catalog_steward_suggestions;
create policy catalog_steward_suggestions_delete on wacrm.catalog_steward_suggestions
for delete to authenticated using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

comment on table wacrm.catalog_steward_suggestions is
  'Human-review queue for catalogue quality corrections; proposals do not mutate trusted facts automatically.';