-- Keep Skill tool validation aligned with the executable AI tool registry.
-- Must run before 20260818083000_agent_operational_toolkit.sql seeds
-- standard Skills that reference the newer operational capabilities.

alter table wacrm.skills
  drop constraint if exists skills_tool_keys_check;

alter table wacrm.skills
  add constraint skills_tool_keys_check
  check (
    tool_keys <@ array[
      'search_catalog',
      'send_product',
      'compose_solution',
      'search_knowledge',
      'add_tag',
      'create_deal',
      'schedule_visit',
      'get_style_opinion',
      'handoff_human',
      'check_availability',
      'create_order',
      'get_order_status',
      'update_contact'
    ]::text[]
  );
