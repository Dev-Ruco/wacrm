import type { WacrmSupabaseClient } from '@/lib/supabase/types'

interface SiteProductMetadata {
  source: string | null
  productId: string | null
  productName: string | null
  productPriceMt: number | null
  productImage: string | null
}

interface CanonicalProduct {
  id: string
  name: string
  description: string | null
  category: string | null
  price: number
  currency: string
  imageUrl: string | null
  stockQuantity: number | null
}

interface CanonicalVariant {
  id: string
  sku: string | null
  size: string | null
  color: string | null
  price: number | null
  stockQuantity: number | null
  imageUrl: string | null
}

export interface SiteProductContext {
  metadata: SiteProductMetadata
  canonical: CanonicalProduct | null
  variants: CanonicalVariant[]
  matchedBy: 'product_id' | 'image_url' | 'variant_image_url' | null
}

function stringValue(value: unknown, max = 2_000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function httpsImage(value: unknown): string | null {
  const raw = stringValue(value)
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function metadataFrom(value: unknown): SiteProductMetadata | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const source = stringValue(row.source, 100)
  const productId = stringValue(row.product_id, 256)
  const productName = stringValue(row.product_name, 300)
  const productPriceMt = numberValue(row.product_price_mt)
  const productImage = httpsImage(row.product_image)

  if (source !== 'product_detail' || (!productId && !productImage)) return null
  return { source, productId, productName, productPriceMt, productImage }
}

function canonicalFrom(row: Record<string, unknown>): CanonicalProduct {
  return {
    id: String(row.id),
    name: String(row.name),
    description: stringValue(row.description, 1_000),
    category: stringValue(row.category, 300),
    price: Number(row.price),
    currency: stringValue(row.currency, 20) ?? 'MZN',
    imageUrl: httpsImage(row.image_url),
    stockQuantity: row.stock_quantity == null ? null : numberValue(row.stock_quantity),
  }
}

async function canonicalById(
  db: WacrmSupabaseClient,
  accountId: string,
  productId: string,
): Promise<CanonicalProduct | null> {
  const { data, error } = await db
    .from('catalog_products')
    .select('id, name, description, category, price, currency, image_url, stock_quantity')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .eq('id', productId)
    .maybeSingle()
  if (error) throw error
  return data ? canonicalFrom(data as Record<string, unknown>) : null
}

async function canonicalByExactImage(
  db: WacrmSupabaseClient,
  accountId: string,
  imageUrl: string,
): Promise<{ product: CanonicalProduct; matchedBy: 'image_url' | 'variant_image_url' } | null> {
  const direct = await db
    .from('catalog_products')
    .select('id, name, description, category, price, currency, image_url, stock_quantity')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .eq('image_url', imageUrl)
    .limit(2)
  if (direct.error) throw direct.error
  if ((direct.data ?? []).length === 1) {
    return {
      product: canonicalFrom(direct.data![0] as Record<string, unknown>),
      matchedBy: 'image_url',
    }
  }

  const variantMatches = await db
    .from('catalog_product_variants')
    .select('product_id')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .eq('image_url', imageUrl)
    .limit(10)
  if (variantMatches.error) throw variantMatches.error

  const productIds = [...new Set((variantMatches.data ?? []).map((row) => String(row.product_id)).filter(Boolean))]
  if (productIds.length !== 1) return null
  const product = await canonicalById(db, accountId, productIds[0])
  return product ? { product, matchedBy: 'variant_image_url' } : null
}

async function variantsForProduct(
  db: WacrmSupabaseClient,
  accountId: string,
  productId: string,
): Promise<CanonicalVariant[]> {
  const { data, error } = await db
    .from('catalog_product_variants')
    .select('id, sku, size, color, price, stock_quantity, image_url')
    .eq('account_id', accountId)
    .eq('product_id', productId)
    .eq('is_active', true)
    .limit(100)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: String(row.id),
    sku: row.sku == null ? null : String(row.sku),
    size: row.size == null ? null : String(row.size),
    color: row.color == null ? null : String(row.color),
    price: row.price == null ? null : Number(row.price),
    stockQuantity: row.stock_quantity == null ? null : Number(row.stock_quantity),
    imageUrl: httpsImage(row.image_url),
  }))
}

