-- Customer journey classification and CRM synchronisation.
--
-- Design goals:
--   * every account receives the same protected system journey tags;
--   * system defaults are tenant-scoped (never shared across accounts);
--   * one canonical journey state exists per contact;
--   * adding a journey-stage tag atomically replaces the previous stage,
--     records history and synchronises the commercial pipeline/deal;
--   * existing custom tags, pipelines and deals are never deleted/replaced;
--   * the existing add_tag agent tool becomes the semantic command used by AI.

-- ---------------------------------------------------------------------------
-- SYSTEM METADATA
-- ---------------------------------------------------------------------------

alter table wacrm.tags
  add column if not exists system_key text,
  add column if not exists system_group text,
  add column if not exists is_system boolean not null default false;

alter table wacrm.pipelines
  add column if not exists system_key text,
  add column if not exists is_system boolean not null default false;

alter table wacrm.pipeline_stages
  add column if not exists system_key text,
  add column if not exists journey_phase text,
  add column if not exists is_system boolean not null default false;

create unique index if not exists tags_account_system_key_uidx
  on wacrm.tags (account_id, system_key)
  where system_key is not null;

create unique index if not exists pipelines_account_system_key_uidx
  on wacrm.pipelines (account_id, system_key)
  where system_key is not null;

create unique index if not exists pipeline_stages_pipeline_system_key_uidx
  on wacrm.pipeline_stages (pipeline_id, system_key)
  where system_key is not null;

create index if not exists tags_account_system_group_idx
  on wacrm.tags (account_id, system_group)
  where is_system = true;

-- ---------------------------------------------------------------------------
-- CANONICAL JOURNEY STATE + HISTORY
-- ---------------------------------------------------------------------------

