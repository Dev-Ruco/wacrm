-- Atomically replace one internal offering's type and structured facts.
-- Validation of value semantics happens in the application before this RPC;
-- database FKs, RLS and the context trigger remain the final authority. If any
-- insert fails, PostgreSQL rolls back the product type update and deletion too.

create or replace function wacrm.replace_product_offering_attributes(
  p_account_id uuid,
  p_product_id uuid,
  p_offering_type_id uuid,
  p_values jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $function$
begin
  if p_values is null then
    p_values := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_values) <> 'array' then
    raise exception 'p_values must be a JSON array' using errcode = '22023';
  end if;

  update wacrm.catalog_products
  set offering_type_id = p_offering_type_id,
      updated_at = now()
  where id = p_product_id
    and account_id = p_account_id;

  if not found then
    raise exception 'Offering product not found in account' using errcode = 'P0002';
  end if;

  delete from wacrm.offering_attribute_values
  where account_id = p_account_id
    and product_id = p_product_id;

  insert into wacrm.offering_attribute_values (
    account_id,
    product_id,
    definition_id,
    value_key,
    value,
    source,
    confidence,
    verified
  )
  select
    p_account_id,
    p_product_id,
    parsed.definition_id,
    parsed.value_key,
    parsed.value,
    coalesce(parsed.source, 'manual'),
    parsed.confidence,
    coalesce(parsed.verified, false)
  from jsonb_to_recordset(p_values) as parsed(
    definition_id uuid,
    value_key text,
    value jsonb,
    source text,
    confidence numeric,
    verified boolean
  );
end;
$function$;

revoke all on function wacrm.replace_product_offering_attributes(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function wacrm.replace_product_offering_attributes(uuid, uuid, uuid, jsonb) to authenticated, service_role;
