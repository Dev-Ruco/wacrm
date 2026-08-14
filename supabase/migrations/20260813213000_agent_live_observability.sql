-- Real execution observability for the existing agent trace/run.
-- agent_traces remains the canonical one-row-per-turn/run record.

alter table wacrm.agent_traces
  add column if not exists status text,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists inbound_message_id text,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Historical rows were persisted only after the turn finished. Backfill only
-- rows that have never received the new lifecycle status, so a manual re-run
-- cannot turn a current live run into a historical one.
update wacrm.agent_traces
set
  status = case
    when cardinality(coalesce(guardrail_violations, '{}'::text[])) > 0 then 'blocked'
    when final_action = 'handoff' then 'handoff'
    else 'completed'
  end,
  started_at = created_at - make_interval(
    secs => greatest(coalesce(total_ms, 0), 0)::double precision / 1000.0
  ),
  finished_at = created_at,
  updated_at = created_at
where status is null;

alter table wacrm.agent_traces
  alter column status set default 'running',
  alter column status set not null,
  alter column started_at set default now(),
  alter column started_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column final_action set default 'no_reply';

alter table wacrm.agent_traces
  drop constraint if exists agent_traces_status_check;
alter table wacrm.agent_traces
  add constraint agent_traces_status_check
  check (status in ('running', 'completed', 'failed', 'blocked', 'handoff'));

create table if not exists wacrm.agent_trace_steps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  trace_id uuid not null references wacrm.agent_traces(id) on delete cascade,
  sequence integer not null check (sequence >= 0),
  type text not null,
  label text not null,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'blocked')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trace_id, sequence)
);

create index if not exists agent_trace_steps_account_created_idx
  on wacrm.agent_trace_steps (account_id, created_at desc);
create index if not exists agent_trace_steps_trace_sequence_idx
  on wacrm.agent_trace_steps (trace_id, sequence);

alter table wacrm.agent_trace_steps enable row level security;

revoke all on table wacrm.agent_trace_steps from public, anon;
grant select on table wacrm.agent_trace_steps to authenticated;
grant all on table wacrm.agent_trace_steps to service_role;

drop policy if exists agent_trace_steps_select on wacrm.agent_trace_steps;
create policy agent_trace_steps_select
on wacrm.agent_trace_steps
for select
to authenticated
using (wacrm.is_account_member(account_id));

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'wacrm'
      and tablename = 'agent_traces'
  ) then
    alter publication supabase_realtime add table wacrm.agent_traces;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'wacrm'
      and tablename = 'agent_trace_steps'
  ) then
    alter publication supabase_realtime add table wacrm.agent_trace_steps;
  end if;
end $$;

comment on table wacrm.agent_trace_steps is
  'Privacy-reduced, tenant-scoped observable execution steps for one agent trace/run. Never store chain-of-thought or secrets.';
