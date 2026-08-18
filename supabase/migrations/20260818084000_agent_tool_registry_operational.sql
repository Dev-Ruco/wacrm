-- Global code-owned metadata registry for implemented AI tools.
-- The runtime still validates every key against AGENT_TOOL_KEYS; this table
-- only supplies labels, risk metadata, defaults and administrative visibility.

create table if not exists wacrm.tool_definitions (
  key text primary key,
  label text not null,
  description text,
  action_class text not null default 'read'
    check (action_class in ('read','communication','mutation','handoff')),
  reversible boolean not null default true,
  external_impact boolean not null default false,
  default_enabled boolean not null default false,
  input_schema jsonb not null default '{}'::jsonb
    check (jsonb_typeof(input_schema) = 'object'),
  sort_order integer not null default 0,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into wacrm.tool_definitions
  (key,label,description,action_class,reversible,external_impact,default_enabled,sort_order,enabled)
values
  ('search_catalog','Pesquisar catálogo','Pesquisa ofertas reais e activas no catálogo da empresa.','read',true,false,true,10,true),
  ('send_product','Enviar produto','Envia ao cliente uma fotografia de produto seleccionada pelo agente a partir do catálogo.','communication',false,true,true,20,true),
  ('compose_solution','Compor solução','Monta uma combinação/pacote usando relações e regras configuradas no catálogo.','read',true,false,false,30,true),
  ('search_knowledge','Consultar conhecimento','Pesquisa políticas, serviços e informação factual da empresa.','read',true,false,true,40,true),
  ('add_tag','Adicionar etiqueta','Aplica ao contacto uma etiqueta CRM já existente.','mutation',true,false,false,50,true),
  ('create_deal','Criar negócio','Cria uma oportunidade comercial no CRM.','mutation',true,false,false,60,true),
  ('schedule_visit','Agendar visita','Regista uma visita ou atendimento numa data/hora acordada.','mutation',true,true,false,70,true),
  ('get_style_opinion','Analisar estilo','Analisa visualmente opções de catálogo quando a empresa activou esta competência.','read',true,false,false,80,true),
  ('handoff_human','Transferir para humano','Interrompe a resposta automática e encaminha a conversa para atendimento humano.','handoff',true,true,true,90,true),
  ('check_availability','Verificar disponibilidade','Consulta horários e excepções configurados antes de prometer um agendamento.','read',true,false,true,100,true),
  ('create_order','Criar encomenda','Cria uma encomenda com preços lidos directamente do catálogo; não confirma pagamento.','mutation',true,true,false,110,true),
  ('get_order_status','Consultar encomenda','Consulta o estado factual da encomenda do cliente.','read',true,false,true,120,true),
  ('update_contact','Actualizar contacto','Guarda nome, email, empresa ou campos existentes quando o cliente os fornece explicitamente.','mutation',true,false,false,130,true)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  action_class = excluded.action_class,
  reversible = excluded.reversible,
  external_impact = excluded.external_impact,
  default_enabled = excluded.default_enabled,
  sort_order = excluded.sort_order,
  enabled = excluded.enabled,
  updated_at = now();

alter table wacrm.tool_definitions enable row level security;
revoke all on table wacrm.tool_definitions from public, anon;
grant select on table wacrm.tool_definitions to authenticated;
grant all on table wacrm.tool_definitions to service_role;

drop policy if exists tool_definitions_read on wacrm.tool_definitions;
create policy tool_definitions_read on wacrm.tool_definitions
for select to authenticated using (true);
