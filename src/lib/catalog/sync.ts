import { createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { CatalogSourceRow, ExternalFieldMapping } from './types'

const PAGE_SIZE = 500
const MAX_SYNC_ITEMS = 20_000
const REQUEST_TIMEOUT_MS = 15_000

interface NormalizedVariant {
  externalId: string
  size: string | null
  color: string | null
  stockQuantity: number | null
  imageUrl: string | null
}

interface NormalizedSourceProduct {
  externalId: string
  name: string
  description: string | null
  price: number
  currency: string
  imageUrl: string | null
  productUrl: string | null
  category: string | null
  stockQuantity: number | null
  variants: NormalizedVariant[]
}

export interface CatalogSyncResult {
  runId: string
  fetchedCount: number
  createdCount: number
  updatedCount: number
  unchangedCount: number
  missingCount: number
}

function safeIdentifier(value: string | undefined, fallback?: string): string {
  const candidate = (value || fallback || '').trim()
  if (!candidate || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
    throw new Error(`Invalid external catalogue identifier: ${candidate || '(empty)'}`)
  }
  return candidate
}

function optionalIdentifier(value: string | undefined): string | null {
  return value?.trim() ? safeIdentifier(value) : null
}

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

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeProduct(item: unknown, mapping: ExternalFieldMapping): NormalizedSourceProduct | null {
  const externalId = text(firstValueAt(item, [mapping.id, 'id', 'sku', 'external_id']))
  const name = text(firstValueAt(item, [mapping.name, 'name', 'title', 'product_name']))
  const price = numberValue(firstValueAt(item, [mapping.price, 'price', 'price_mt', 'base_price', 'amount', 'unit_price', 'base_price_mt']))
  if (!externalId || !name || price === null || price < 0) return null

  return {
    externalId,
    name,
    description: text(firstValueAt(item, [mapping.description, 'description', 'short_description', 'summary'])),
    price,
    currency: text(firstValueAt(item, [mapping.currency, 'currency', 'currency_code'])) ?? 'MZN',
    imageUrl: text(firstValueAt(item, [mapping.imageUrl, 'image_url', 'imageUrl', 'thumbnail', 'image', 'images.0.url', 'images.0'])),
    productUrl: text(firstValueAt(item, [mapping.productUrl, 'product_url', 'productUrl', 'url', 'link'])),
    category: text(firstValueAt(item, [mapping.category, 'category.name', 'category', 'type', 'product_type'])),
    stockQuantity: numberValue(firstValueAt(item, [mapping.stockQuantity, 'stock_quantity', 'stockQuantity', 'stock', 'quantity', 'current_stock'])),
    variants: [],
  }
}

function productPayload(product: NormalizedSourceProduct): Record<string, unknown> {
  return {
    external_id: product.externalId,
    name: product.name,
    description: product.description,
    price: product.price,
    currency: product.currency,
    image_url: product.imageUrl,
    product_url: product.productUrl,
    category: product.category,
    stock_quantity: product.stockQuantity,
  }
}

function hashPayload(payload: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function assertSafeExternalUrl(raw: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:') throw new Error('External catalogue URL must use HTTPS.')
  const host = url.hostname.toLowerCase()
  if (
    host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
    host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) throw new Error('Private network catalogue URLs are not allowed.')
  return url.toString().replace(/\/$/, '')
}

async function withTimeout<T>(promise: PromiseLike<T>, message: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), REQUEST_TIMEOUT_MS)),
  ])
}

