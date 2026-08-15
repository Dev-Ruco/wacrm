-- LC Fitness tenant-data correction for multilingual catalogue requests.
--
-- The shared runtime remains vocabulary-free. These aliases belong to the LC
-- account and allow structured values emitted in another language to resolve
-- deterministically through catalog_taxonomy_terms (for example, a model token
-- can map back to the Portuguese value stored by LC). Existing aliases are
-- preserved and the migration is idempotent.

do $$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id
  from wacrm.catalog_sources
  where source_type = 'external_supabase'
    and lower(trim(name)) = lower('Base LC Fitness')
  limit 1;

  if v_account_id is null then
    return;
  end if;

  update wacrm.catalog_taxonomy_terms t
  set aliases = (
    select array_agg(distinct alias order by alias)
    from unnest(coalesce(t.aliases, '{}') || v.aliases) alias
  )
  from (values
    ('preto', array['black']::text[]),
    ('branco', array['white']::text[]),
    ('azul', array['blue']::text[]),
    ('vermelho', array['red']::text[]),
    ('verde', array['green']::text[]),
    ('amarelo', array['yellow']::text[]),
    ('roxo', array['purple','violet']::text[]),
    ('rosa', array['pink']::text[]),
    ('cinza', array['gray','grey']::text[]),
    ('bege', array['beige']::text[]),
    ('laranja', array['orange']::text[]),
    ('dourado', array['gold','golden']::text[]),
    ('prateado', array['silver']::text[])
  ) as v(canonical_value, aliases)
  where t.account_id = v_account_id
    and t.kind = 'color'
    and t.canonical_value = v.canonical_value;

  update wacrm.catalog_taxonomy_terms t
  set aliases = (
    select array_agg(distinct alias order by alias)
    from unnest(coalesce(t.aliases, '{}') || v.aliases) alias
  )
  from (values
    ('saia', array['skirt']::text[]),
    ('top', array['tops']::text[]),
    ('camisola', array['shirt','t-shirt','tshirt']::text[]),
    ('calcao', array['short','shorts']::text[]),
    ('macacao', array['jumpsuit']::text[]),
    ('conjunto', array['set','outfit set']::text[]),
    ('sapatilha', array['sneaker','sneakers','trainer','trainers']::text[]),
    ('acessorio', array['accessory','accessories']::text[]),
    ('legging', array['leggings','tights']::text[]),
    ('pantalona', array['wide leg','wide-leg trousers']::text[])
  ) as v(canonical_value, aliases)
  where t.account_id = v_account_id
    and t.kind = 'category'
    and t.canonical_value = v.canonical_value;
end $$;