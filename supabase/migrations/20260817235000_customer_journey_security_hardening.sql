-- Final hardening for the customer journey feature.

-- Seeding is an internal maintenance operation. Triggers and service_role can
-- run it; ordinary authenticated users only need to read/use the seeded data.
revoke execute on function wacrm.seed_customer_journey_defaults(uuid) from authenticated;
grant execute on function wacrm.seed_customer_journey_defaults(uuid) to service_role;

create or replace function wacrm.sync_customer_journey_from_deal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_pipeline_key text;
  v_pipeline_stage_key text;
  v_stage_key text;
  v_tag_id uuid;
begin
  if pg_trigger_depth() > 1 or new.contact_id is null then
    return new;
  end if;

  select p.system_key into v_pipeline_key
  from wacrm.pipelines p
  where p.id = new.pipeline_id
    and p.account_id = new.account_id;

  if v_pipeline_key is distinct from 'sales_journey' then
    return new;
  end if;

  if new.status = 'won' and old.status is distinct from new.status then
    v_stage_key := 'sale_completed';
  elsif new.status = 'lost' and old.status is distinct from new.status then
    v_stage_key := 'lost';
  elsif old.stage_id is distinct from new.stage_id then
    select ps.system_key into v_pipeline_stage_key
    from wacrm.pipeline_stages ps
    where ps.id = new.stage_id
      and ps.pipeline_id = new.pipeline_id;

    v_stage_key := case v_pipeline_stage_key
      when 'new_lead' then 'need_identified'
      when 'qualified' then 'lead_qualified'
      when 'interest' then 'interest_confirmed'
      when 'proposal' then 'price_presented'
      when 'negotiation' then 'negotiating'
      when 'payment' then 'payment_pending'
      else null
    end;
  else
    return new;
  end if;

  if v_stage_key is null then
    return new;
  end if;

  select t.id into v_tag_id
  from wacrm.tags t
  where t.account_id = new.account_id
    and t.system_key = 'journey.' || v_stage_key
    and t.is_system = true
  limit 1;

  if v_tag_id is not null then
    insert into wacrm.contact_tags (contact_id, tag_id)
    values (new.contact_id, v_tag_id)
    on conflict (contact_id, tag_id) do nothing;
  end if;

  return new;
end;
$function$;

alter function wacrm.sync_customer_journey_from_deal() owner to postgres;
revoke all on function wacrm.sync_customer_journey_from_deal() from public, anon, authenticated;
grant execute on function wacrm.sync_customer_journey_from_deal() to service_role;
