-- Operational toolkit for autonomous customer-service agents.
-- Additive/idempotent: preserves existing tools, skills, pipelines and tenant data.

-- ---------------------------------------------------------------------------
-- 1. Agent tool keys + defaults
-- ---------------------------------------------------------------------------
alter table wacrm.agent_tools drop constraint if exists agent_tools_tool_key_check;
alter table wacrm.agent_tools
  add constraint agent_tools_tool_key_check check (tool_key in (
    'search_catalog',
    'send_product',
    'compose_solution',
    'search_knowledge',
    'add_tag',
    'create_deal',
    'schedule_visit',
    'get_style_opinion',
    'handoff_human',
    'check_availability',
    'create_order',
    'get_order_status',
    'update_contact'
  ));

insert into wacrm.agent_tools (account_id, agent_id, tool_key, enabled)
select c.account_id, c.id, d.tool_key, d.enabled
from wacrm.ai_configs c
cross join (values
  ('check_availability'::text, true),
  ('get_order_status'::text, true),
  ('create_order'::text, false),
  ('update_contact'::text, false)
) as d(tool_key, enabled)
on conflict (agent_id, tool_key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Generic customer orders. Payment confirmation intentionally remains an
-- external/trusted operation: the AI can create/read orders but cannot invent
-- a payment confirmation.
-- ---------------------------------------------------------------------------
create table if not exists wacrm.customer_orders (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  contact_id uuid not null references wacrm.contacts(id) on delete cascade,
  conversation_id uuid references wacrm.conversations(id) on delete set null,
  agent_id uuid references wacrm.ai_configs(id) on delete set null,
  status text not null default 'pending_payment'
    check (status in ('draft','pending_payment','paid','confirmed','fulfilled','cancelled')),
  fulfillment_method text not null default 'other'
    check (fulfillment_method in ('delivery','pickup','other')),
  fulfillment_notes text check (fulfillment_notes is null or char_length(fulfillment_notes) <= 1200),
  total_amount numeric(14,2) not null default 0 check (total_amount >= 0),
  currency text not null default 'MZN' check (char_length(currency) between 3 and 12),
  external_ref text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists wacrm.customer_order_items (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references wacrm.accounts(id) on delete cascade,
  order_id uuid not null references wacrm.customer_orders(id) on delete cascade,
  catalog_product_id uuid references wacrm.catalog_products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity between 1 and 10000),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  currency text not null check (char_length(currency) between 3 and 12),
  created_at timestamptz not null default now()
);

create index if not exists customer_orders_contact_idx
  on wacrm.customer_orders (account_id, contact_id, created_at desc);
create index if not exists customer_orders_status_idx
  on wacrm.customer_orders (account_id, status, created_at desc);
create index if not exists customer_order_items_order_idx
  on wacrm.customer_order_items (order_id);

create unique index if not exists customer_orders_external_ref_unique_idx
  on wacrm.customer_orders (account_id, external_ref)
  where external_ref is not null;

-- Keep order/item tenant scope consistent even when service-role code writes.
create or replace function wacrm.validate_customer_order_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if not exists (
    select 1 from wacrm.contacts c
    where c.id = new.contact_id and c.account_id = new.account_id
  ) then
    raise exception 'Order contact must belong to the same account' using errcode = '23503';
  end if;
  if new.conversation_id is not null and not exists (
    select 1 from wacrm.conversations c
    where c.id = new.conversation_id and c.account_id = new.account_id
  ) then
    raise exception 'Order conversation must belong to the same account' using errcode = '23503';
  end if;
  if new.agent_id is not null and not exists (
    select 1 from wacrm.ai_configs a
    where a.id = new.agent_id and a.account_id = new.account_id
  ) then
    raise exception 'Order agent must belong to the same account' using errcode = '23503';
  end if;
  return new;
end;
$function$;

create or replace function wacrm.validate_customer_order_item_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if not exists (
    select 1 from wacrm.customer_orders o
    where o.id = new.order_id and o.account_id = new.account_id
  ) then
    raise exception 'Order item must belong to the same account as its order' using errcode = '23503';
  end if;
  if new.catalog_product_id is not null and not exists (
    select 1 from wacrm.catalog_products p
    where p.id = new.catalog_product_id and p.account_id = new.account_id
  ) then
    raise exception 'Order item product must belong to the same account' using errcode = '23503';
  end if;
  return new;
end;
$function$;

revoke all on function wacrm.validate_customer_order_context() from public;
revoke all on function wacrm.validate_customer_order_item_context() from public;

drop trigger if exists validate_customer_order_context on wacrm.customer_orders;
create trigger validate_customer_order_context
before insert or update of account_id, contact_id, conversation_id, agent_id
on wacrm.customer_orders for each row execute function wacrm.validate_customer_order_context();

drop trigger if exists validate_customer_order_item_context on wacrm.customer_order_items;
create trigger validate_customer_order_item_context
before insert or update of account_id, order_id, catalog_product_id
on wacrm.customer_order_items for each row execute function wacrm.validate_customer_order_item_context();

drop trigger if exists set_updated_at on wacrm.customer_orders;
create trigger set_updated_at before update on wacrm.customer_orders
for each row execute function wacrm.update_updated_at_column();

alter table wacrm.customer_orders enable row level security;
alter table wacrm.customer_order_items enable row level security;
revoke all on table wacrm.customer_orders from public, anon;
revoke all on table wacrm.customer_order_items from public, anon;
grant select, insert, update, delete on table wacrm.customer_orders to authenticated;
grant select, insert, update, delete on table wacrm.customer_order_items to authenticated;
grant all on table wacrm.customer_orders to service_role;
grant all on table wacrm.customer_order_items to service_role;

drop policy if exists customer_orders_select on wacrm.customer_orders;
create policy customer_orders_select on wacrm.customer_orders
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists customer_orders_write on wacrm.customer_orders;
create policy customer_orders_write on wacrm.customer_orders
for all to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

drop policy if exists customer_order_items_select on wacrm.customer_order_items;
create policy customer_order_items_select on wacrm.customer_order_items
for select to authenticated using (wacrm.is_account_member(account_id));
drop policy if exists customer_order_items_write on wacrm.customer_order_items;
create policy customer_order_items_write on wacrm.customer_order_items
for all to authenticated
using (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum))
with check (wacrm.is_account_member(account_id, 'admin'::wacrm.account_role_enum));

