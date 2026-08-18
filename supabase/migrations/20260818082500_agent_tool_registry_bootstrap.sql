-- Bootstrap operational tool definitions before agent_tools defaults are inserted.
-- Required because agent_tools.tool_key has a foreign key to tool_definitions.
-- Additive/idempotent: the later full registry migration may safely upsert the same rows.

insert into wacrm.tool_definitions
  (key,label,description,action_class,reversible,external_impact,default_enabled,sort_order,enabled)
values
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
