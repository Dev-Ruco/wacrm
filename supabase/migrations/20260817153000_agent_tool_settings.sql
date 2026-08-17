-- Structured per-tool settings. Keep free-text instructions separate from
-- machine-enforced runtime configuration such as visual catalogue matching.

alter table wacrm.agent_tools
  add column if not exists settings jsonb not null default '{}'::jsonb;

update wacrm.agent_tools
set settings = '{}'::jsonb
where settings is null;

alter table wacrm.agent_tools
  alter column settings set default '{}'::jsonb,
  alter column settings set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agent_tools_settings_object_check'
      and conrelid = 'wacrm.agent_tools'::regclass
  ) then
    alter table wacrm.agent_tools
      add constraint agent_tools_settings_object_check
      check (jsonb_typeof(settings) = 'object');
  end if;
end $$;
