-- Follow-up hardening for the operational toolkit.
-- Keeps telemetry compatible with every implemented tool and ensures that an
-- exception/window attached to either the offering OR its resource is honoured
-- when callers provide both identifiers.

alter table wacrm.agent_tool_calls
  drop constraint if exists agent_tool_calls_tool_key_check;
alter table wacrm.agent_tool_calls
  add constraint agent_tool_calls_tool_key_check check (tool_key in (
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
  ));

create or replace function wacrm.check_operational_availability(
  p_account_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_offering_id uuid default null,
  p_entity_id uuid default null
)
returns table(available boolean, reason text, source text, capacity integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_window record;
  v_exception record;
begin
  if p_ends_at <= p_starts_at then
    return query select false, 'intervalo inválido'::text, 'validation'::text, null::integer;
    return;
  end if;
  if p_offering_id is null and p_entity_id is null then
    return query select false, 'indique uma oferta ou recurso para verificar disponibilidade'::text, 'validation'::text, null::integer;
    return;
  end if;
  if p_offering_id is not null and not exists (
    select 1 from wacrm.catalog_products p
    where p.id = p_offering_id and p.account_id = p_account_id and p.is_active = true
  ) then
    return query select false, 'oferta não encontrada nesta conta'::text, 'validation'::text, null::integer;
    return;
  end if;
  if p_entity_id is not null and not exists (
    select 1 from wacrm.business_entities e
    where e.id = p_entity_id and e.account_id = p_account_id and e.enabled = true
  ) then
    return query select false, 'recurso não encontrado nesta conta'::text, 'validation'::text, null::integer;
    return;
  end if;

  -- A matching unavailable exception on either supplied target wins.
  select e.status, e.capacity, e.reason
    into v_exception
  from wacrm.availability_exceptions e
  where e.account_id = p_account_id
    and e.enabled = true
    and (
      (p_offering_id is not null and e.offering_id = p_offering_id)
      or (p_entity_id is not null and e.entity_id = p_entity_id)
    )
    and e.starts_at < p_ends_at
    and e.ends_at > p_starts_at
    and e.status = 'unavailable'
  order by e.starts_at desc
  limit 1;

  if found then
    return query select false,
      coalesce(v_exception.reason, 'indisponível neste período')::text,
      'exception'::text,
      v_exception.capacity::integer;
    return;
  end if;

  -- An explicit available exception may open the requested interval for
  -- either target, unless an unavailable exception already matched above.
  select e.status, e.capacity, e.reason
    into v_exception
  from wacrm.availability_exceptions e
  where e.account_id = p_account_id
    and e.enabled = true
    and (
      (p_offering_id is not null and e.offering_id = p_offering_id)
      or (p_entity_id is not null and e.entity_id = p_entity_id)
    )
    and e.starts_at <= p_starts_at
    and e.ends_at >= p_ends_at
    and e.status = 'available'
  order by e.starts_at desc
  limit 1;

  if found then
    return query select true,
      coalesce(v_exception.reason, 'disponibilidade excepcional confirmada')::text,
      'exception'::text,
      v_exception.capacity::integer;
    return;
  end if;

  -- A recurring window on either supplied target can establish availability.
  select w.capacity, w.timezone
    into v_window
  from wacrm.availability_windows w
  where w.account_id = p_account_id
    and w.enabled = true
    and (
      (p_offering_id is not null and w.offering_id = p_offering_id)
      or (p_entity_id is not null and w.entity_id = p_entity_id)
    )
    and extract(dow from (p_starts_at at time zone w.timezone))::smallint = w.weekday
    and (w.valid_from is null or (p_starts_at at time zone w.timezone)::date >= w.valid_from)
    and (w.valid_until is null or (p_starts_at at time zone w.timezone)::date <= w.valid_until)
    and (p_starts_at at time zone w.timezone)::time >= w.start_time
    and (p_ends_at at time zone w.timezone)::time <= w.end_time
  order by w.capacity desc nulls last, w.start_time
  limit 1;

  if found then
    return query select true, 'horário disponível'::text, 'recurring_window'::text, v_window.capacity::integer;
  else
    return query select false, 'não existe disponibilidade configurada para este período'::text, 'recurring_window'::text, null::integer;
  end if;
end;
$function$;

revoke all on function wacrm.check_operational_availability(uuid,timestamptz,timestamptz,uuid,uuid) from public, anon;
grant execute on function wacrm.check_operational_availability(uuid,timestamptz,timestamptz,uuid,uuid) to authenticated, service_role;
