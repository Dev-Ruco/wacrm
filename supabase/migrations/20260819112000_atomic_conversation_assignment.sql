-- Atomic conversation assignment inside one tenant.
--
-- Prevents two operators (or AI + operator) from silently overwriting each
-- other when they assign the same conversation at nearly the same time.
-- The caller supplies the assignee state it observed; the UPDATE wins only
-- while that state is still current.

create or replace function wacrm.assign_conversation_if_current(
  p_account_id uuid,
  p_conversation_id uuid,
  p_expected_assignee_id uuid,
  p_new_assignee_id uuid
)
returns table(
  applied boolean,
  assigned_agent_id uuid,
  conflict boolean
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_current_assignee uuid;
  v_role text;
  v_caller_role text;
  v_rowcount integer;
begin
  -- Authenticated callers must be operational account members. service_role
  -- is used by server-side AI/automation paths and is allowed explicitly.
  if auth.role() <> 'service_role' then
    if auth.uid() is null then
      raise exception 'not authorized to assign conversations'
        using errcode = '42501';
    end if;

    select p.account_role::text
      into v_caller_role
    from wacrm.profiles p
    where p.user_id = auth.uid()
      and p.account_id = p_account_id;

    if v_caller_role is null or v_caller_role not in ('owner', 'admin', 'agent') then
      raise exception 'not authorized to assign conversations'
        using errcode = '42501';
    end if;
  end if;

  -- The target, when present, must be an eligible teammate in THIS account.
  -- Viewer remains read-only and can never become an assignee.
  if p_new_assignee_id is not null then
    select p.account_role::text
      into v_role
    from wacrm.profiles p
    where p.user_id = p_new_assignee_id
      and p.account_id = p_account_id;

    if v_role is null or v_role not in ('owner', 'admin', 'agent') then
      raise exception 'assignee is not an eligible member of this account'
        using errcode = '23514';
    end if;
  end if;

  -- Compare-and-swap. `IS NOT DISTINCT FROM` makes NULL a real expected
  -- value, so two simultaneous claims of an unassigned conversation cannot
  -- both succeed.
  update wacrm.conversations c
  set assigned_agent_id = p_new_assignee_id,
      updated_at = now()
  where c.id = p_conversation_id
    and c.account_id = p_account_id
    and c.assigned_agent_id is not distinct from p_expected_assignee_id;

  get diagnostics v_rowcount = row_count;

  if v_rowcount = 1 then
    return query
      select true, p_new_assignee_id, false;
    return;
  end if;

  -- Distinguish a stale view from a missing/cross-tenant conversation without
  -- leaking another tenant: both resolve through this account-scoped lookup.
  select c.assigned_agent_id
    into v_current_assignee
  from wacrm.conversations c
  where c.id = p_conversation_id
    and c.account_id = p_account_id;

  if not found then
    raise exception 'conversation not found in account'
      using errcode = 'P0002';
  end if;

  return query
    select false, v_current_assignee, true;
end;
$$;

revoke all on function wacrm.assign_conversation_if_current(uuid, uuid, uuid, uuid)
  from public, anon;
grant execute on function wacrm.assign_conversation_if_current(uuid, uuid, uuid, uuid)
  to authenticated, service_role;

comment on function wacrm.assign_conversation_if_current(uuid, uuid, uuid, uuid) is
  'Tenant-scoped compare-and-swap assignment. Succeeds only while assigned_agent_id still matches the caller observed value.';

-- AI handoff is a second assignment writer: after tool reasoning it may try to
-- assign the configured fallback/specialist. If a human has claimed the row in
-- the meantime, preserve the human assignment atomically instead of letting the
-- later AI UPDATE overwrite it. This trigger is deliberately narrow: it only
-- acts on the UPDATE that advances ai_handoff_at.
create or replace function wacrm.protect_ai_handoff_assignment_race()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.ai_handoff_at is distinct from old.ai_handoff_at
     and old.assigned_agent_id is not null
     and new.assigned_agent_id is distinct from old.assigned_agent_id then
    new.assigned_agent_id := old.assigned_agent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_ai_handoff_assignment_race
  on wacrm.conversations;
create trigger protect_ai_handoff_assignment_race
before update of ai_handoff_at, assigned_agent_id on wacrm.conversations
for each row execute function wacrm.protect_ai_handoff_assignment_race();

comment on function wacrm.protect_ai_handoff_assignment_race() is
  'Prevents an AI handoff UPDATE from overwriting a human assignment that won the row first.';
