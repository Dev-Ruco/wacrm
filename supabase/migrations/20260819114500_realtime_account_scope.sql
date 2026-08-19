-- Explicit tenant key for Realtime message subscriptions.
--
-- conversations and notifications already carry account_id, but messages were
-- historically scoped only through conversation_id + RLS. Realtime filters are
-- more robust and cheaper when the tenant key exists on the published row.

alter table wacrm.messages
  add column if not exists account_id uuid references wacrm.accounts(id) on delete cascade;

-- Backfill from the parent conversation. The relationship is already the source
-- of truth for message tenancy in existing RLS policies.
update wacrm.messages m
set account_id = c.account_id
from wacrm.conversations c
where c.id = m.conversation_id
  and m.account_id is null;

-- Fail loudly rather than leaving an unscoped message behind if historic data
-- contains an orphan that somehow survived the conversation FK.
do $$
begin
  if exists (select 1 from wacrm.messages where account_id is null) then
    raise exception 'cannot enforce messages.account_id: unscoped rows remain';
  end if;
end;
$$;

alter table wacrm.messages
  alter column account_id set not null;

create index if not exists messages_account_created_idx
  on wacrm.messages(account_id, created_at desc);

-- Derive and enforce the tenant key in the database so every current and future
-- insert path (webhook, website chat, automation, human send, AI send) stays
-- correct without relying on each application caller to remember account_id.
create or replace function wacrm.enforce_message_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_account_id uuid;
begin
  select c.account_id
    into v_account_id
  from wacrm.conversations c
  where c.id = new.conversation_id;

  if v_account_id is null then
    raise exception 'message conversation does not exist'
      using errcode = '23503';
  end if;

  if new.account_id is null then
    new.account_id := v_account_id;
  elsif new.account_id <> v_account_id then
    raise exception 'message account does not match conversation account'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_message_account on wacrm.messages;
create trigger enforce_message_account
before insert or update of conversation_id, account_id on wacrm.messages
for each row execute function wacrm.enforce_message_account();

-- Keep RLS as the hard boundary, now using the direct tenant key instead of a
-- parent-table EXISTS lookup. service_role continues to bypass RLS normally.
drop policy if exists messages_select on wacrm.messages;
create policy messages_select
on wacrm.messages
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists messages_modify on wacrm.messages;
create policy messages_modify
on wacrm.messages
for all
to authenticated
using (wacrm.is_account_member(account_id, 'agent'))
with check (wacrm.is_account_member(account_id, 'agent'));

comment on column wacrm.messages.account_id is
  'Direct tenant key mirrored from conversations.account_id for RLS and explicit Realtime filtering.';
comment on function wacrm.enforce_message_account() is
  'Derives messages.account_id from conversation_id and rejects cross-tenant mismatches.';