-- ---------------------------------------------------------------------------
-- 3. Deterministic availability check. Sunday=0 follows PostgreSQL DOW.
-- Explicit unavailable exceptions win; explicit available exceptions can open
-- a period outside recurring windows. Capacity is reported but is not treated
-- as booking inventory until a reservation counter is connected.
-- ---------------------------------------------------------------------------
create or replace function wacrm.check_operational_availability(
  p_account_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_offering_id uuid default null,
  p_entity_id uuid default null
)
returns table(available boolean, reason text, source text, capacity integer)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_window record;
  v_exception record;
begin
  if p_ends_at <= p_starts_at then
    return query select false, 'intervalo inválido'::text, 'validation'::text, null::integer;
    return;
  end if;
  if p_offering_id is null and p_entity_id is null then
    return query select false, 'indique uma oferta ou recurso para verificar disponibilidade'::text, 'validation'::text, null::integer;
    return;
  end if;
  if p_offering_id is not null and not exists (
    select 1 from wacrm.catalog_products p where p.id = p_offering_id and p.account_id = p_account_id and p.is_active = true
  ) then
    return query select false, 'oferta não encontrada nesta conta'::text, 'validation'::text, null::integer;
    return;
  end if;
  if p_entity_id is not null and not exists (
    select 1 from wacrm.business_entities e where e.id = p_entity_id and e.account_id = p_account_id and e.enabled = true
  ) then
    return query select false, 'recurso não encontrado nesta conta'::text, 'validation'::text, null::integer;
    return;
  end if;

  select e.status, e.capacity, e.reason
    into v_exception
  from wacrm.availability_exceptions e
  where e.account_id = p_account_id
    and e.enabled = true
    and (p_offering_id is null or e.offering_id = p_offering_id)
    and (p_entity_id is null or e.entity_id = p_entity_id)
    and e.starts_at < p_ends_at
    and e.ends_at > p_starts_at
    and e.status = 'unavailable'
  order by e.starts_at desc
  limit 1;

  if found then
    return query select false,
      coalesce(v_exception.reason, 'indisponível neste período')::text,
      'exception'::text,
      v_exception.capacity::integer;
    return;
  end if;

  select e.status, e.capacity, e.reason
    into v_exception
  from wacrm.availability_exceptions e
  where e.account_id = p_account_id
    and e.enabled = true
    and (p_offering_id is null or e.offering_id = p_offering_id)
    and (p_entity_id is null or e.entity_id = p_entity_id)
    and e.starts_at <= p_starts_at
    and e.ends_at >= p_ends_at
    and e.status = 'available'
  order by e.starts_at desc
  limit 1;

  if found then
    return query select true,
      coalesce(v_exception.reason, 'disponibilidade excepcional confirmada')::text,
      'exception'::text,
      v_exception.capacity::integer;
    return;
  end if;

  select w.capacity, w.timezone
    into v_window
  from wacrm.availability_windows w
  where w.account_id = p_account_id
    and w.enabled = true
    and (p_offering_id is null or w.offering_id = p_offering_id)
    and (p_entity_id is null or w.entity_id = p_entity_id)
    and extract(dow from (p_starts_at at time zone w.timezone))::smallint = w.weekday
    and (w.valid_from is null or (p_starts_at at time zone w.timezone)::date >= w.valid_from)
    and (w.valid_until is null or (p_starts_at at time zone w.timezone)::date <= w.valid_until)
    and (p_starts_at at time zone w.timezone)::time >= w.start_time
    and (p_ends_at at time zone w.timezone)::time <= w.end_time
  order by w.capacity desc nulls last, w.start_time
  limit 1;

  if found then
    return query select true, 'horário disponível'::text, 'recurring_window'::text, v_window.capacity::integer;
  else
    return query select false, 'não existe disponibilidade configurada para este período'::text, 'recurring_window'::text, null::integer;
  end if;
