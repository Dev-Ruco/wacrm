import { createClient } from '@supabase/supabase-js'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import type {
  CatalogProduct,
  CatalogProductVariant,
  CatalogSearchInput,
  CatalogSourceRow,
  ExternalFieldMapping,
} from './types'

const REQUEST_TIMEOUT_MS = 8_000
const MAX_SEARCH_VARIANTS = 16
const SIZE_CUE_PATTERN = /\b(?:tamanho|tam|numero|n|size)\s+(xxg|xg|gg|pp|g|m|p|\d{2})\b/i

function valueAt(input: unknown, path: string | undefined): unknown {
  if (!path) return undefined
  return path.split('.').reduce<unknown>((value, key) => {
    if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)]
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, input)
}

function firstValueAt(input: unknown, paths: Array<string | undefined>): unknown {
  for (const path of paths) {
    if (!path) continue
    const value = valueAt(input, path)
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function externalIdText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'bigint') return String(value)
  return null
}

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * No business-domain vocabulary lives here. Tenant taxonomy groups are the
 * only source of category/colour aliases used by the shared runtime.
 */
export function buildSearchVariants(
  query: string,
  categoryGroups: readonly (readonly string[])[] = [],
  colorGroups: readonly (readonly string[])[] = [],
): string[] {
  const normalized = normalizeSearchText(query)
  const variants = new Set<string>()
  const add = (value: string) => {
    const cleaned = normalizeSearchText(value)
    if (cleaned.length >= 2) variants.add(cleaned)
  }

  add(query)
  normalized.split(' ').filter((word) => word.length >= 3).forEach(add)

  for (const group of [...categoryGroups, ...colorGroups]) {
    const normalizedGroup = group.map(normalizeSearchText)
    const matches = normalizedGroup.some(
      (term) => normalized === term || normalized.includes(term) || term.includes(normalized),
    )
    if (matches) group.forEach(add)
  }

  const sizeCue = normalized.match(SIZE_CUE_PATTERN)
  if (sizeCue) variants.add(sizeCue[1])
  return Array.from(variants).slice(0, MAX_SEARCH_VARIANTS)
}

export function shouldQueryCatalogueSourceLive(source: CatalogSourceRow): boolean {
  // A mirror is removed from the customer-facing network path only after a
  // complete successful snapshot exists. Failed/new mirrors deliberately fall
  // back to the live adapter instead of making the agent blind.
  return !(source.sync_mode === 'mirror' && source.last_sync_status === 'succeeded')
}

function safePostgrestTerm(value: string): string {
  return value.replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim()
}

function safeIdentifier(value: string | undefined, fallback?: string): string {
  const candidate = (value || fallback || '').trim()
  if (!candidate || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
    throw new Error(`Invalid external catalogue identifier: ${candidate || '(empty)'}`)
  }
  return candidate
}

function optionalIdentifier(value: string | undefined): string | null {
  if (!value?.trim()) return null
  return safeIdentifier(value)
}

function assertSafeExternalUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('External catalogue URL must use HTTPS.')
  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
    host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error('Private network catalogue URLs are not allowed.')
  return url
}

function externalItems(payload: unknown, mapping: ExternalFieldMapping): unknown[] {
  if (mapping.items) {
    const mapped = valueAt(payload, mapping.items)
    if (Array.isArray(mapped)) return mapped
  }
  if (Array.isArray(payload)) return payload
  const common = firstValueAt(payload, ['products', 'data.products', 'items', 'data.items', 'data'])
  return Array.isArray(common) ? common : []
}

