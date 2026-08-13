-- Generic, tenant-scoped operational state for one live conversation.
-- Separate from durable contact memory and catalogue-specific state.

create table if not exists wacrm.conversation_working_state (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  conversation_id uuid not null references wacrm.conversations(id) on delete cascade,
  current_goal text,
  constraints jsonb not null default '{}'::jsonb,
  preferences jsonb not null default '{}'::jsonb,
  exclusions jsonb not null default '{}'::jsonb,
  selected_entity jsonb,
  pending_question text,
  status text not null default 'active'
    check (status in ('active', 'waiting_customer', 'resolved')),
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, conversation_id)
);

create index if not exists conversation_working_state_account_idx
  on wacrm.conversation_working_state(account_id);
create index if not exists conversation_working_state_conversation_idx
  on wacrm.conversation_working_state(conversation_id);

alter table wacrm.conversation_working_state enable row level security;
grant select, insert, update, delete on wacrm.conversation_working_state to service_role;

comment on table wacrm.conversation_working_state is
  'Current operational conversation state maintained by the AI runtime; not durable customer memory.';
