-- Never hijack an open deal that belongs to a custom pipeline. Journey
-- classification owns only the system `Jornada Comercial` opportunity.

create or replace function wacrm.sync_customer_journey_from_tag()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_tag wacrm.tags%rowtype;
  v_contact wacrm.contacts%rowtype;
  v_stage_key text;
  v_phase text;
  v_label text;
  v_previous_stage text;
  v_pipeline_stage_key text;
  v_pipeline_id uuid;
  v_pipeline_stage_id uuid;
  v_deal_id uuid;
  v_conversation_id uuid;
  v_currency text;
  v_working_status text;
begin
  select * into v_tag
  from wacrm.tags
  where id = new.tag_id;

  if not found
     or v_tag.is_system is distinct from true
     or v_tag.system_group <> 'journey_stage' then
    return new;
  end if;

  select * into v_contact
  from wacrm.contacts
  where id = new.contact_id;

  if not found or v_contact.account_id is distinct from v_tag.account_id then
    raise exception 'Journey tag and contact must belong to the same account'
      using errcode = '23503';
  end if;

  v_stage_key := replace(v_tag.system_key, 'journey.', '');
  v_phase := wacrm.customer_journey_phase(v_stage_key);
  v_label := wacrm.customer_journey_label(v_stage_key);

  if v_phase is null or v_label is null then
    raise exception 'Unknown customer journey stage: %', v_stage_key;
  end if;

  select s.stage_key
    into v_previous_stage
  from wacrm.contact_journey_state s
  where s.account_id = v_contact.account_id
    and s.contact_id = v_contact.id;

  -- Exactly one visible journey-stage tag per contact.
  delete from wacrm.contact_tags ct
  using wacrm.tags old_tag
  where ct.tag_id = old_tag.id
    and ct.contact_id = new.contact_id
    and ct.id <> new.id
    and old_tag.account_id = v_contact.account_id
    and old_tag.is_system = true
    and old_tag.system_group = 'journey_stage';

  select c.id
    into v_conversation_id
  from wacrm.conversations c
  where c.account_id = v_contact.account_id
    and c.contact_id = v_contact.id
  order by c.last_message_at desc nulls last,
           c.updated_at desc,
           c.created_at desc
  limit 1;

  select p.id
    into v_pipeline_id
  from wacrm.pipelines p
  where p.account_id = v_contact.account_id
    and p.system_key = 'sales_journey'
    and p.is_system = true
  limit 1;

  v_pipeline_stage_key := wacrm.customer_journey_pipeline_stage_key(v_stage_key);

  if v_pipeline_id is not null and v_pipeline_stage_key is not null then
    select ps.id
      into v_pipeline_stage_id
    from wacrm.pipeline_stages ps
    where ps.pipeline_id = v_pipeline_id
      and ps.system_key = v_pipeline_stage_key
      and ps.is_system = true
    limit 1;
  end if;

  -- IMPORTANT: only select an open opportunity already owned by the system
  -- journey pipeline. A custom deal for this contact is never repurposed.
  if v_pipeline_id is not null then
    select d.id
      into v_deal_id
    from wacrm.deals d
    where d.account_id = v_contact.account_id
      and d.contact_id = v_contact.id
      and d.pipeline_id = v_pipeline_id
      and d.status = 'open'
    order by
      case when d.conversation_id = v_conversation_id then 0 else 1 end,
      d.created_at desc
    limit 1;
  end if;

  if v_pipeline_stage_id is not null then
    if v_deal_id is null then
      select a.default_currency
        into v_currency
      from wacrm.accounts a
      where a.id = v_contact.account_id;

      insert into wacrm.deals (
        user_id,
        account_id,
        pipeline_id,
        stage_id,
        contact_id,
        conversation_id,
        title,
        value,
        currency,
        status
      ) values (
        v_contact.user_id,
        v_contact.account_id,
        v_pipeline_id,
        v_pipeline_stage_id,
        v_contact.id,
        v_conversation_id,
        'Oportunidade · ' || coalesce(nullif(v_contact.name, ''), v_contact.phone),
        0,
        coalesce(v_currency, 'USD'),
        'open'
      )
      returning id into v_deal_id;
    else
      update wacrm.deals
      set stage_id = v_pipeline_stage_id,
          conversation_id = coalesce(conversation_id, v_conversation_id),
          updated_at = now()
      where id = v_deal_id
        and pipeline_id = v_pipeline_id;
    end if;
  elsif v_stage_key = 'sale_completed' and v_deal_id is not null then
    update wacrm.deals
    set status = 'won',
        updated_at = now()
    where id = v_deal_id
      and pipeline_id = v_pipeline_id;
  elsif v_stage_key = 'lost' and v_deal_id is not null then
    update wacrm.deals
    set status = 'lost',
        updated_at = now()
    where id = v_deal_id
      and pipeline_id = v_pipeline_id;
  end if;

  insert into wacrm.contact_journey_state (
    account_id,
    contact_id,
    conversation_id,
    stage_key,
    stage_label,
    journey_phase,
    pipeline_id,
    pipeline_stage_id,
    deal_id,
    commercial_intent,
    source,
    updated_at
  ) values (
    v_contact.account_id,
    v_contact.id,
    v_conversation_id,
    v_stage_key,
    v_label,
    v_phase,
    v_pipeline_id,
    v_pipeline_stage_id,
    v_deal_id,
    v_pipeline_stage_id is not null
      or v_stage_key in ('sale_completed', 'lost', 'repeat_purchase'),
    'tag',
    now()
  )
  on conflict (account_id, contact_id)
  do update set
    conversation_id = excluded.conversation_id,
    stage_key = excluded.stage_key,
    stage_label = excluded.stage_label,
    journey_phase = excluded.journey_phase,
    pipeline_id = excluded.pipeline_id,
    pipeline_stage_id = excluded.pipeline_stage_id,
    deal_id = coalesce(excluded.deal_id, wacrm.contact_journey_state.deal_id),
    commercial_intent = excluded.commercial_intent,
    source = excluded.source,
    updated_at = now();

  if v_previous_stage is distinct from v_stage_key then
    insert into wacrm.contact_journey_events (
      account_id,
      contact_id,
      conversation_id,
      from_stage_key,
      to_stage_key,
      journey_phase,
      deal_id,
      source
    ) values (
      v_contact.account_id,
      v_contact.id,
      v_conversation_id,
      v_previous_stage,
      v_stage_key,
      v_phase,
      v_deal_id,
      'tag'
    );
  end if;

  if to_regclass('wacrm.conversation_working_state') is not null
     and v_conversation_id is not null then
    v_working_status := case
      when v_stage_key in ('awaiting_decision', 'payment_pending')
        then 'waiting_customer'
      when v_stage_key in ('sale_completed', 'lost', 'post_sale')
        then 'resolved'
      else 'active'
    end;

    update wacrm.conversation_working_state
    set status = v_working_status,
        updated_at = now()
    where account_id = v_contact.account_id
      and conversation_id = v_conversation_id;
  end if;

  return new;
end;
$function$;

alter function wacrm.sync_customer_journey_from_tag() owner to postgres;
revoke all on function wacrm.sync_customer_journey_from_tag()
  from public, anon, authenticated;
grant execute on function wacrm.sync_customer_journey_from_tag() to service_role;