async function fetchSupabaseSnapshot(source: CatalogSourceRow): Promise<NormalizedSourceProduct[]> {
  if (!source.base_url || !source.auth_secret_encrypted) {
    throw new Error('External Supabase source is missing URL or credentials.')
  }
  const mapping = source.field_mapping ?? {}
  const schema = safeIdentifier(mapping.schema, 'public')
  const table = safeIdentifier(mapping.table)
  const key = decrypt(source.auth_secret_encrypted)
  const client = createClient(assertSafeExternalUrl(source.base_url), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema },
    global: { headers: { 'X-WACRM-Source': source.id } },
  })

  const productRows: unknown[] = []
  for (let offset = 0; offset < MAX_SYNC_ITEMS; offset += PAGE_SIZE) {
    let query = client.from(table).select('*').range(offset, offset + PAGE_SIZE - 1)
    if (mapping.activeColumn) query = query.eq(safeIdentifier(mapping.activeColumn), true)
    if (mapping.publishedColumn) query = query.eq(safeIdentifier(mapping.publishedColumn), true)
    const { data, error } = await withTimeout(query, `External Supabase source ${source.name} timed out.`)
    if (error) throw new Error(`External Supabase source ${source.name} failed: ${error.message}`)
    const page = Array.isArray(data) ? data as unknown[] : []
    productRows.push(...page)
    if (page.length < PAGE_SIZE) break
    if (productRows.length >= MAX_SYNC_ITEMS) {
      throw new Error(`Source ${source.name} exceeds the safe sync limit of ${MAX_SYNC_ITEMS} products.`)
    }
  }

  const products = productRows
    .map((row) => normalizeProduct(row, mapping))
    .filter((row): row is NormalizedSourceProduct => row !== null)

  if (!mapping.variantsTable || products.length === 0) return products

  const variantsTable = safeIdentifier(mapping.variantsTable)
  const variantId = safeIdentifier(mapping.variantId, 'id')
  const variantProductId = safeIdentifier(mapping.variantProductId, 'product_id')
  const variantSize = optionalIdentifier(mapping.variantSize)
  const variantColor = optionalIdentifier(mapping.variantColor)
  const variantStock = optionalIdentifier(mapping.variantStock)
  const variantImage = optionalIdentifier(mapping.variantImageUrl)
  const productIds = new Set(products.map((product) => product.externalId))
  const variantsByProduct = new Map<string, NormalizedVariant[]>()

  for (let offset = 0; offset < MAX_SYNC_ITEMS * 10; offset += PAGE_SIZE) {
    let query = client.from(variantsTable).select('*').range(offset, offset + PAGE_SIZE - 1)
    if (mapping.variantActiveColumn) query = query.eq(safeIdentifier(mapping.variantActiveColumn), true)
    const { data, error } = await withTimeout(query, `External Supabase variants ${source.name} timed out.`)
    if (error) throw new Error(`External Supabase variants ${source.name} failed: ${error.message}`)
    const page = Array.isArray(data) ? data as Record<string, unknown>[] : []
    for (const row of page) {
      const parentId = String(row[variantProductId] ?? '')
      if (!parentId || !productIds.has(parentId)) continue
      const externalId = String(row[variantId] ?? '').trim()
      if (!externalId) continue
      const current = variantsByProduct.get(parentId) ?? []
      current.push({
        externalId,
        size: variantSize ? text(row[variantSize]) : null,
        color: variantColor ? text(row[variantColor]) : null,
        stockQuantity: variantStock ? numberValue(row[variantStock]) : null,
        imageUrl: variantImage ? text(row[variantImage]) : null,
      })
      variantsByProduct.set(parentId, current)
    }
    if (page.length < PAGE_SIZE) break
  }

  return products.map((product) => ({
    ...product,
    variants: variantsByProduct.get(product.externalId) ?? [],
  }))
}

async function replaceCanonicalVariants(
  db: WacrmSupabaseClient,
  accountId: string,
  sourceId: string,
  productId: string,
  variants: readonly NormalizedVariant[],
): Promise<void> {
  const incomingIds = variants.map((variant) => variant.externalId)
  if (incomingIds.length === 0) {
    const { error } = await db
      .from('catalog_product_variants')
      .update({ is_active: false })
      .eq('account_id', accountId)
      .eq('source_id', sourceId)
      .eq('product_id', productId)
    if (error) throw error
    return
  }

  for (const variant of variants) {
    const payload = {
      account_id: accountId,
      product_id: productId,
      source_id: sourceId,
      external_id: variant.externalId,
      size: variant.size,
      color: variant.color,
      stock_quantity: variant.stockQuantity,
      image_url: variant.imageUrl,
      is_active: true,
    }
    const { error } = await db
      .from('catalog_product_variants')
      .upsert(payload, { onConflict: 'source_id,external_id' })
    if (error) throw error
  }

  const { error: staleError } = await db
    .from('catalog_product_variants')
    .update({ is_active: false })
    .eq('account_id', accountId)
    .eq('source_id', sourceId)
    .eq('product_id', productId)
    .not('external_id', 'in', `(${incomingIds.map((id) => `"${id.replaceAll('"', '\\"')}"`).join(',')})`)
  if (staleError) throw staleError
}

