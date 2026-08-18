-- Reservation/occupancy layer for generic schedule availability.
--
-- This is deliberately separate from recurring availability configuration.
-- Windows/exceptions describe when an offering/resource can operate; these
-- rows describe capacity already consumed by real or provisional bookings.
-- No AI booking capability is enabled by this migration.

create table if not exists wacrm.availability_reservations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  offering_id uuid,
  entity_id uuid,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  contact_id uuid references wacrm.contacts(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  quantity integer not null default 1 check (quantity >= 1),
  status text not null default 'confirmed'
    check (status in ('held', 'confirmed', 'cancelled', 'expired')),
  hold_expires_at timestamptz,
  source text not null default 'manual'
    check (source ~ '^[a-z][a-z0-9_]{0,79}$'),
  external_ref text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint availability_reservations_target_check
    check (offering_id is not null or entity_id is not null),
  constraint availability_reservations_range_check
    check (ends_at > starts_at),
  constraint availability_reservations_hold_expiry_check
    check (status <> 'held' or hold_expires_at is not null),
  constraint availability_reservations_offering_fk
    foreign key (offering_id, account_id)
    references wacrm.catalog_products(id, account_id)
    on delete cascade,
  constraint availability_reservations_entity_fk
    foreign key (entity_id, account_id)
    references wacrm.business_entities(id, account_id)
    on delete cascade
);

create unique index if not exists availability_reservations_external_ref_unique_idx
  on wacrm.availability_reservations (account_id, source, external_ref)
  where external_ref is not null;

create index if not exists availability_reservations_offering_overlap_idx
  on wacrm.availability_reservations (account_id, offering_id, starts_at, ends_at)
  where status in ('held', 'confirmed');

create index if not exists availability_reservations_entity_overlap_idx
  on wacrm.availability_reservations (account_id, entity_id, starts_at, ends_at)
  where status in ('held', 'confirmed');

create index if not exists availability_reservations_hold_expiry_idx
  on wacrm.availability_reservations (account_id, hold_expires_at)
  where status = 'held';

drop trigger if exists set_updated_at on wacrm.availability_reservations;
create trigger set_updated_at
before update on wacrm.availability_reservations
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.availability_reservations enable row level security;
revoke all on table wacrm.availability_reservations from public, anon;
grant select, insert, update, delete on table wacrm.availability_reservations to authenticated;
grant all on table wacrm.availability_reservations to service_role;

-- Account members may inspect occupancy because it drives availability.
-- Only admins may mutate reservations through the browser client. Runtime
-- service-role writes remain possible for a future explicitly enabled booking
-- capability, but no such handler is introduced here.
drop policy if exists availability_reservations_select on wacrm.availability_reservations;
create policy availability_reservations_select
on wacrm.availability_reservations
for select to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists availability_reservations_write on wacrm.availability_reservations;
create policy availability_reservations_write
on wacrm.availability_reservations
for all to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));
