-- The protection trigger must run with the caller's role so it can distinguish
-- ordinary authenticated writes from postgres/service_role maintenance.

create or replace function wacrm.protect_system_crm_definition()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if current_user not in ('postgres', 'service_role') then
    if tg_op = 'DELETE' and old.is_system = true then
      raise exception 'System CRM definitions cannot be deleted';
    end if;

    if tg_op = 'UPDATE' and old.is_system = true then
      if new.system_key is distinct from old.system_key
         or new.is_system is distinct from old.is_system
         or new.name is distinct from old.name then
        raise exception 'System CRM definitions cannot be renamed or converted';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

alter function wacrm.protect_system_crm_definition() owner to postgres;