function normalizeExternalProduct(
  item: unknown,
  mapping: ExternalFieldMapping,
  source: CatalogSourceRow,
  index: number,
): CatalogProduct | null {
  const name = text(firstValueAt(item, [mapping.name, 'name', 'title', 'product_name']))
  const price = numberValue(firstValueAt(item, [mapping.price, 'price', 'price_mt', 'base_price', 'amount', 'unit_price', 'base_price_mt']))
  if (!name || price === null || price < 0) return null

  return {
    id: externalIdText(firstValueAt(item, [mapping.id, 'id', 'sku', 'external_id'])) ?? `${source.id}:${index}`,
    name,
    description: text(firstValueAt(item, [mapping.description, 'description', 'short_description', 'summary'])),
    price,
    currency: text(firstValueAt(item, [mapping.currency, 'currency', 'currency_code'])) ?? 'MZN',
    imageUrl: text(firstValueAt(item, [mapping.imageUrl, 'image_url', 'imageUrl', 'thumbnail', 'image', 'images.0.url', 'images.0'])),
    productUrl: text(firstValueAt(item, [mapping.productUrl, 'product_url', 'productUrl', 'url', 'link'])),
    category: text(firstValueAt(item, [mapping.category, 'category.name', 'category', 'type', 'product_type'])),
    stockQuantity: numberValue(firstValueAt(item, [mapping.stockQuantity, 'stock_quantity', 'stockQuantity', 'stock', 'quantity', 'current_stock'])),
    sourceName: source.name,
    sourceType: source.source_type,
  }
}

function catalogTableMapping(mapping: ExternalFieldMapping): ExternalFieldMapping {
  return {
    id: mapping.catalogId || mapping.id,
    name: mapping.catalogName || mapping.name,
    description: mapping.catalogDescription,
    price: mapping.catalogPrice,
    currency: mapping.catalogCurrency,
    imageUrl: mapping.catalogImageUrl,
    productUrl: mapping.catalogProductUrl,
    category: mapping.catalogCategory,
    searchColumns: mapping.catalogSearchColumns,
    activeColumn: mapping.catalogActiveColumn,
    publishedColumn: mapping.catalogPublishedColumn,
  }
}

function productIdentityKeys(product: CatalogProduct): string[] {
  const keys = [`id:${normalizeSearchText(product.id)}`]
  const normalizedName = normalizeSearchText(product.name)
  if (normalizedName) keys.push(`name:${normalizedName}`)
  return keys
}

function mergeCatalogueProduct(stockProduct: CatalogProduct, catalogueProduct: CatalogProduct): CatalogProduct {
  return {
    ...stockProduct,
    description: stockProduct.description || catalogueProduct.description,
    imageUrl: stockProduct.imageUrl || catalogueProduct.imageUrl,
    productUrl: stockProduct.productUrl || catalogueProduct.productUrl,
    category: stockProduct.category || catalogueProduct.category,
    variants: stockProduct.variants?.length ? stockProduct.variants : catalogueProduct.variants,
  }
}

function catalogueProductMatches(product: CatalogProduct, terms: string[]): boolean {
  const haystack = normalizeSearchText([
    product.name,
    product.description ?? '',
    product.category ?? '',
    product.id,
  ].join(' '))
  return terms.some((term) => {
    const normalized = normalizeSearchText(term)
    return !normalized || haystack.includes(normalized)
  })
}

