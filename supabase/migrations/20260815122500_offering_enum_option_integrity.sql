-- Ensure enum option vocabularies are deterministic. The agent normalises
-- punctuation/case/Portuguese diacritics when resolving customer language, so
-- two different canonical options must never claim the same normalised term.

create or replace function wacrm.normalize_offering_term(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $function$
  select btrim(
    regexp_replace(
      translate(
        lower(coalesce(p_value, '')),
        'áàâãäéèêëíìîïóòôõöúùûüçñ',
        'aaaaaeeeeiiiiooooouuuucn'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$function$;

revoke all on function wacrm.normalize_offering_term(text) from public;
grant execute on function wacrm.normalize_offering_term(text) to authenticated, service_role;

create or replace function wacrm.validate_offering_enum_options()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_option jsonb;
  v_alias jsonb;
  v_term text;
  v_normalised text;
  v_canonical text;
  v_seen jsonb := '{}'::jsonb;
begin
  if new.value_type <> 'enum' then
    if new.options <> '[]'::jsonb then
      raise exception 'Only enum offering attributes may define options'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if jsonb_typeof(new.options) <> 'array' or jsonb_array_length(new.options) = 0 then
    raise exception 'Enum offering attributes require at least one option'
      using errcode = '23514';
  end if;

  for v_option in select value from jsonb_array_elements(new.options)
  loop
    if jsonb_typeof(v_option) <> 'object' then
      raise exception 'Each enum option must be an object' using errcode = '23514';
    end if;

    v_canonical := wacrm.normalize_offering_term(v_option->>'value');
    if v_canonical = '' then
      raise exception 'Each enum option requires a non-empty value' using errcode = '23514';
    end if;

    if v_option ? 'aliases'
       and v_option->'aliases' is not null
       and jsonb_typeof(v_option->'aliases') <> 'array' then
      raise exception 'Enum option aliases must be an array' using errcode = '23514';
    end if;

    -- Canonical value and label are both customer-facing lookup terms.
    foreach v_term in array array[
      v_option->>'value',
      coalesce(v_option->>'label', v_option->>'value')
    ]
    loop
      v_normalised := wacrm.normalize_offering_term(v_term);
      if v_normalised <> '' then
        if v_seen ? v_normalised and v_seen->>v_normalised <> v_canonical then
          raise exception 'Ambiguous enum term "%" maps to multiple options', v_term
            using errcode = '23514';
        end if;
        v_seen := jsonb_set(v_seen, array[v_normalised], to_jsonb(v_canonical), true);
      end if;
    end loop;

    if jsonb_typeof(coalesce(v_option->'aliases', '[]'::jsonb)) = 'array' then
      for v_alias in select value from jsonb_array_elements(coalesce(v_option->'aliases', '[]'::jsonb))
      loop
        if jsonb_typeof(v_alias) <> 'string' then
          raise exception 'Enum aliases must be strings' using errcode = '23514';
        end if;
        v_term := v_alias #>> '{}';
        v_normalised := wacrm.normalize_offering_term(v_term);
        if v_normalised <> '' then
          if v_seen ? v_normalised and v_seen->>v_normalised <> v_canonical then
            raise exception 'Ambiguous enum alias "%" maps to multiple options', v_term
              using errcode = '23514';
          end if;
          v_seen := jsonb_set(v_seen, array[v_normalised], to_jsonb(v_canonical), true);
        end if;
      end loop;
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function wacrm.validate_offering_enum_options() from public;

drop trigger if exists wacrm_validate_offering_enum_options
  on wacrm.offering_attribute_definitions;
create trigger wacrm_validate_offering_enum_options
before insert or update of value_type, options
on wacrm.offering_attribute_definitions
for each row execute function wacrm.validate_offering_enum_options();
