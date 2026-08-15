-- Enforce that a type-scoped attribute can only be attached to a product of
-- that offering type. Global attributes (offering_type_id is null) remain valid
-- for every internal offering in the tenant.

create or replace function wacrm.validate_offering_attribute_value_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_definition_type uuid;
  v_product_type uuid;
begin
  select d.offering_type_id
    into v_definition_type
  from wacrm.offering_attribute_definitions d
  where d.id = new.definition_id
    and d.account_id = new.account_id;

  if not found then
    raise exception 'Offering attribute definition does not belong to the account'
      using errcode = '23503';
  end if;

  select p.offering_type_id
    into v_product_type
  from wacrm.catalog_products p
  where p.id = new.product_id
    and p.account_id = new.account_id;

  if not found then
    raise exception 'Offering product does not belong to the account'
      using errcode = '23503';
  end if;

  if v_definition_type is not null and v_product_type is distinct from v_definition_type then
    raise exception 'Offering attribute does not apply to this offering type'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function wacrm.validate_offering_attribute_value_context() from public;

drop trigger if exists wacrm_validate_offering_attribute_value_context
  on wacrm.offering_attribute_values;
create trigger wacrm_validate_offering_attribute_value_context
before insert or update of account_id, product_id, definition_id
on wacrm.offering_attribute_values
for each row execute function wacrm.validate_offering_attribute_value_context();
