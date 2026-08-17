-- LC FITNESS -> WACRM: pacote de catálogo independente
--
-- Fonte comercial: lc_fitness.products
-- Fonte de stock/variantes: lc_fitness.stock_products_v2 + lc_fitness.stock_variants
--
-- Execute esta consulta no SQL Editor da base da LC Fitness.
-- O resultado é UMA célula chamada `catalogo_lc_json`.
-- Copie o conteúdo completo dessa célula para `catalogo-lc.json`
-- e importe-o no WACRM. Não é criada qualquer ligação permanente entre as bases.
--
-- Regras de ligação:
-- 1. usa stock_products_v2.catalog_product_id quando existe;
-- 2. quando está vazio, tenta casar por nome normalizado SOMENTE se o nome for único;
-- 3. stock_products_v2 sem correspondência não são descartados: entram como produtos autónomos.

with catalog_base as (
  select
    p.*,
    c.name as category_name,
    regexp_replace(lower(trim(p.name)), '\s+', ' ', 'g') as normalized_name
  from lc_fitness.products p
  left join lc_fitness.categories c on c.id = p.category_id
  where p.deleted_at is null
),
unique_catalog_names as (
  select
    normalized_name,
    min(id::text)::uuid as catalog_product_id,
    count(*) as match_count
  from catalog_base
  where normalized_name <> ''
  group by normalized_name
),
stock_mapped as (
  select
    sp.*,
    sc.name as stock_category_name,
    case
      when sp.catalog_product_id is not null
        and exists (
          select 1
          from catalog_base p
          where p.id = sp.catalog_product_id
        )
        then sp.catalog_product_id
      when names.match_count = 1
        then names.catalog_product_id
      else null
    end as resolved_catalog_product_id
  from lc_fitness.stock_products_v2 sp
  left join lc_fitness.categories sc on sc.id = sp.category_id
  left join unique_catalog_names names
    on names.normalized_name = regexp_replace(lower(trim(sp.name)), '\s+', ' ', 'g')
),
selected_stock as (
  select *
  from (
    select
      sm.*,
      row_number() over (
        partition by sm.resolved_catalog_product_id
        order by
          (sm.catalog_product_id is not null) desc,
          coalesce(sm.is_active, true) desc,
          sm.updated_at desc nulls last,
          sm.created_at desc,
          sm.id
      ) as rn
    from stock_mapped sm
    where sm.resolved_catalog_product_id is not null
  ) ranked
  where rn = 1
),
catalog_package_products as (
  select
    'catalog:' || p.id::text as sort_key,
    jsonb_strip_nulls(
      jsonb_build_object(
        'external_id', p.id::text,
        'name', p.name,
        'description', nullif(p.description, ''),
        'price', coalesce(sp.base_price_mt, p.price_mt, p.base_price, 0),
        'currency', 'MZN',
        'category', coalesce(p.category_name, sp.stock_category_name),
        'image_url', coalesce(nullif(sp.image_url, ''), nullif(p.image_url, '')),
        'images', coalesce(
          (
            select jsonb_agg(distinct image_value)
            from (
              select coalesce(nullif(sp.image_url, ''), nullif(p.image_url, '')) as image_value

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

              union all

              select nullif(v.image_url, '')
              from lc_fitness.stock_variants v
              where sp.id is not null
                and v.stock_product_id = sp.id
            ) images
            where image_value is not null
          ),
          '[]'::jsonb
        ),
        'stock_quantity', case
          when sp.id is null then null
          else (
            select coalesce(sum(greatest(coalesce(v.current_stock, 0), 0)), 0)
            from lc_fitness.stock_variants v
            where v.stock_product_id = sp.id
              and coalesce(v.is_active, true) = true
          )
        end,
        'is_active', (
          coalesce(p.is_active, true)
          and coalesce(sp.is_active, true)
        ),
        'variants', coalesce(
          (
            select jsonb_agg(
              jsonb_strip_nulls(
                jsonb_build_object(
                  'external_id', v.id::text,
                  'sku', nullif(v.barcode, ''),
                  'size', nullif(v.size, ''),
                  'color', nullif(v.color, ''),
                  'price', coalesce(v.price_mt, sp.base_price_mt, p.price_mt, p.base_price, 0),
                  'stock_quantity', greatest(coalesce(v.current_stock, 0), 0),
                  'image_url', coalesce(
                    nullif(v.image_url, ''),
                    nullif(sp.image_url, ''),
                    nullif(p.image_url, '')
                  ),
                  'is_active', coalesce(v.is_active, true)
                )
              )
              order by v.color nulls last, v.size nulls last, v.barcode nulls last, v.id
            )
            from lc_fitness.stock_variants v
            where sp.id is not null
              and v.stock_product_id = sp.id
          ),
          '[]'::jsonb
        )
      )
    ) as product_json
  from catalog_base p
  left join selected_stock sp
    on sp.resolved_catalog_product_id = p.id
),
orphan_stock_products as (
  select
    'stock:' || sp.id::text as sort_key,
    jsonb_strip_nulls(
      jsonb_build_object(
        'external_id', 'stock:' || sp.id::text,
        'name', sp.name,
        'price', coalesce(sp.base_price_mt, 0),
        'currency', 'MZN',
        'category', sp.stock_category_name,
        'image_url', nullif(sp.image_url, ''),
        'images', coalesce(
          (
            select jsonb_agg(distinct image_value)
            from (
              select nullif(sp.image_url, '') as image_value

              union all

              select nullif(v.image_url, '')
              from lc_fitness.stock_variants v
              where v.stock_product_id = sp.id
            ) images
            where image_value is not null
          ),
          '[]'::jsonb
        ),
        'stock_quantity', (
          select coalesce(sum(greatest(coalesce(v.current_stock, 0), 0)), 0)
          from lc_fitness.stock_variants v
          where v.stock_product_id = sp.id
            and coalesce(v.is_active, true) = true
        ),
        'is_active', coalesce(sp.is_active, true),
        'variants', coalesce(
          (
            select jsonb_agg(
              jsonb_strip_nulls(
                jsonb_build_object(
                  'external_id', v.id::text,
                  'sku', nullif(v.barcode, ''),
                  'size', nullif(v.size, ''),
                  'color', nullif(v.color, ''),
                  'price', coalesce(v.price_mt, sp.base_price_mt, 0),
                  'stock_quantity', greatest(coalesce(v.current_stock, 0), 0),
                  'image_url', coalesce(nullif(v.image_url, ''), nullif(sp.image_url, '')),
                  'is_active', coalesce(v.is_active, true)
                )
              )
              order by v.color nulls last, v.size nulls last, v.barcode nulls last, v.id
            )
            from lc_fitness.stock_variants v
            where v.stock_product_id = sp.id
          ),
          '[]'::jsonb
        )
      )
    ) as product_json
  from stock_mapped sp
  where sp.resolved_catalog_product_id is null
),
package_products as (
  select * from catalog_package_products
  union all
  select * from orphan_stock_products
)
select jsonb_pretty(
  jsonb_build_object(
    'version', 1,
    'source', 'lc-fitness-stock-snapshot',
    'exported_at', to_char(
      clock_timestamp() at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'
    ),
    'catalog', jsonb_build_object(
      'name', 'LC Fitness',
      'currency', 'MZN'
    ),
    'diagnostics', jsonb_build_object(
      'catalog_products', (select count(*) from catalog_base),
      'stock_products_v2', (select count(*) from stock_mapped),
      'stock_products_mapped', (
        select count(*) from stock_mapped
        where resolved_catalog_product_id is not null
      ),
      'stock_products_unmatched', (
        select count(*) from stock_mapped
        where resolved_catalog_product_id is null
      ),
      'stock_variants', (select count(*) from lc_fitness.stock_variants)
    ),
    'products', coalesce(
      (
        select jsonb_agg(product_json order by sort_key)
        from package_products
      ),
      '[]'::jsonb
    )
  )
) as catalogo_lc_json;
