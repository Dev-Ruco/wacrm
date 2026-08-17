-- Lifecycle hygiene for the customer journey classifier.
-- Prevent duplicate AI-created opportunities and keep transient relationship
-- tags consistent when a sale is concluded or a customer returns.

do $block$
declare
  v_instruction text := $instruction$
CUSTOMER JOURNEY DEAL SAFETY: the system journey classifier automatically creates or moves the current open deal when an "Etapa · ..." commercial-stage tag is applied. Do NOT call create_deal merely because you have just classified the customer as a lead, interested, negotiating or awaiting payment. Use create_deal only when the conversation clearly represents a distinct parallel commercial opportunity that must coexist with the current one.
$instruction$;
begin
  update wacrm.agent_tools
  set instructions = case
        when coalesce(instructions, '') like '%CUSTOMER JOURNEY DEAL SAFETY:%' then instructions
        when nullif(btrim(coalesce(instructions, '')), '') is null then v_instruction
        else instructions || E'\n\n' || v_instruction
      end,
      updated_at = now()
  where tool_key = 'create_deal';
end
$block$;

create or replace function wacrm.customer_journey_lifecycle_hygiene()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_tag wacrm.tags%rowtype;
  v_stage_key text;
  v_semantic_tag_id uuid;
  v_won_count integer;
begin
  select * into v_tag
  from wacrm.tags
  where id = new.tag_id;

  if not found
     or v_tag.is_system is distinct from true
     or v_tag.system_group <> 'journey_stage' then
    return new;
  end if;

  v_stage_key := replace(v_tag.system_key, 'journey.', '');

  if v_stage_key = 'payment_pending' then
    select t.id into v_semantic_tag_id
    from wacrm.tags t
    where t.account_id = v_tag.account_id
      and t.system_key = 'purchase.payment_pending'
    limit 1;

    if v_semantic_tag_id is not null then
      insert into wacrm.contact_tags (contact_id, tag_id)
      values (new.contact_id, v_semantic_tag_id)
      on conflict (contact_id, tag_id) do nothing;
    end if;
  end if;

  if v_stage_key in ('sale_completed', 'lost', 'post_sale', 'repeat_purchase') then
    delete from wacrm.contact_tags ct
    using wacrm.tags t
    where ct.contact_id = new.contact_id
      and ct.tag_id = t.id
      and t.account_id = v_tag.account_id
      and t.system_key = 'purchase.payment_pending';
  end if;

  if v_stage_key = 'sale_completed' then
    select count(*)::integer into v_won_count
    from wacrm.deals d
    where d.account_id = v_tag.account_id
      and d.contact_id = new.contact_id
      and d.status = 'won';

    if v_won_count > 1 then
      delete from wacrm.contact_tags ct
      using wacrm.tags t
      where ct.contact_id = new.contact_id
        and ct.tag_id = t.id
        and t.account_id = v_tag.account_id
        and t.system_key = 'relationship.new_customer';

      select t.id into v_semantic_tag_id
      from wacrm.tags t
      where t.account_id = v_tag.account_id
        and t.system_key = 'relationship.returning_customer'
      limit 1;
    else
      select t.id into v_semantic_tag_id
      from wacrm.tags t
      where t.account_id = v_tag.account_id
        and t.system_key = 'relationship.new_customer'
      limit 1;
    end if;

    if v_semantic_tag_id is not null then
      insert into wacrm.contact_tags (contact_id, tag_id)
      values (new.contact_id, v_semantic_tag_id)
      on conflict (contact_id, tag_id) do nothing;
    end if;
  elsif v_stage_key = 'repeat_purchase' then
    delete from wacrm.contact_tags ct
    using wacrm.tags t
    where ct.contact_id = new.contact_id
      and ct.tag_id = t.id
      and t.account_id = v_tag.account_id
      and t.system_key = 'relationship.new_customer';

    select t.id into v_semantic_tag_id
    from wacrm.tags t
    where t.account_id = v_tag.account_id
      and t.system_key = 'relationship.returning_customer'
    limit 1;

    if v_semantic_tag_id is not null then
      insert into wacrm.contact_tags (contact_id, tag_id)
      values (new.contact_id, v_semantic_tag_id)
      on conflict (contact_id, tag_id) do nothing;
    end if;

    select t.id into v_semantic_tag_id
    from wacrm.tags t
    where t.account_id = v_tag.account_id
      and t.system_key = 'purchase.repeat'
    limit 1;

    if v_semantic_tag_id is not null then
      insert into wacrm.contact_tags (contact_id, tag_id)
      values (new.contact_id, v_semantic_tag_id)
      on conflict (contact_id, tag_id) do nothing;
    end if;
  end if;

  return new;
end;
$function$;

alter function wacrm.customer_journey_lifecycle_hygiene() owner to postgres;
revoke all on function wacrm.customer_journey_lifecycle_hygiene() from public, anon;

-- PostgreSQL executes same-event triggers in name order. This trigger is named
-- after the canonical sync trigger so sale_completed has already marked the
-- deal as won before customer status is derived.
drop trigger if exists zz_wacrm_customer_journey_lifecycle_hygiene on wacrm.contact_tags;
create trigger zz_wacrm_customer_journey_lifecycle_hygiene
after insert on wacrm.contact_tags
for each row execute function wacrm.customer_journey_lifecycle_hygiene();

-- If a human manually closes/moves a system-pipeline deal, make the canonical
-- journey point back to that exact deal after the tag-driven synchroniser has
-- completed.
create or replace function wacrm.attach_manual_deal_to_customer_journey()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_pipeline_key text;
begin
  if new.contact_id is null then
    return new;
  end if;

  select p.system_key into v_pipeline_key
  from wacrm.pipelines p
  where p.id = new.pipeline_id
    and p.account_id = new.account_id;

  if v_pipeline_key = 'sales_journey' then
    update wacrm.contact_journey_state
    set deal_id = new.id,
        pipeline_id = new.pipeline_id,
        pipeline_stage_id = new.stage_id,
        updated_at = now()
    where account_id = new.account_id
      and contact_id = new.contact_id;
  end if;

  return new;
end;
$function$;

alter function wacrm.attach_manual_deal_to_customer_journey() owner to postgres;
revoke all on function wacrm.attach_manual_deal_to_customer_journey() from public, anon;

drop trigger if exists zz_wacrm_attach_manual_deal_to_customer_journey on wacrm.deals;
create trigger zz_wacrm_attach_manual_deal_to_customer_journey
after update of stage_id, status on wacrm.deals
for each row execute function wacrm.attach_manual_deal_to_customer_journey();
