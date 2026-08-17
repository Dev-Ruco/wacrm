-- Ensure every agent created after rollout receives both the journey classifier
-- and the duplicate-deal guard, not only agents that existed during migration.

create or replace function wacrm.enable_journey_tool_for_new_agent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_add_tag_instruction text := $instruction$
CUSTOMER JOURNEY (mandatory CRM hygiene): after each substantive customer turn, classify the customer's current stage by calling add_tag with exactly one configured "Etapa · ..." tag whenever the stage changes. Never invent a stage or advance it without evidence. The CRM automatically replaces the previous journey-stage tag and synchronises the system commercial pipeline. Semantic system tags may also be added when clearly supported. Never assign Cliente VIP subjectively.
$instruction$;
  v_create_deal_instruction text := $instruction$
CUSTOMER JOURNEY DEAL SAFETY: the system journey classifier automatically creates or moves the current open deal when an "Etapa · ..." commercial-stage tag is applied. Do NOT call create_deal merely because you have just classified the customer as a lead, interested, negotiating or awaiting payment. Use create_deal only when the conversation clearly represents a distinct parallel commercial opportunity that must coexist with the current one.
$instruction$;
begin
  insert into wacrm.agent_tools (
    account_id,
    agent_id,
    tool_key,
    enabled,
    instructions
  ) values (
    new.account_id,
    new.id,
    'add_tag',
    true,
    v_add_tag_instruction
  )
  on conflict (agent_id, tool_key)
  do update set
    enabled = true,
    instructions = case
      when coalesce(wacrm.agent_tools.instructions, '')
        like '%CUSTOMER JOURNEY (mandatory CRM hygiene)%'
        then wacrm.agent_tools.instructions
      when nullif(btrim(coalesce(wacrm.agent_tools.instructions, '')), '') is null
        then excluded.instructions
      else wacrm.agent_tools.instructions || E'\n\n' || excluded.instructions
    end,
    updated_at = now();

  insert into wacrm.agent_tools (
    account_id,
    agent_id,
    tool_key,
    enabled,
    instructions
  ) values (
    new.account_id,
    new.id,
    'create_deal',
    false,
    v_create_deal_instruction
  )
  on conflict (agent_id, tool_key)
  do update set
    instructions = case
      when coalesce(wacrm.agent_tools.instructions, '')
        like '%CUSTOMER JOURNEY DEAL SAFETY:%'
        then wacrm.agent_tools.instructions
      when nullif(btrim(coalesce(wacrm.agent_tools.instructions, '')), '') is null
        then excluded.instructions
      else wacrm.agent_tools.instructions || E'\n\n' || excluded.instructions
    end,
    updated_at = now();

  return new;
end;
$function$;

alter function wacrm.enable_journey_tool_for_new_agent() owner to postgres;
revoke all on function wacrm.enable_journey_tool_for_new_agent()
  from public, anon, authenticated;
grant execute on function wacrm.enable_journey_tool_for_new_agent() to service_role;