export async function loadSiteProductContext(
  db: WacrmSupabaseClient,
  accountId: string,
  conversationId: string,
): Promise<SiteProductContext | null> {
  const { data: conversation, error } = await db
    .from('conversations')
    .select('channel, source_metadata')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  if (!conversation || conversation.channel !== 'website') return null

  const metadata = metadataFrom(conversation.source_metadata)
  if (!metadata) return null

  let canonical: CanonicalProduct | null = null
  let matchedBy: SiteProductContext['matchedBy'] = null

  if (metadata.productId) {
    canonical = await canonicalById(db, accountId, metadata.productId)
    if (canonical) matchedBy = 'product_id'
  }

  if (!canonical && metadata.productImage) {
    const imageMatch = await canonicalByExactImage(db, accountId, metadata.productImage)
    if (imageMatch) {
      canonical = imageMatch.product
      matchedBy = imageMatch.matchedBy
    }
  }

  const variants = canonical
    ? await variantsForProduct(db, accountId, canonical.id)
    : []

  return { metadata, canonical, variants, matchedBy }
}

export function siteProductContextPrompt(context: SiteProductContext): string {
  const { metadata, canonical, variants, matchedBy } = context
  const lines = [
    'SITE PRODUCT REFERENCE — AUTHORITATIVE:',
    'The customer clicked a specific product on the website. The selected IMAGE and stable product identifiers are the source of truth for what they mean.',
    'Do NOT identify or replace this product by matching its displayed name or price. Website/catalogue names may have changed, and multiple products may share a price.',
    metadata.productId ? `Website product id: ${JSON.stringify(metadata.productId)}.` : null,
    metadata.productImage ? `Exact selected image URL: ${JSON.stringify(metadata.productImage)}.` : null,
    metadata.productName ? `Website display name (informational only, NOT identity): ${JSON.stringify(metadata.productName)}.` : null,
    metadata.productPriceMt !== null ? `Website displayed price (informational only, NOT identity): ${metadata.productPriceMt} MT.` : null,
  ].filter((line): line is string => Boolean(line))

  if (!canonical) {
    lines.push(
      'No canonical catalogue row was confirmed by stable id or exact image URL.',
      'The actual image attached to the customer message remains the authoritative visual referent. Do not search by name/price and pretend that a different catalogue item is the same product.',
      'You may discuss what is visually present. For stock, variants or catalogue facts that cannot be confirmed for this exact image, say that verification is required instead of substituting another product.',
    )
    return lines.join('\n')
  }

  lines.push(
    `Exact canonical catalogue match confirmed by ${matchedBy}.`,
    `Canonical product id: ${JSON.stringify(canonical.id)}.`,
    `Current catalogue name: ${JSON.stringify(canonical.name)} (secondary label only).`,
    `Current catalogue price: ${canonical.price} ${canonical.currency}.`,
    canonical.category ? `Category: ${JSON.stringify(canonical.category)}.` : '',
    canonical.stockQuantity !== null ? `Current product stock quantity: ${canonical.stockQuantity}.` : '',
    canonical.imageUrl ? `Canonical image URL: ${JSON.stringify(canonical.imageUrl)}.` : '',
    'Keep this exact canonical item as the current referent. Do not run a broad text search to identify a replacement.',
  )

  if (variants.length > 0) {
    lines.push('Verified variants for this exact canonical product:')
    for (const variant of variants.slice(0, 30)) {
      lines.push(JSON.stringify({
        id: variant.id,
        sku: variant.sku,
        size: variant.size,
        color: variant.color,
        price: variant.price,
        stock_quantity: variant.stockQuantity,
        image_url: variant.imageUrl,
      }))
    }
  }

  return lines.filter(Boolean).join('\n')
}
