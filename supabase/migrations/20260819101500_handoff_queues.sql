-- Specialist handoff routing inside one tenant/account.
--
-- Access role and operational specialty stay separate:
--   profiles.account_role -> authorisation (owner/admin/agent/viewer)
--   handoff queues         -> which subjects a teammate can receive
--
-- A member may belong to multiple queues. Queue membership never grants
-- application permissions. Only members with agent+ are eligible at runtime.

create table if not exists wacrm.handoff_queues (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  routing_key text not null,
  name text not null,
  description text,
  enabled boolean not null default true,
  priority integer not null default 100 check (priority between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handoff_queues_routing_key_format
    check (routing_key ~ '^[a-z0-9][a-z0-9_-]{1,48}$'),
  unique (account_id, routing_key)
);

create index if not exists handoff_queues_account_enabled_idx
  on wacrm.handoff_queues(account_id, enabled, priority, name);

create table if not exists wacrm.handoff_queue_members (
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  queue_id uuid not null references wacrm.handoff_queues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  priority integer not null default 100 check (priority between 1 and 1000),
  created_at timestamptz not null default now(),
  primary key (queue_id, user_id)
);

create index if not exists handoff_queue_members_account_user_idx
  on wacrm.handoff_queue_members(account_id, user_id, enabled);

-- Queue membership must remain inside the same tenant. This is enforced in
-- the database because service-role APIs bypass RLS.
create or replace function wacrm.enforce_handoff_queue_member_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_queue_account uuid;
  v_profile_account uuid;
  v_role text;
begin
  select q.account_id
    into v_queue_account
  from wacrm.handoff_queues q
  where q.id = new.queue_id;

  if v_queue_account is null or v_queue_account <> new.account_id then
    raise exception 'handoff queue does not belong to account'
      using errcode = '23514';
  end if;

  select p.account_id, p.account_role::text
    into v_profile_account, v_role
  from wacrm.profiles p
  where p.user_id = new.user_id;

  if v_profile_account is null or v_profile_account <> new.account_id then
    raise exception 'handoff member does not belong to account'
      using errcode = '23514';
  end if;

  if v_role not in ('owner', 'admin', 'agent') then
    raise exception 'viewer cannot receive handoffs'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists handoff_queue_member_account_guard
  on wacrm.handoff_queue_members;
create trigger handoff_queue_member_account_guard
before insert or update on wacrm.handoff_queue_members
for each row execute function wacrm.enforce_handoff_queue_member_account();

alter table wacrm.handoff_queues enable row level security;
alter table wacrm.handoff_queue_members enable row level security;

revoke all on table wacrm.handoff_queues from public, anon;
revoke all on table wacrm.handoff_queue_members from public, anon;
grant select on table wacrm.handoff_queues to authenticated;
grant select on table wacrm.handoff_queue_members to authenticated;
grant all on table wacrm.handoff_queues to service_role;
grant all on table wacrm.handoff_queue_members to service_role;

drop policy if exists handoff_queues_select on wacrm.handoff_queues;
create policy handoff_queues_select
on wacrm.handoff_queues
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists handoff_queue_members_select on wacrm.handoff_queue_members;
create policy handoff_queue_members_select
on wacrm.handoff_queue_members
for select
to authenticated
using (wacrm.is_account_member(account_id));

comment on table wacrm.handoff_queues is
  'Account-scoped operational queues used to route AI/human handoffs by subject without changing authorization roles.';
comment on table wacrm.handoff_queue_members is
  'Many-to-many assignment of account members to specialist handoff queues; membership never grants app permissions.';