export async function syncCanonicalCatalogSource(
  db: WacrmSupabaseClient,
  accountId: string,
  sourceId: string,
): Promise<CatalogSyncResult> {
  const { data: sourceData, error: sourceError } = await db
    .from('catalog_sources')
    .select('*')
    .eq('id', sourceId)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .maybeSingle()
  if (sourceError) throw sourceError
  if (!sourceData) throw new Error('Catalogue source not found or inactive.')
  const source = sourceData as CatalogSourceRow
  if (source.source_type !== 'external_supabase') {
    throw new Error('Canonical snapshot sync currently requires an external Supabase source.')
  }

  const { data: run, error: runError } = await db
    .from('catalog_sync_runs')
    .insert({ account_id: accountId, source_id: sourceId, status: 'running', trigger_type: 'manual' })
    .select('id')
    .single()
  if (runError) throw runError
  const runId = run.id as string

  await db.from('catalog_sources').update({
    last_sync_status: 'running',
    last_sync_error: null,
  }).eq('id', sourceId).eq('account_id', accountId)

  try {
    const snapshot = await fetchSupabaseSnapshot(source)
    const { data: existingRows, error: recordsError } = await db
      .from('catalog_source_records')
      .select('external_id, product_id, content_hash')
      .eq('account_id', accountId)
      .eq('source_id', sourceId)
    if (recordsError) throw recordsError

    const existing = new Map((existingRows ?? []).map((row) => [String(row.external_id), row]))
    const seen = new Set<string>()
    let createdCount = 0
    let updatedCount = 0
    let unchangedCount = 0

    for (const product of snapshot) {
      seen.add(product.externalId)
      const payload = productPayload(product)
      const contentHash = hashPayload(payload)
      const record = existing.get(product.externalId)
      let productId = record?.product_id ? String(record.product_id) : null

      if (!productId) {
        const { data: inserted, error: insertError } = await db
          .from('catalog_products')
          .insert({
            account_id: accountId,
            source_id: sourceId,
            external_id: product.externalId,
            name: product.name,
            description: product.description,
            price: product.price,
            currency: product.currency,
            image_url: product.imageUrl,
            product_url: product.productUrl,
            category: product.category,
            stock_quantity: product.stockQuantity,
            is_active: true,
            metadata: { canonical_source: sourceId },
          })
          .select('id')
          .single()
        if (insertError) throw insertError
        productId = String(inserted.id)
        createdCount += 1
      } else if (record?.content_hash !== contentHash) {
        const { error: updateError } = await db
          .from('catalog_products')
          .update({
            external_id: product.externalId,
            name: product.name,
            description: product.description,
            price: product.price,
            currency: product.currency,
            image_url: product.imageUrl,
            product_url: product.productUrl,
            category: product.category,
            stock_quantity: product.stockQuantity,
            is_active: true,
          })
          .eq('id', productId)
          .eq('account_id', accountId)
        if (updateError) throw updateError
        updatedCount += 1
      } else {
        unchangedCount += 1
        await db.from('catalog_products').update({ is_active: true }).eq('id', productId).eq('account_id', accountId)
      }

      await replaceCanonicalVariants(db, accountId, sourceId, productId, product.variants)

      const { error: recordError } = await db
        .from('catalog_source_records')
        .upsert({
          account_id: accountId,
          source_id: sourceId,
          external_id: product.externalId,
          product_id: productId,
          normalized_payload: payload,
          content_hash: contentHash,
          last_seen_at: new Date().toISOString(),
          missing_since: null,
        }, { onConflict: 'source_id,external_id' })
      if (recordError) throw recordError
    }

    const missing = (existingRows ?? []).filter((row) => !seen.has(String(row.external_id)))
    for (const row of missing) {
      const now = new Date().toISOString()
      await db.from('catalog_source_records')
        .update({ missing_since: now })
        .eq('account_id', accountId)
        .eq('source_id', sourceId)
        .eq('external_id', row.external_id)
      await db.from('catalog_products')
        .update({ is_active: false })
        .eq('account_id', accountId)
        .eq('id', row.product_id)
    }

    const finishedAt = new Date().toISOString()
    const result: CatalogSyncResult = {
      runId,
      fetchedCount: snapshot.length,
      createdCount,
      updatedCount,
      unchangedCount,
      missingCount: missing.length,
    }
    await db.from('catalog_sync_runs').update({
      status: 'succeeded',
      fetched_count: result.fetchedCount,
      created_count: result.createdCount,
      updated_count: result.updatedCount,
      unchanged_count: result.unchangedCount,
      missing_count: result.missingCount,
      finished_at: finishedAt,
    }).eq('id', runId).eq('account_id', accountId)
    await db.from('catalog_sources').update({
      last_synced_at: finishedAt,
      last_sync_status: 'succeeded',
      last_sync_error: null,
    }).eq('id', sourceId).eq('account_id', accountId)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Unknown catalogue sync error.'
    const finishedAt = new Date().toISOString()
    await db.from('catalog_sync_runs').update({
      status: 'failed',
      error_message: message,
      finished_at: finishedAt,
    }).eq('id', runId).eq('account_id', accountId)
    await db.from('catalog_sources').update({
      last_sync_status: 'failed',
      last_sync_error: message,
    }).eq('id', sourceId).eq('account_id', accountId)
    throw error
  }
}