async function searchExternalRestSource(
  source: CatalogSourceRow,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  if (!source.base_url) return []
  const base = assertSafeExternalUrl(source.base_url)
  const path = source.search_path || ''
  const expanded = path
    .replaceAll('{query}', encodeURIComponent(input.query))
    .replaceAll('{limit}', String(input.limit))
  const url = assertSafeExternalUrl(new URL(expanded, base).toString())
  if (!path.includes('{query}')) url.searchParams.set('q', input.query)
  if (!path.includes('{limit}')) url.searchParams.set('limit', String(input.limit))

  const headers: Record<string, string> = { Accept: 'application/json' }
  if (source.auth_secret_encrypted) {
    const secret = decrypt(source.auth_secret_encrypted)
    if (source.auth_type === 'bearer') headers.Authorization = `Bearer ${secret}`
    if (source.auth_type === 'api_key_header') headers[source.auth_header || 'X-API-Key'] = secret
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Catalogue API ${source.name} returned HTTP ${response.status}.`)

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error(`Catalogue API ${source.name} returned invalid JSON.`)
  }

  const mapping = source.field_mapping ?? {}
  const items = externalItems(payload, mapping)
  return items
    .slice(0, input.limit)
    .map((item, index) => normalizeExternalProduct(item, mapping, source, index))
    .filter((item): item is CatalogProduct => item !== null)
}

async function searchExternalSupabaseSource(
  source: CatalogSourceRow,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  if (!source.base_url || !source.auth_secret_encrypted) return []
  const baseUrl = assertSafeExternalUrl(source.base_url).toString().replace(/\/$/, '')
  const key = decrypt(source.auth_secret_encrypted)
  const mapping = source.field_mapping ?? {}
  const schema = safeIdentifier(mapping.schema, 'public')
  const table = safeIdentifier(mapping.table)
  const searchColumns = (mapping.searchColumns?.length ? mapping.searchColumns : [mapping.name || 'name'])
    .map((column) => safeIdentifier(column))
    .slice(0, 6)
  const variants = buildSearchVariants(input.query, input.categoryGroups, input.colorGroups)
  const terms = variants.length ? variants.slice(0, 4) : [normalizeSearchText(input.query)]

  const client = createClient(baseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
    global: { headers: { 'X-WACRM-Source': source.id } },
  })

  const requiredColumns = [
    safeIdentifier(mapping.id, 'id'),
    safeIdentifier(mapping.name, 'name'),
    safeIdentifier(mapping.price, 'price'),
  ]
  const optionalColumns = [
    optionalIdentifier(mapping.description), optionalIdentifier(mapping.currency),
    optionalIdentifier(mapping.imageUrl), optionalIdentifier(mapping.productUrl),
    optionalIdentifier(mapping.category), optionalIdentifier(mapping.stockQuantity),
  ]
  const selectColumns = Array.from(new Set([
    ...requiredColumns,
    ...searchColumns,
    ...optionalColumns.filter((column): column is string => Boolean(column)),
  ])).join(',')

  let query = client.from(table).select(selectColumns)
  if (mapping.activeColumn) query = query.eq(safeIdentifier(mapping.activeColumn), true)
  if (mapping.publishedColumn) query = query.eq(safeIdentifier(mapping.publishedColumn), true)
  const filters = terms.flatMap((term) => {
    const safeTerm = safePostgrestTerm(term)
    return searchColumns.map((column) => `${column}.ilike.%${safeTerm}%`)
  })
  if (filters.length) query = query.or(filters.join(','))

  const result = await Promise.race([
    query.limit(input.limit),
    new Promise<never>((_, reject) => setTimeout(
      () => reject(new Error(`External Supabase source ${source.name} timed out.`)),
      REQUEST_TIMEOUT_MS,
    )),
  ])
  if (result.error) throw new Error(`External Supabase source ${source.name} failed: ${result.error.message}`)

  let products = (result.data ?? [])
    .map((item, index) => normalizeExternalProduct(item, mapping, source, index))
    .filter((item): item is CatalogProduct => item !== null)

  if (mapping.variantsTable && products.length > 0) {
    const variantsTable = safeIdentifier(mapping.variantsTable)
    const variantId = safeIdentifier(mapping.variantId, 'id')
    const variantProductId = safeIdentifier(mapping.variantProductId, 'product_id')
    const variantSize = optionalIdentifier(mapping.variantSize)
    const variantColor = optionalIdentifier(mapping.variantColor)
    const variantStock = optionalIdentifier(mapping.variantStock)
    const variantImageUrl = optionalIdentifier(mapping.variantImageUrl)
    const variantColumns = Array.from(new Set([
      variantId, variantProductId, variantSize, variantColor, variantStock, variantImageUrl,
    ].filter((value): value is string => Boolean(value)))).join(',')
    const productIds = products.map((product) => product.id)

    let variantsQuery = client.from(variantsTable).select(variantColumns).in(variantProductId, productIds)
    if (mapping.variantActiveColumn) variantsQuery = variantsQuery.eq(safeIdentifier(mapping.variantActiveColumn), true)
    const variantsResult = await Promise.race([
      variantsQuery.limit(Math.max(input.limit * 20, 100)),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error(`External Supabase variants ${source.name} timed out.`)),
        REQUEST_TIMEOUT_MS,
      )),
    ])

    if (variantsResult.error) {
      console.error('[catalog search] external Supabase variants failed:', variantsResult.error.message)
    } else {
      const variantsByProduct = new Map<string, CatalogProductVariant[]>()
      for (const raw of Array.isArray(variantsResult.data) ? variantsResult.data : []) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
        const row = raw as Record<string, unknown>
        const productId = externalIdText(row[variantProductId])
        if (!productId) continue
        const current = variantsByProduct.get(productId) ?? []
        current.push({
          id: externalIdText(row[variantId]) ?? `${productId}:${current.length}`,
          size: variantSize ? text(row[variantSize]) : null,
          color: variantColor ? text(row[variantColor]) : null,
          stockQuantity: variantStock ? numberValue(row[variantStock]) : null,
          imageUrl: variantImageUrl ? text(row[variantImageUrl]) : null,
        })
        variantsByProduct.set(productId, current)
      }
      products = products.map((product) => ({
        ...product,
        variants: variantsByProduct.get(product.id) ?? undefined,
      }))
    }
  }

  if (mapping.catalogTable) {
    const catalogueTable = safeIdentifier(mapping.catalogTable)
    const catalogueMapping = catalogTableMapping(mapping)
    const catalogueSearchColumns = (catalogueMapping.searchColumns ?? [])
      .map((column) => safeIdentifier(column))
      .slice(0, 6)

    let catalogueQuery = client.from(catalogueTable).select('*')
    if (catalogueMapping.activeColumn) catalogueQuery = catalogueQuery.eq(safeIdentifier(catalogueMapping.activeColumn), true)
    if (catalogueMapping.publishedColumn) catalogueQuery = catalogueQuery.eq(safeIdentifier(catalogueMapping.publishedColumn), true)
    if (catalogueSearchColumns.length > 0) {
      const catalogueFilters = terms.flatMap((term) => {
        const safeTerm = safePostgrestTerm(term)
        return catalogueSearchColumns.map((column) => `${column}.ilike.%${safeTerm}%`)
      })
      if (catalogueFilters.length) catalogueQuery = catalogueQuery.or(catalogueFilters.join(','))
    }

    const catalogueFetchLimit = catalogueSearchColumns.length > 0
      ? input.limit
      : Math.max(input.limit * 25, 250)
    const catalogueResult = await Promise.race([
      catalogueQuery.limit(catalogueFetchLimit),
      new Promise<never>((_, reject) => setTimeout(
        () => reject(new Error(`External Supabase catalogue ${source.name} timed out.`)),
        REQUEST_TIMEOUT_MS,
      )),
    ])

    if (catalogueResult.error) {
      console.error('[catalog search] external Supabase catalogue-only table failed:', catalogueResult.error.message)
    } else {
      let catalogueProducts = (catalogueResult.data ?? [])
        .map((item, index) => normalizeExternalProduct(item, catalogueMapping, source, index))
        .filter((item): item is CatalogProduct => item !== null)
        .map((product) => ({ ...product, stockQuantity: null }))

      if (catalogueSearchColumns.length === 0) {
        catalogueProducts = catalogueProducts
          .filter((product) => catalogueProductMatches(product, terms))
          .slice(0, input.limit)
      }

      const stockIndex = new Map<string, number>()
      products.forEach((product, index) => {
        for (const keyName of productIdentityKeys(product)) stockIndex.set(keyName, index)
      })
      for (const catalogueProduct of catalogueProducts) {
        const match = productIdentityKeys(catalogueProduct)
          .map((keyName) => stockIndex.get(keyName))
          .find((index): index is number => index !== undefined)
        if (match !== undefined) {
          products[match] = mergeCatalogueProduct(products[match], catalogueProduct)
          continue
        }
        const nextIndex = products.length
        products.push(catalogueProduct)
        for (const keyName of productIdentityKeys(catalogueProduct)) stockIndex.set(keyName, nextIndex)
      }
    }
  }

  return products.slice(0, input.limit)
}

async function hydrateCanonicalVariants(
  db: WacrmSupabaseClient,
  accountId: string,
  productIds: readonly string[],
): Promise<Map<string, CatalogProductVariant[]>> {
  if (productIds.length === 0) return new Map()
  const { data, error } = await db
    .from('catalog_product_variants')
    .select('id, product_id, size, color, stock_quantity, image_url')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .in('product_id', productIds)
  if (error) {
    // Rolling deploy compatibility: a failed variant hydration must not remove
    // otherwise valid canonical products from customer search.
    console.warn('[catalog search] canonical variant hydration failed:', error.message)
    return new Map()
  }

  const byProduct = new Map<string, CatalogProductVariant[]>()
  for (const row of data ?? []) {
    const productId = String(row.product_id)
    const current = byProduct.get(productId) ?? []
    current.push({
      id: String(row.id),
      size: row.size,
      color: row.color,
      stockQuantity: row.stock_quantity,
      imageUrl: row.image_url,
    })
    byProduct.set(productId, current)
  }
  return byProduct
}

async function searchInternal(
  db: WacrmSupabaseClient,
  accountId: string,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  const variants = buildSearchVariants(input.query, input.categoryGroups, input.colorGroups)
  if (variants.length === 0) return []

  const filters = variants
    .map(safePostgrestTerm)
    .filter(Boolean)
    .flatMap((term) => [
      `name.ilike.%${term}%`,
      `description.ilike.%${term}%`,
      `category.ilike.%${term}%`,
      `color.ilike.%${term}%`,
    ])
    .join(',')

  const { data, error } = await db
    .from('catalog_products')
    .select('id, source_id, offering_type_id, name, description, color, price, currency, image_url, product_url, category, stock_quantity')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .or(filters)
    .limit(input.limit)

  if (error) throw new Error(`Internal catalogue search failed: ${error.message}`)
  if (!data) return []
  const canonicalVariants = await hydrateCanonicalVariants(db, accountId, data.map((row) => String(row.id)))

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.color
      ? `Cor: ${row.color}.${row.description ? ` ${row.description}` : ''}`
      : row.description,
    price: Number(row.price),
    currency: row.currency,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    category: row.category,
    stockQuantity: row.stock_quantity,
    variants: canonicalVariants.get(String(row.id)),
    sourceName: 'Catálogo interno',
    sourceType: 'internal',
    offeringTypeId: row.offering_type_id,
  }))
}

export async function searchCatalogues(
  db: WacrmSupabaseClient,
  accountId: string,
  input: CatalogSearchInput,
): Promise<CatalogProduct[]> {
  const internal = await searchInternal(db, accountId, input)
  if (internal.length >= input.limit) return internal.slice(0, input.limit)

  const { data: sourceRows, error: sourcesError } = await db
    .from('catalog_sources')
    .select('*')
    .eq('account_id', accountId)
    .in('source_type', ['external_rest', 'external_supabase'])
    .eq('is_active', true)
  if (sourcesError) throw new Error(`External catalogue source lookup failed: ${sourcesError.message}`)

  const sources = ((sourceRows ?? []) as CatalogSourceRow[]).filter(shouldQueryCatalogueSourceLive)
  const variants = buildSearchVariants(input.query, input.categoryGroups, input.colorGroups)
  const externalQueries = variants.length > 0 ? variants.slice(0, 4) : [input.query]

  const tasks = sources.flatMap((source) => {
    if (source.source_type === 'external_supabase') return [searchExternalSupabaseSource(source, input)]
    return externalQueries.map((query) => searchExternalRestSource(source, { ...input, query }))
  })

  const externalSettled = await Promise.allSettled(tasks)
  const external = externalSettled.flatMap((result) => {
    if (result.status === 'fulfilled') return result.value
    console.error('[catalog search] external query failed:', result.reason)
    return []
  })

  const unique = new Map<string, CatalogProduct>()
  for (const product of [...internal, ...external]) {
    const key = `${product.sourceName}:${product.id}`
    if (!unique.has(key)) unique.set(key, product)
  }
  return Array.from(unique.values()).slice(0, input.limit)
}
