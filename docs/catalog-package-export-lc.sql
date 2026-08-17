-- LC FITNESS -> WACRM: pacote de catálogo independente
--
-- Execute esta consulta no SQL Editor da base da LC Fitness.
-- O resultado é UMA célula chamada `catalogo_lc_json`.
-- Copie o conteúdo completo dessa célula para um ficheiro chamado `catalogo-lc.json`
-- e importe-o no WACRM. Não é criada qualquer ligação permanente entre as bases.

with products_with_category as (
  select
    p.*,
    c.name as category_name
  from lc_fitness.products p
  left join lc_fitness.categories c on c.id = p.category_id
  where p.deleted_at is null
),
package_products as (
  select
    p.id,
    jsonb_strip_nulls(
      jsonb_build_object(
        'external_id', p.id::text,
        'name', p.name,
        'description', p.description,
        'price', coalesce(p.price_mt, 0),
        'currency', 'MZN',
        'category', p.category_name,
        'image_url', nullif(p.image_url, ''),
        'images', coalesce(
          (
            select jsonb_agg(distinct image_value)
            from (
              select nullif(p.image_url, '') as image_value
              union all
              select nullif(
                case jsonb_typeof(gallery_item)
                  when 'string' then trim(both '"' from gallery_item::text)
                  when 'object' then gallery_item ->> 'url'
                  else null
                end,
                ''
              )
              from jsonb_array_elements(coalesce(p.gallery::jsonb, '[]'::jsonb)) as gallery(gallery_item)
            ) images
            where image_value is not null
          ),
          '[]'::jsonb
        ),
        'stock_quantity', (
          select coalesce(sum(greatest(coalesce(v.stock, 0), 0)), 0)
          from lc_fitness.product_variants v
          where v.product_id = p.id
            and coalesce(v.is_active, true) = true
        ),
        'is_active', coalesce(p.is_active, true),
        'variants', coalesce(
          (
            select jsonb_agg(
              jsonb_strip_nulls(
                jsonb_build_object(
                  'external_id', v.id::text,
                  'sku', nullif(v.sku, ''),
                  'size', coalesce(
                    nullif(v.custom_fields ->> 'size', ''),
                    case
                      when lower(coalesce(v.option_name, '')) in ('size', 'tamanho') then nullif(v.option_value, '')
                      else null
                    end
                  ),
                  'color', coalesce(
                    nullif(v.custom_fields ->> 'color', ''),
                    case
                      when lower(coalesce(v.option_name, '')) in ('color', 'colour', 'cor') then nullif(v.option_value, '')
                      else null
                    end
                  ),
                  'price', coalesce(v.price, p.price_mt, 0),
                  'stock_quantity', greatest(coalesce(v.stock, 0), 0),
                  'image_url', coalesce(
                    nullif(v.image_url, ''),
                    (
                      select nullif(gallery_item ->> 'url', '')
                      from jsonb_array_elements(coalesce(p.gallery::jsonb, '[]'::jsonb)) as gallery(gallery_item)
                      where jsonb_typeof(gallery_item) = 'object'
                        and nullif(gallery_item ->> 'url', '') is not null
                        and lower(coalesce(gallery_item ->> 'color', '')) = lower(
                          coalesce(
                            nullif(v.custom_fields ->> 'color', ''),
                            case
                              when lower(coalesce(v.option_name, '')) in ('color', 'colour', 'cor') then nullif(v.option_value, '')
                              else null
                            end,
                            ''
                          )
                        )
                      limit 1
                    ),
                    nullif(p.image_url, '')
                  ),
                  'is_active', coalesce(v.is_active, true)
                )
              )
              order by v.created_at, v.id
            )
            from lc_fitness.product_variants v
            where v.product_id = p.id
          ),
          '[]'::jsonb
        )
      )
    ) as product_json
  from products_with_category p
)
select jsonb_pretty(
  jsonb_build_object(
    'version', 1,
    'source', 'lc-fitness',
    'exported_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'catalog', jsonb_build_object(
      'name', 'LC Fitness',
      'currency', 'MZN'
    ),
    'products', coalesce(
      (select jsonb_agg(product_json order by id) from package_products),
      '[]'::jsonb
    )
  )
) as catalogo_lc_json;