end;
$function$;

revoke all on function wacrm.check_operational_availability(uuid,timestamptz,timestamptz,uuid,uuid) from public, anon;
grant execute on function wacrm.check_operational_availability(uuid,timestamptz,timestamptz,uuid,uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Standard commercial skills for every current agent. They are routing
-- guidance, never global hard-coded business facts. Existing tenant skills are
-- preserved. Skills can only narrow already-enabled tool permissions.
-- ---------------------------------------------------------------------------
insert into wacrm.skills
  (account_id, agent_id, name, instructions, objective, when_to_use, when_not_to_use, tool_keys, enabled, sort_order)
select c.account_id, c.id, s.name, s.instructions, s.objective, s.when_to_use, s.when_not_to_use, s.tool_keys, true, s.sort_order
from wacrm.ai_configs c
cross join (values
  ('Descoberta da Necessidade'::text,
   'Descobre a necessidade com o mínimo de perguntas úteis. Usa contexto já fornecido, não repitas perguntas respondidas e consulta catálogo/conhecimento quando isso desbloquear a decisão.',
   'Perceber exactamente o que o cliente procura sem transformar a conversa num interrogatório.',
   'Quando o pedido está incompleto, ambíguo ou ainda precisa de critérios para chegar a uma solução real.',
   'Não usar para uma intenção já suficientemente clara nem para repetir perguntas já respondidas.',
   array['search_catalog','search_knowledge']::text[], 10),
  ('Consultoria de Produto'::text,
   'Compara apenas opções reais. Pesquisa antes de afirmar preço, stock, tamanho ou características. Mostra poucos candidatos relevantes e respeita imediatamente rejeições, preferências e limites do cliente.',
   'Ajudar o cliente a escolher a melhor oferta real para a sua necessidade.',
   'Quando o cliente pede recomendação, comparação, alternativas ou quer ver produtos/serviços adequados.',
   'Não usar para perguntas institucionais sem relação com uma oferta nem quando o cliente já escolheu e quer apenas concluir.',
   array['search_catalog','send_product','compose_solution','search_knowledge','get_style_opinion']::text[], 20),
  ('Fecho de Venda'::text,
   'Quando houver intenção clara de avançar, confirma apenas os dados estritamente necessários, cria a encomenda com produtos reais do catálogo e informa o estado verdadeiro. Nunca marques pagamento como confirmado sem uma fonte externa confiável.',
   'Converter intenção clara numa encomenda rastreável sem inventar pagamento ou condições.',
   'Quando o cliente aceita comprar, pede dados para pagar, confirma quantidades ou define entrega/levantamento.',
   'Não usar enquanto o cliente estiver apenas a explorar opções ou quando ainda não há produto/serviço identificado.',
   array['search_catalog','create_order','get_order_status','update_contact','add_tag','handoff_human']::text[], 30),
  ('Agendamento'::text,
   'Verifica disponibilidade antes de prometer horário. Só agenda depois de existir uma data/hora suficientemente definida e usa handoff quando uma excepção exige decisão humana.',
   'Marcar visitas/serviços apenas em horários operacionalmente válidos.',
   'Quando o cliente quer visitar, reservar horário ou marcar atendimento/serviço.',
   'Não usar para perguntas genéricas sobre horário de funcionamento que a base de conhecimento consiga responder.',
   array['check_availability','schedule_visit','search_knowledge','handoff_human']::text[], 40),
  ('Pós-venda e Encomenda'::text,
   'Consulta o estado real da encomenda antes de responder. Não inventes pagamento, expedição, entrega ou conclusão. Para problemas não resolvíveis com dados disponíveis, entrega a um humano com contexto.',
   'Acompanhar uma compra existente com informação factual e continuidade.',
   'Quando o cliente pergunta por uma encomenda, pagamento, entrega, levantamento ou assistência depois da compra.',
   'Não usar para uma nova intenção de compra sem relação com encomenda anterior.',
   array['get_order_status','search_knowledge','handoff_human']::text[], 50),
  ('Reclamações'::text,
   'Reconhece o problema sem discutir com o cliente. Recolhe apenas o mínimo necessário, consulta dados relevantes e usa handoff_human quando houver insatisfação real, pedido de compensação, excepção ou decisão sensível.',
   'Resolver ou encaminhar reclamações com contexto suficiente e sem promessas não autorizadas.',
   'Quando o cliente manifesta insatisfação, reclama de produto, serviço, pagamento, entrega ou atendimento.',
   'Não usar para uma dúvida normal, simples preferência ou rejeição de produto sem reclamação.',
   array['get_order_status','search_knowledge','handoff_human']::text[], 60)
) as s(name,instructions,objective,when_to_use,when_not_to_use,tool_keys,sort_order)
on conflict (account_id, agent_id, name) do nothing;

-- Future agents receive operational permission rows and standard skills.
create or replace function wacrm.seed_operational_agent_defaults()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into wacrm.agent_tools (account_id, agent_id, tool_key, enabled)
  values
    (new.account_id, new.id, 'check_availability', true),
    (new.account_id, new.id, 'get_order_status', true),
    (new.account_id, new.id, 'create_order', false),
    (new.account_id, new.id, 'update_contact', false)
  on conflict (agent_id, tool_key) do nothing;

  insert into wacrm.skills
    (account_id, agent_id, name, instructions, objective, when_to_use, when_not_to_use, tool_keys, enabled, sort_order)
  values
    (new.account_id,new.id,'Descoberta da Necessidade','Descobre a necessidade com o mínimo de perguntas úteis. Usa contexto já fornecido, não repitas perguntas respondidas e consulta catálogo/conhecimento quando isso desbloquear a decisão.','Perceber exactamente o que o cliente procura sem transformar a conversa num interrogatório.','Quando o pedido está incompleto, ambíguo ou ainda precisa de critérios para chegar a uma solução real.','Não usar para uma intenção já suficientemente clara nem para repetir perguntas já respondidas.',array['search_catalog','search_knowledge'],true,10),
    (new.account_id,new.id,'Consultoria de Produto','Compara apenas opções reais. Pesquisa antes de afirmar preço, stock, tamanho ou características. Mostra poucos candidatos relevantes e respeita imediatamente rejeições, preferências e limites do cliente.','Ajudar o cliente a escolher a melhor oferta real para a sua necessidade.','Quando o cliente pede recomendação, comparação, alternativas ou quer ver produtos/serviços adequados.','Não usar para perguntas institucionais sem relação com uma oferta nem quando o cliente já escolheu e quer apenas concluir.',array['search_catalog','send_product','compose_solution','search_knowledge','get_style_opinion'],true,20),
    (new.account_id,new.id,'Fecho de Venda','Quando houver intenção clara de avançar, confirma apenas os dados estritamente necessários, cria a encomenda com produtos reais do catálogo e informa o estado verdadeiro. Nunca marques pagamento como confirmado sem uma fonte externa confiável.','Converter intenção clara numa encomenda rastreável sem inventar pagamento ou condições.','Quando o cliente aceita comprar, pede dados para pagar, confirma quantidades ou define entrega/levantamento.','Não usar enquanto o cliente estiver apenas a explorar opções ou quando ainda não há produto/serviço identificado.',array['search_catalog','create_order','get_order_status','update_contact','add_tag','handoff_human'],true,30),
    (new.account_id,new.id,'Agendamento','Verifica disponibilidade antes de prometer horário. Só agenda depois de existir uma data/hora suficientemente definida e usa handoff quando uma excepção exige decisão humana.','Marcar visitas/serviços apenas em horários operacionalmente válidos.','Quando o cliente quer visitar, reservar horário ou marcar atendimento/serviço.','Não usar para perguntas genéricas sobre horário de funcionamento que a base de conhecimento consiga responder.',array['check_availability','schedule_visit','search_knowledge','handoff_human'],true,40),
    (new.account_id,new.id,'Pós-venda e Encomenda','Consulta o estado real da encomenda antes de responder. Não inventes pagamento, expedição, entrega ou conclusão. Para problemas não resolvíveis com dados disponíveis, entrega a um humano com contexto.','Acompanhar uma compra existente com informação factual e continuidade.','Quando o cliente pergunta por uma encomenda, pagamento, entrega, levantamento ou assistência depois da compra.','Não usar para uma nova intenção de compra sem relação com encomenda anterior.',array['get_order_status','search_knowledge','handoff_human'],true,50),
    (new.account_id,new.id,'Reclamações','Reconhece o problema sem discutir com o cliente. Recolhe apenas o mínimo necessário, consulta dados relevantes e usa handoff_human quando houver insatisfação real, pedido de compensação, excepção ou decisão sensível.','Resolver ou encaminhar reclamações com contexto suficiente e sem promessas não autorizadas.','Quando o cliente manifesta insatisfação, reclama de produto, serviço, pagamento, entrega ou atendimento.','Não usar para uma dúvida normal, simples preferência ou rejeição de produto sem reclamação.',array['get_order_status','search_knowledge','handoff_human'],true,60)
  on conflict (account_id, agent_id, name) do nothing;

  return new;
end;
$function$;

revoke all on function wacrm.seed_operational_agent_defaults() from public;

drop trigger if exists seed_operational_agent_defaults on wacrm.ai_configs;
create trigger seed_operational_agent_defaults
after insert on wacrm.ai_configs
for each row execute function wacrm.seed_operational_agent_defaults();