create table if not exists wacrm.contact_journey_state (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  contact_id uuid not null references wacrm.contacts(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  stage_key text not null,
  stage_label text not null,
  journey_phase text not null,
  pipeline_id uuid references wacrm.pipelines(id) on delete set null,
  pipeline_stage_id uuid references wacrm.pipeline_stages(id) on delete set null,
  deal_id uuid references wacrm.deals(id) on delete set null,
  commercial_intent boolean not null default false,
  source text not null default 'system',
  source_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_journey_state_stage_check check (stage_key in (
    'new_contact',
    'in_service',
    'need_identified',
    'solution_identified',
    'interest_confirmed',
    'lead_qualified',
    'price_presented',
    'negotiating',
    'awaiting_decision',
    'payment_pending',
    'sale_completed',
    'lost',
    'post_sale',
    'repeat_purchase'
  )),
  constraint contact_journey_state_phase_check check (journey_phase in (
    'entry', 'discovery', 'interest', 'decision', 'conversion', 'relationship'
  )),
  constraint contact_journey_state_account_contact_unique unique (account_id, contact_id)
);

create table if not exists wacrm.contact_journey_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  contact_id uuid not null references wacrm.contacts(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  from_stage_key text,
  to_stage_key text not null,
  journey_phase text not null,
  deal_id uuid references wacrm.deals(id) on delete set null,
  source text not null default 'system',
  created_at timestamptz not null default now()
);

create index if not exists contact_journey_state_account_stage_idx
  on wacrm.contact_journey_state (account_id, stage_key);
create index if not exists contact_journey_state_contact_idx
  on wacrm.contact_journey_state (contact_id);
create index if not exists contact_journey_events_contact_created_idx
  on wacrm.contact_journey_events (contact_id, created_at desc);

alter table wacrm.contact_journey_state enable row level security;
alter table wacrm.contact_journey_events enable row level security;

revoke all on table wacrm.contact_journey_state from public, anon;
revoke all on table wacrm.contact_journey_events from public, anon;
grant select on table wacrm.contact_journey_state to authenticated;
grant select on table wacrm.contact_journey_events to authenticated;
grant all on table wacrm.contact_journey_state to service_role;
grant all on table wacrm.contact_journey_events to service_role;

drop policy if exists contact_journey_state_select on wacrm.contact_journey_state;
create policy contact_journey_state_select
on wacrm.contact_journey_state
for select
to authenticated
using (wacrm.is_account_member(account_id));

drop policy if exists contact_journey_events_select on wacrm.contact_journey_events;
create policy contact_journey_events_select
on wacrm.contact_journey_events
for select
to authenticated
using (wacrm.is_account_member(account_id));

-- ---------------------------------------------------------------------------
-- JOURNEY METADATA HELPERS
-- ---------------------------------------------------------------------------

create or replace function wacrm.customer_journey_phase(p_stage_key text)
returns text
language sql
immutable
as $function$
  select case p_stage_key
    when 'new_contact' then 'entry'
    when 'in_service' then 'entry'
    when 'need_identified' then 'discovery'
    when 'solution_identified' then 'discovery'
    when 'interest_confirmed' then 'interest'
    when 'lead_qualified' then 'interest'
    when 'price_presented' then 'decision'
    when 'negotiating' then 'decision'
    when 'awaiting_decision' then 'decision'
    when 'payment_pending' then 'conversion'
    when 'sale_completed' then 'conversion'
    when 'lost' then 'conversion'
    when 'post_sale' then 'relationship'
    when 'repeat_purchase' then 'relationship'
    else null
  end;
$function$;

create or replace function wacrm.customer_journey_label(p_stage_key text)
returns text
language sql
immutable
as $function$
  select case p_stage_key
    when 'new_contact' then 'Novo contacto'
    when 'in_service' then 'Em atendimento'
    when 'need_identified' then 'Necessidade identificada'
    when 'solution_identified' then 'Solução identificada'
    when 'interest_confirmed' then 'Interesse confirmado'
    when 'lead_qualified' then 'Lead qualificado'
    when 'price_presented' then 'Preço apresentado'
    when 'negotiating' then 'Em negociação'
    when 'awaiting_decision' then 'Aguardando decisão'
    when 'payment_pending' then 'Pagamento pendente'
    when 'sale_completed' then 'Venda concluída'
    when 'lost' then 'Perdido'
    when 'post_sale' then 'Pós-venda'
    when 'repeat_purchase' then 'Recompra'
    else null
  end;
$function$;

create or replace function wacrm.customer_journey_pipeline_stage_key(p_stage_key text)
returns text
language sql
immutable
as $function$
  select case p_stage_key
    when 'need_identified' then 'new_lead'
    when 'solution_identified' then 'qualified'
    when 'interest_confirmed' then 'interest'
    when 'lead_qualified' then 'qualified'
    when 'price_presented' then 'proposal'
    when 'negotiating' then 'negotiation'
    when 'awaiting_decision' then 'negotiation'
    when 'payment_pending' then 'payment'
    when 'repeat_purchase' then 'new_lead'
    else null
  end;
$function$;

-- ---------------------------------------------------------------------------
-- DEFAULTS FOR EVERY ACCOUNT
-- ---------------------------------------------------------------------------

create or replace function wacrm.seed_customer_journey_defaults(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_owner_user_id uuid;
  v_pipeline_id uuid;
begin
  select a.owner_user_id
    into v_owner_user_id
  from wacrm.accounts a
  where a.id = p_account_id;

  if v_owner_user_id is null then
    return;
  end if;

  -- Stage tags: exactly one of these represents the contact's current stage.
  insert into wacrm.tags (user_id, account_id, name, color, system_key, system_group, is_system)
  values
    (v_owner_user_id, p_account_id, 'Etapa · Novo contacto', '#64748b', 'journey.new_contact', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Em atendimento', '#0ea5e9', 'journey.in_service', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Necessidade identificada', '#06b6d4', 'journey.need_identified', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Solução identificada', '#14b8a6', 'journey.solution_identified', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Interesse confirmado', '#22c55e', 'journey.interest_confirmed', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Lead qualificado', '#84cc16', 'journey.lead_qualified', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Preço apresentado', '#eab308', 'journey.price_presented', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Em negociação', '#f59e0b', 'journey.negotiating', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Aguardando decisão', '#f97316', 'journey.awaiting_decision', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Pagamento pendente', '#a855f7', 'journey.payment_pending', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Venda concluída', '#16a34a', 'journey.sale_completed', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Perdido', '#dc2626', 'journey.lost', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Pós-venda', '#8b5cf6', 'journey.post_sale', 'journey_stage', true),
    (v_owner_user_id, p_account_id, 'Etapa · Recompra', '#4f46e5', 'journey.repeat_purchase', 'journey_stage', true)
  on conflict (account_id, system_key) where system_key is not null
  do update set
    name = excluded.name,
    color = excluded.color,
    system_group = excluded.system_group,
    is_system = true;

  -- Semantic tags: facts/signals that may coexist with the stage tag.
  insert into wacrm.tags (user_id, account_id, name, color, system_key, system_group, is_system)
  values
    (v_owner_user_id, p_account_id, 'Lead Frio', '#64748b', 'signal.lead_cold', 'temperature', true),
    (v_owner_user_id, p_account_id, 'Lead Morno', '#eab308', 'signal.lead_warm', 'temperature', true),
    (v_owner_user_id, p_account_id, 'Lead Quente', '#ef4444', 'signal.lead_hot', 'temperature', true),
    (v_owner_user_id, p_account_id, 'Pedido de Preço', '#0ea5e9', 'intent.price', 'intent', true),
    (v_owner_user_id, p_account_id, 'Pedido de Stock', '#06b6d4', 'intent.stock', 'intent', true),
    (v_owner_user_id, p_account_id, 'Pedido de Informação', '#64748b', 'intent.information', 'intent', true),
    (v_owner_user_id, p_account_id, 'Quer Comprar', '#22c55e', 'intent.buy', 'intent', true),
    (v_owner_user_id, p_account_id, 'Pedido de Orçamento', '#3b82f6', 'intent.quote', 'intent', true),
    (v_owner_user_id, p_account_id, 'Pagamento Pendente', '#a855f7', 'purchase.payment_pending', 'purchase', true),
    (v_owner_user_id, p_account_id, 'Entrega', '#0ea5e9', 'purchase.delivery', 'purchase', true),
    (v_owner_user_id, p_account_id, 'Levantamento na Loja', '#14b8a6', 'purchase.store_pickup', 'purchase', true),
    (v_owner_user_id, p_account_id, 'Compra Recorrente', '#4f46e5', 'purchase.repeat', 'purchase', true),
    (v_owner_user_id, p_account_id, 'Novo Cliente', '#0ea5e9', 'relationship.new_customer', 'relationship', true),
    (v_owner_user_id, p_account_id, 'Cliente Recorrente', '#4f46e5', 'relationship.returning_customer', 'relationship', true),
    (v_owner_user_id, p_account_id, 'Cliente VIP', '#eab308', 'relationship.vip', 'relationship', true),
    (v_owner_user_id, p_account_id, 'Follow-up', '#f59e0b', 'followup.required', 'followup', true),
    (v_owner_user_id, p_account_id, 'Sem Resposta', '#64748b', 'followup.no_response', 'followup', true),
    (v_owner_user_id, p_account_id, 'Contactar Depois', '#8b5cf6', 'followup.later', 'followup', true),
    (v_owner_user_id, p_account_id, 'Requer Humano', '#ef4444', 'service.human_required', 'service', true),
    (v_owner_user_id, p_account_id, 'Urgente', '#dc2626', 'service.urgent', 'service', true),
    (v_owner_user_id, p_account_id, 'Reclamação', '#f97316', 'service.complaint', 'service', true),
    (v_owner_user_id, p_account_id, 'Suporte', '#3b82f6', 'service.support', 'service', true),
    (v_owner_user_id, p_account_id, 'Perdido por Preço', '#ef4444', 'loss.price', 'loss', true),
    (v_owner_user_id, p_account_id, 'Perdido por Stock', '#ef4444', 'loss.stock', 'loss', true),
    (v_owner_user_id, p_account_id, 'Perdido por Prazo', '#ef4444', 'loss.deadline', 'loss', true),
    (v_owner_user_id, p_account_id, 'Sem Interesse', '#64748b', 'loss.no_interest', 'loss', true)
  on conflict (account_id, system_key) where system_key is not null
  do update set
    name = excluded.name,
    color = excluded.color,
    system_group = excluded.system_group,
    is_system = true;

  insert into wacrm.pipelines (user_id, account_id, name, system_key, is_system)
  values (v_owner_user_id, p_account_id, 'Jornada Comercial', 'sales_journey', true)
  on conflict (account_id, system_key) where system_key is not null
  do update set name = excluded.name, is_system = true
  returning id into v_pipeline_id;

  if v_pipeline_id is null then
    select p.id into v_pipeline_id
    from wacrm.pipelines p
    where p.account_id = p_account_id
      and p.system_key = 'sales_journey';
  end if;

  insert into wacrm.pipeline_stages (pipeline_id, name, position, color, system_key, journey_phase, is_system)
  values
    (v_pipeline_id, 'Novo Lead', 0, '#64748b', 'new_lead', 'discovery', true),
    (v_pipeline_id, 'Qualificado', 1, '#84cc16', 'qualified', 'interest', true),
    (v_pipeline_id, 'Interesse', 2, '#22c55e', 'interest', 'interest', true),
    (v_pipeline_id, 'Proposta', 3, '#eab308', 'proposal', 'decision', true),
    (v_pipeline_id, 'Negociação', 4, '#f59e0b', 'negotiation', 'decision', true),
    (v_pipeline_id, 'Pagamento', 5, '#a855f7', 'payment', 'conversion', true)
  on conflict (pipeline_id, system_key) where system_key is not null
  do update set
    name = excluded.name,
    position = excluded.position,
    color = excluded.color,
    journey_phase = excluded.journey_phase,
    is_system = true;
end;
$function$;

alter function wacrm.seed_customer_journey_defaults(uuid) owner to postgres;
revoke all on function wacrm.seed_customer_journey_defaults(uuid) from public, anon;
grant execute on function wacrm.seed_customer_journey_defaults(uuid) to authenticated, service_role;

create or replace function wacrm.seed_customer_journey_on_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  perform wacrm.seed_customer_journey_defaults(new.id);
  return new;
end;
$function$;

alter function wacrm.seed_customer_journey_on_account() owner to postgres;

drop trigger if exists wacrm_seed_customer_journey_on_account on wacrm.accounts;
create trigger wacrm_seed_customer_journey_on_account
after insert on wacrm.accounts
for each row execute function wacrm.seed_customer_journey_on_account();

-- ---------------------------------------------------------------------------
-- AGENT GUIDANCE
-- Existing add_tag is deliberately reused: the agent never invents stages.
-- ---------------------------------------------------------------------------

do $block$
declare
  v_instruction text := $instruction$
CUSTOMER JOURNEY (mandatory CRM hygiene): after each substantive customer turn, determine the CURRENT stage from the evidence in the conversation. When the stage changes, or no stage has yet been established, call add_tag with exactly ONE of these existing system tags:
Etapa · Novo contacto; Etapa · Em atendimento; Etapa · Necessidade identificada; Etapa · Solução identificada; Etapa · Interesse confirmado; Etapa · Lead qualificado; Etapa · Preço apresentado; Etapa · Em negociação; Etapa · Aguardando decisão; Etapa · Pagamento pendente; Etapa · Venda concluída; Etapa · Perdido; Etapa · Pós-venda; Etapa · Recompra.
Do not guess or advance a stage merely to push a sale. Use the strongest stage clearly supported by the conversation. The CRM automatically removes the previous stage tag and synchronises the commercial pipeline.
You may additionally apply these existing semantic tags only when clearly supported: Lead Frio, Lead Morno, Lead Quente, Pedido de Preço, Pedido de Stock, Pedido de Informação, Quer Comprar, Pedido de Orçamento, Pagamento Pendente, Entrega, Levantamento na Loja, Compra Recorrente, Novo Cliente, Cliente Recorrente, Follow-up, Sem Resposta, Contactar Depois, Requer Humano, Urgente, Reclamação, Suporte, Perdido por Preço, Perdido por Stock, Perdido por Prazo, Sem Interesse.
Never assign Cliente VIP subjectively; that classification is reserved for an explicit business rule or human action.
$instruction$;
begin
  update wacrm.agent_tools
  set enabled = true,
      instructions = case
        when coalesce(instructions, '') like '%CUSTOMER JOURNEY (mandatory CRM hygiene)%' then instructions
        when nullif(btrim(coalesce(instructions, '')), '') is null then v_instruction
        else instructions || E'\n\n' || v_instruction
      end,
      updated_at = now()
  where tool_key = 'add_tag';

  -- When the runtime registry exists, make the already-registered add_tag
  -- capability available by default. We intentionally do not assume the
  -- registry's full schema and therefore only update known columns.
  if to_regclass('wacrm.tool_definitions') is not null then
    execute 'update wacrm.tool_definitions set default_enabled = true, enabled = true where key = ''add_tag''';
  end if;
end
$block$;

create or replace function wacrm.enable_journey_tool_for_new_agent()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_instruction text := $instruction$
CUSTOMER JOURNEY (mandatory CRM hygiene): after each substantive customer turn, classify the customer's current stage by calling add_tag with exactly one configured "Etapa · ..." tag whenever the stage changes. Never invent a stage or advance it without evidence. The CRM automatically replaces the previous journey-stage tag and synchronises the commercial pipeline. Semantic system tags may also be added when clearly supported. Never assign Cliente VIP subjectively.
$instruction$;
begin
  insert into wacrm.agent_tools (account_id, agent_id, tool_key, enabled, instructions)
  values (new.account_id, new.id, 'add_tag', true, v_instruction)
  on conflict (agent_id, tool_key)
  do update set enabled = true,
                instructions = case
                  when coalesce(wacrm.agent_tools.instructions, '') like '%CUSTOMER JOURNEY (mandatory CRM hygiene)%'
                    then wacrm.agent_tools.instructions
                  when nullif(btrim(coalesce(wacrm.agent_tools.instructions, '')), '') is null
                    then excluded.instructions
                  else wacrm.agent_tools.instructions || E'\n\n' || excluded.instructions
                end,
                updated_at = now();
  return new;
end;
$function$;

alter function wacrm.enable_journey_tool_for_new_agent() owner to postgres;

drop trigger if exists wacrm_enable_journey_tool_for_new_agent on wacrm.ai_configs;
create trigger wacrm_enable_journey_tool_for_new_agent
after insert on wacrm.ai_configs
for each row execute function wacrm.enable_journey_tool_for_new_agent();

-- ---------------------------------------------------------------------------
-- JOURNEY SYNCHRONISATION
-- ---------------------------------------------------------------------------

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
  select * into v_tag from wacrm.tags where id = new.tag_id;
  if not found or not v_tag.is_system or v_tag.system_group <> 'journey_stage' then
    return new;
  end if;

  select * into v_contact from wacrm.contacts where id = new.contact_id;
  if not found or v_contact.account_id <> v_tag.account_id then
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

  -- One and only one current journey-stage tag per contact.
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
  order by c.last_message_at desc nulls last, c.updated_at desc, c.created_at desc
  limit 1;

  select p.id
    into v_pipeline_id
  from wacrm.pipelines p
  where p.account_id = v_contact.account_id
    and p.system_key = 'sales_journey'
  limit 1;

  v_pipeline_stage_key := wacrm.customer_journey_pipeline_stage_key(v_stage_key);
  if v_pipeline_id is not null and v_pipeline_stage_key is not null then
    select ps.id
      into v_pipeline_stage_id
    from wacrm.pipeline_stages ps
    where ps.pipeline_id = v_pipeline_id
      and ps.system_key = v_pipeline_stage_key
    limit 1;
  end if;

  select d.id
    into v_deal_id
  from wacrm.deals d
  where d.account_id = v_contact.account_id
    and d.contact_id = v_contact.id
    and d.status = 'open'
  order by
    case when d.conversation_id = v_conversation_id then 0 else 1 end,
    d.created_at desc
  limit 1;

  -- A stage mapped to the sales pipeline is sufficient evidence that the
  -- customer is now a commercial opportunity. Create one open deal only when
  -- none exists; otherwise move the existing opportunity.
  if v_pipeline_stage_id is not null then
    if v_deal_id is null then
      select a.default_currency into v_currency
      from wacrm.accounts a where a.id = v_contact.account_id;

      insert into wacrm.deals (
        user_id, account_id, pipeline_id, stage_id, contact_id, conversation_id,
        title, value, currency, status
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
      ) returning id into v_deal_id;
    else
      update wacrm.deals
      set pipeline_id = v_pipeline_id,
          stage_id = v_pipeline_stage_id,
          conversation_id = coalesce(conversation_id, v_conversation_id),
          updated_at = now()
      where id = v_deal_id;
    end if;
  elsif v_stage_key = 'sale_completed' and v_deal_id is not null then
    update wacrm.deals
    set status = 'won', updated_at = now()
    where id = v_deal_id;
  elsif v_stage_key = 'lost' and v_deal_id is not null then
    update wacrm.deals
    set status = 'lost', updated_at = now()
    where id = v_deal_id;
  end if;

  insert into wacrm.contact_journey_state (
    account_id, contact_id, conversation_id, stage_key, stage_label,
    journey_phase, pipeline_id, pipeline_stage_id, deal_id,
    commercial_intent, source, updated_at
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
    v_pipeline_stage_id is not null or v_stage_key in ('sale_completed', 'lost', 'repeat_purchase'),
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
      account_id, contact_id, conversation_id, from_stage_key, to_stage_key,
      journey_phase, deal_id, source
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

  -- Keep the AI's short-lived operational state aligned when that table is
  -- available. The canonical journey above remains the source of truth.
  if to_regclass('wacrm.conversation_working_state') is not null
     and v_conversation_id is not null then
    v_working_status := case
      when v_stage_key in ('awaiting_decision', 'payment_pending') then 'waiting_customer'
      when v_stage_key in ('sale_completed', 'lost', 'post_sale') then 'resolved'
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
revoke all on function wacrm.sync_customer_journey_from_tag() from public, anon;

drop trigger if exists wacrm_sync_customer_journey_from_tag on wacrm.contact_tags;
create trigger wacrm_sync_customer_journey_from_tag
after insert on wacrm.contact_tags
for each row execute function wacrm.sync_customer_journey_from_tag();

-- ---------------------------------------------------------------------------
-- CONTACT DEFAULT STAGE
-- Every new or existing contact gets a visible stage immediately.
-- ---------------------------------------------------------------------------

create or replace function wacrm.assign_new_contact_journey()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_tag_id uuid;
begin
  perform wacrm.seed_customer_journey_defaults(new.account_id);

  select t.id into v_tag_id
  from wacrm.tags t
  where t.account_id = new.account_id
    and t.system_key = 'journey.new_contact'
  limit 1;

  if v_tag_id is not null then
    insert into wacrm.contact_tags (contact_id, tag_id)
    values (new.id, v_tag_id)
    on conflict (contact_id, tag_id) do nothing;
  end if;
  return new;
end;
$function$;

alter function wacrm.assign_new_contact_journey() owner to postgres;

drop trigger if exists wacrm_assign_new_contact_journey on wacrm.contacts;
create trigger wacrm_assign_new_contact_journey
after insert on wacrm.contacts
for each row execute function wacrm.assign_new_contact_journey();

-- ---------------------------------------------------------------------------
-- PROTECT SYSTEM DEFINITIONS FROM ACCIDENTAL USER DELETION / RENAMING.
-- Contact-to-tag associations remain removable; the AI/trigger will re-apply
-- the canonical stage when a new stage is selected.
-- ---------------------------------------------------------------------------

create or replace function wacrm.protect_system_crm_definition()
returns trigger
language plpgsql
security definer
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
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

alter function wacrm.protect_system_crm_definition() owner to postgres;

drop trigger if exists wacrm_protect_system_tags on wacrm.tags;
create trigger wacrm_protect_system_tags
before update or delete on wacrm.tags
for each row execute function wacrm.protect_system_crm_definition();

drop trigger if exists wacrm_protect_system_pipelines on wacrm.pipelines;
create trigger wacrm_protect_system_pipelines
before update or delete on wacrm.pipelines
for each row execute function wacrm.protect_system_crm_definition();

drop trigger if exists wacrm_protect_system_pipeline_stages on wacrm.pipeline_stages;
create trigger wacrm_protect_system_pipeline_stages
before update or delete on wacrm.pipeline_stages
for each row execute function wacrm.protect_system_crm_definition();

-- ---------------------------------------------------------------------------
-- INITIAL SEED / BACKFILL
-- ---------------------------------------------------------------------------

do $block$
declare
  v_account record;
begin
  for v_account in select id from wacrm.accounts loop
    perform wacrm.seed_customer_journey_defaults(v_account.id);
  end loop;
end
$block$;

-- Every pre-existing contact without a journey stage starts at Novo contacto.
-- The AFTER INSERT trigger above performs the canonical state upsert.
insert into wacrm.contact_tags (contact_id, tag_id)
select c.id, t.id
from wacrm.contacts c
join wacrm.tags t
  on t.account_id = c.account_id
 and t.system_key = 'journey.new_contact'
where not exists (
  select 1
  from wacrm.contact_tags ct
  join wacrm.tags existing_tag on existing_tag.id = ct.tag_id
  where ct.contact_id = c.id
    and existing_tag.account_id = c.account_id
    and existing_tag.system_group = 'journey_stage'
    and existing_tag.is_system = true
)
on conflict (contact_id, tag_id) do nothing;
