-- Keep the system journey coherent when a human moves a deal manually.
-- The forward direction (journey tag -> deal) is handled by the previous
-- migration. pg_trigger_depth() prevents that internal update from bouncing
-- back and replacing richer journey stages such as Recompra.

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

  if v_pipeline_key <> 'sales_journey' then
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
revoke all on function wacrm.sync_customer_journey_from_deal() from public, anon;

drop trigger if exists wacrm_sync_customer_journey_from_deal on wacrm.deals;
create trigger wacrm_sync_customer_journey_from_deal
after update of stage_id, status on wacrm.deals
for each row execute function wacrm.sync_customer_journey_from_deal();

-- Temperature is a classification, not an accumulating history. If the agent
-- upgrades/downgrades it, keep only the latest temperature tag visible.
create or replace function wacrm.enforce_single_system_tag_group()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_tag wacrm.tags%rowtype;
begin
  select * into v_tag from wacrm.tags where id = new.tag_id;

  if found and v_tag.is_system = true and v_tag.system_group = 'temperature' then
    delete from wacrm.contact_tags ct
    using wacrm.tags old_tag
    where ct.contact_id = new.contact_id
      and ct.id <> new.id
      and ct.tag_id = old_tag.id
      and old_tag.account_id = v_tag.account_id
      and old_tag.is_system = true
      and old_tag.system_group = 'temperature';
  end if;

  return new;
end;
$function$;

alter function wacrm.enforce_single_system_tag_group() owner to postgres;
revoke all on function wacrm.enforce_single_system_tag_group() from public, anon;

drop trigger if exists wacrm_enforce_single_system_tag_group on wacrm.contact_tags;
create trigger wacrm_enforce_single_system_tag_group
after insert on wacrm.contact_tags
for each row execute function wacrm.enforce_single_system_tag_group();
