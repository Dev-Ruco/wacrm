-- Keep type-scoped offering facts valid even when administrators change an
-- offering type or move an attribute definition between types.

create or replace function wacrm.validate_product_offering_type_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if old.offering_type_id is not distinct from new.offering_type_id then
    return new;
  end if;

  if exists (
    select 1
    from wacrm.offering_attribute_values v
    join wacrm.offering_attribute_definitions d
      on d.id = v.definition_id
     and d.account_id = v.account_id
    where v.account_id = new.account_id
      and v.product_id = new.id
      and d.offering_type_id is not null
      and d.offering_type_id is distinct from new.offering_type_id
  ) then
    raise exception 'Existing offering attributes do not apply to the new offering type'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function wacrm.validate_product_offering_type_change() from public;

drop trigger if exists wacrm_validate_product_offering_type_change
  on wacrm.catalog_products;
create trigger wacrm_validate_product_offering_type_change
before update of offering_type_id
on wacrm.catalog_products
for each row execute function wacrm.validate_product_offering_type_change();

create or replace function wacrm.validate_offering_definition_scope_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if old.offering_type_id is not distinct from new.offering_type_id then
    return new;
  end if;

  if new.offering_type_id is not null and exists (
    select 1
    from wacrm.offering_attribute_values v
    join wacrm.catalog_products p
      on p.id = v.product_id
     and p.account_id = v.account_id
    where v.account_id = new.account_id
      and v.definition_id = new.id
      and p.offering_type_id is distinct from new.offering_type_id
  ) then
    raise exception 'Existing values do not belong to the new attribute offering type'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function wacrm.validate_offering_definition_scope_change() from public;

drop trigger if exists wacrm_validate_offering_definition_scope_change
  on wacrm.offering_attribute_definitions;
create trigger wacrm_validate_offering_definition_scope_change
before update of offering_type_id
on wacrm.offering_attribute_definitions
for each row execute function wacrm.validate_offering_definition_scope_change();

-- Replace the atomic save RPC so old type-scoped values are removed before the
-- product type is changed. The whole function still runs as one transaction;
-- any later failure restores the deleted values and original type.
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

  -- Lock/verify the product under the caller's RLS before deleting anything.
  perform 1
  from wacrm.catalog_products
  where id = p_product_id
    and account_id = p_account_id
  for update;

  if not found then
    raise exception 'Offering product not found in account' using errcode = 'P0002';
  end if;

  delete from wacrm.offering_attribute_values
  where account_id = p_account_id
    and product_id = p_product_id;

  update wacrm.catalog_products
  set offering_type_id = p_offering_type_id,
      updated_at = now()
  where id = p_product_id
    and account_id = p_account_id;

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
