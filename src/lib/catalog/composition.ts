import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { CatalogProduct, CatalogProductVariant } from './types'

export interface CompositionSlot {
  id: string
  key: string
  label: string
  required: boolean
  minItems: number
  maxItems: number
  offeringTypeIds: string[]
}

export interface CompositionTemplate {
  id: string
  key: string
  label: string
  description: string | null
  slots: CompositionSlot[]
}

export interface CompositionEvidence {
  relationKey: string
  score: number
  confidence: number | null
  verified: boolean
  anchorProductId: string
}

export interface CompositionSelection {
  product: CatalogProduct
  reason: 'kept' | 'relation' | 'eligible_fallback'
  relation: CompositionEvidence | null
}

export interface CompositionResult {
  template: Pick<CompositionTemplate, 'id' | 'key' | 'label' | 'description'>
  slots: Array<{ slot: CompositionSlot; selections: CompositionSelection[]; complete: boolean }>
  complete: boolean
}

export interface PersistedCompositionItem {
  productId: string
  productKey: string
  name: string
}

export interface PersistedCompositionState {
  slots: Record<string, PersistedCompositionItem[]>
}

export interface ComposeCatalogSolutionInput {
  templateKey: string
  anchorProductId?: string | null
  existingState?: PersistedCompositionState | null
  keepSlots?: string[]
  replaceSlots?: string[]
  maxPerSlot?: number
}

type ProductRow = {
  id: string
  offering_type_id: string | null
  name: string
  description: string | null
  color: string | null
  price: number | string
  currency: string
  image_url: string | null
  product_url: string | null
  category: string | null
  stock_quantity: number | null
}

type RelationRow = {
  source_product_id: string
  target_product_id: string
  relation_key: string
  score: number | string
  confidence: number | string | null
  verified: boolean
}

const PRODUCT_SELECT = 'id, offering_type_id, name, description, color, price, currency, image_url, product_url, category, stock_quantity'

function numberValue(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function available(product: CatalogProduct): boolean {
  return product.stockQuantity === null || product.stockQuantity > 0
}

function hasMedia(product: CatalogProduct): boolean {
  return Boolean(product.imageUrl || product.variants?.some((variant) => variant.imageUrl))
}

function eligible(product: CatalogProduct, slot: CompositionSlot): boolean {
  return available(product) && (
    slot.offeringTypeIds.length === 0 ||
    Boolean(product.offeringTypeId && slot.offeringTypeIds.includes(product.offeringTypeId))
  )
}

function relationRank(evidence: CompositionEvidence): number {
  return evidence.score * 1000 + (evidence.verified ? 120 : 0) + (evidence.confidence ?? 0) * 40
}

export function chooseBetterRelation(
  current: CompositionEvidence | null,
  candidate: CompositionEvidence,
): CompositionEvidence {
  if (!current) return candidate
  const delta = relationRank(candidate) - relationRank(current)
  if (delta !== 0) return delta > 0 ? candidate : current
  return candidate.relationKey.localeCompare(current.relationKey) < 0 ? candidate : current
}

export function compositionResultToState(result: CompositionResult): PersistedCompositionState {
  return {
    slots: Object.fromEntries(result.slots.map(({ slot, selections }) => [
      slot.key,
      selections.map(({ product }) => ({
        productId: product.id,
        productKey: `catalogo interno:${product.id}`,
        name: product.name,
      })),
    ])),
  }
}

async function hydrateVariants(
  db: WacrmSupabaseClient,
  accountId: string,
  productIds: string[],
): Promise<Map<string, CatalogProductVariant[]>> {
  if (!productIds.length) return new Map()
  const { data, error } = await db
    .from('catalog_product_variants')
    .select('id, product_id, size, color, stock_quantity, image_url')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .in('product_id', productIds)
  if (error) {
    console.warn('[composition] variant hydration failed:', error.message)
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

async function rowsToProducts(
  db: WacrmSupabaseClient,
  accountId: string,
  rows: ProductRow[],
): Promise<CatalogProduct[]> {
  const variants = await hydrateVariants(db, accountId, rows.map((row) => row.id))
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.color
      ? `Cor: ${row.color}.${row.description ? ` ${row.description}` : ''}`
      : row.description,
    price: numberValue(row.price),
    currency: row.currency,
    imageUrl: row.image_url,
    productUrl: row.product_url,
    category: row.category,
    stockQuantity: row.stock_quantity,
    offeringTypeId: row.offering_type_id,
    variants: variants.get(row.id),
    sourceName: 'Catálogo interno',
    sourceType: 'internal',
  }))
}

async function loadProducts(
  db: WacrmSupabaseClient,
  accountId: string,
  ids: string[],
): Promise<CatalogProduct[]> {
  const productIds = unique(ids)
  if (!productIds.length) return []
  const { data, error } = await db
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .in('id', productIds)
  if (error) throw new Error(`Composition product lookup failed: ${error.message}`)
  return rowsToProducts(db, accountId, (data ?? []) as ProductRow[])
}

async function loadFallbackProducts(
  db: WacrmSupabaseClient,
  accountId: string,
  offeringTypeIds: string[],
): Promise<CatalogProduct[]> {
  // Unconstrained slots are graph-only. Falling back to the full catalogue
  // would create arbitrary cross-domain combinations.
  if (!offeringTypeIds.length) return []
  const { data, error } = await db
    .from('catalog_products')
    .select(PRODUCT_SELECT)
    .eq('account_id', accountId)
    .eq('is_active', true)
    .in('offering_type_id', offeringTypeIds)
    .limit(120)
  if (error) throw new Error(`Composition fallback lookup failed: ${error.message}`)
  return rowsToProducts(db, accountId, (data ?? []) as ProductRow[])
}

export async function loadCompositionTemplate(
  db: WacrmSupabaseClient,
  accountId: string,
  templateKey: string,
): Promise<CompositionTemplate | null> {
  const key = templateKey.trim()
  if (!key) return null
  const { data: template, error: templateError } = await db
    .from('composition_templates')
    .select('id, key, label, description')
    .eq('account_id', accountId)
    .eq('key', key)
    .eq('enabled', true)
    .maybeSingle()
  if (templateError) throw new Error(`Composition template lookup failed: ${templateError.message}`)
  if (!template) return null

  const { data: slotRows, error: slotError } = await db
    .from('composition_slots')
    .select('id, key, label, required, min_items, max_items, sort_order')
    .eq('account_id', accountId)
    .eq('template_id', template.id)
    .order('sort_order')
    .order('key')
  if (slotError) throw new Error(`Composition slot lookup failed: ${slotError.message}`)

  const slotIds = (slotRows ?? []).map((row) => String(row.id))
  const typeResult = slotIds.length
    ? await db.from('composition_slot_offering_types')
        .select('slot_id, offering_type_id')
        .eq('account_id', accountId)
        .in('slot_id', slotIds)
    : { data: [], error: null }
  if (typeResult.error) throw new Error(`Composition slot type lookup failed: ${typeResult.error.message}`)

  const typesBySlot = new Map<string, string[]>()
  for (const row of typeResult.data ?? []) {
    const id = String(row.slot_id)
    typesBySlot.set(id, [...(typesBySlot.get(id) ?? []), String(row.offering_type_id)])
  }
  return {
    id: String(template.id),
    key: String(template.key),
    label: String(template.label),
    description: template.description ?? null,
    slots: (slotRows ?? []).map((row) => ({
      id: String(row.id),
      key: String(row.key),
      label: String(row.label),
      required: Boolean(row.required),
      minItems: Math.max(0, Number(row.min_items) || 0),
      maxItems: Math.max(1, Number(row.max_items) || 1),
      offeringTypeIds: unique(typesBySlot.get(String(row.id)) ?? []),
    })),
  }
}

async function loadRelations(
  db: WacrmSupabaseClient,
  accountId: string,
  anchors: string[],
): Promise<RelationRow[]> {
  const ids = unique(anchors).slice(0, 24)
  if (!ids.length) return []
  const select = 'source_product_id, target_product_id, relation_key, score, confidence, verified'
  const [outgoing, incoming] = await Promise.all([
    db.from('catalog_product_relations').select(select).eq('account_id', accountId)
      .in('source_product_id', ids).order('score', { ascending: false }).limit(250),
    db.from('catalog_product_relations').select(select).eq('account_id', accountId)
      .in('target_product_id', ids).order('score', { ascending: false }).limit(250),
  ])
  if (outgoing.error) throw new Error(`Composition relation lookup failed: ${outgoing.error.message}`)
  if (incoming.error) throw new Error(`Composition relation lookup failed: ${incoming.error.message}`)
  const dedup = new Map<string, RelationRow>()
  for (const row of [...(outgoing.data ?? []), ...(incoming.data ?? [])] as RelationRow[]) {
    dedup.set(`${row.source_product_id}:${row.target_product_id}:${row.relation_key}`, row)
  }
  return Array.from(dedup.values())
}

function evidenceFor(
  relations: RelationRow[],
  anchors: Set<string>,
  candidateId: string,
): CompositionEvidence | null {
  let best: CompositionEvidence | null = null
  for (const row of relations) {
    const anchor = row.target_product_id === candidateId && anchors.has(row.source_product_id)
      ? row.source_product_id
      : row.source_product_id === candidateId && anchors.has(row.target_product_id)
        ? row.target_product_id
        : null
    if (!anchor) continue
    best = chooseBetterRelation(best, {
      relationKey: row.relation_key,
      score: numberValue(row.score),
      confidence: row.confidence === null ? null : numberValue(row.confidence),
      verified: Boolean(row.verified),
      anchorProductId: anchor,
    })
  }
  return best
}

export async function composeCatalogSolution(
  db: WacrmSupabaseClient,
  accountId: string,
  input: ComposeCatalogSolutionInput,
): Promise<CompositionResult | null> {
  const template = await loadCompositionTemplate(db, accountId, input.templateKey)
  if (!template) return null
  const existing = input.existingState?.slots ?? {}
  const keep = new Set(input.keepSlots ?? [])
  const replace = new Set(input.replaceSlots ?? [])
  const validSlots = new Set(template.slots.map((slot) => slot.key))
  for (const key of [...keep, ...replace]) {
    if (!validSlots.has(key)) throw new Error(`Unknown composition slot: ${key}`)
  }

  const existingIds = unique(Object.values(existing).flat().map((item) => item.productId))
  const keptIds = unique(template.slots.flatMap((slot) =>
    keep.has(slot.key) && !replace.has(slot.key)
      ? (existing[slot.key] ?? []).map((item) => item.productId)
      : [],
  ))
  const initialIds = unique([...existingIds, ...keptIds, ...(input.anchorProductId ? [input.anchorProductId] : [])])
  const initialProducts = await loadProducts(db, accountId, initialIds)
  const products = new Map(initialProducts.map((product) => [product.id, product]))
  if (input.anchorProductId && !products.has(input.anchorProductId)) {
    throw new Error('The anchor offering is not an active canonical catalogue item.')
  }

  const initialAnchors = unique([...(input.anchorProductId ? [input.anchorProductId] : []), ...keptIds])
  const relations = await loadRelations(db, accountId, initialAnchors)
  const relatedIds = unique(relations.flatMap((row) => [row.source_product_id, row.target_product_id]))
    .filter((id) => !products.has(id))
  for (const product of await loadProducts(db, accountId, relatedIds)) products.set(product.id, product)

  const used = new Set<string>()
  const dynamicAnchors = new Set(initialAnchors)
  const maxPerSlot = Math.min(5, Math.max(1, Math.floor(input.maxPerSlot ?? 1)))
  const results: CompositionResult['slots'] = []

  for (const slot of template.slots) {
    const target = Math.min(slot.maxItems, maxPerSlot)
    const selections: CompositionSelection[] = []

    if (keep.has(slot.key) && !replace.has(slot.key)) {
      for (const item of existing[slot.key] ?? []) {
        const product = products.get(item.productId)
        if (!product || !eligible(product, slot) || used.has(product.id)) continue
        selections.push({ product, reason: 'kept', relation: null })
        used.add(product.id)
        dynamicAnchors.add(product.id)
        if (selections.length >= target) break
      }
    }

    if (selections.length < target && dynamicAnchors.size) {
      const anchors = new Set(dynamicAnchors)
      const graphCandidates = Array.from(products.values())
        .filter((product) => !anchors.has(product.id) && !used.has(product.id) && eligible(product, slot))
        .map((product) => ({ product, evidence: evidenceFor(relations, anchors, product.id) }))
        .filter((item): item is { product: CatalogProduct; evidence: CompositionEvidence } => Boolean(item.evidence))
        .sort((a, b) => relationRank(b.evidence) - relationRank(a.evidence) || a.product.name.localeCompare(b.product.name, 'pt'))
      for (const item of graphCandidates) {
        selections.push({ product: item.product, reason: 'relation', relation: item.evidence })
        used.add(item.product.id)
        dynamicAnchors.add(item.product.id)
        if (selections.length >= target) break
      }
    }

    if (selections.length < target && slot.offeringTypeIds.length) {
      const fallback = (await loadFallbackProducts(db, accountId, slot.offeringTypeIds))
        .filter((product) => !used.has(product.id) && eligible(product, slot))
        .sort((a, b) => Number(hasMedia(b)) - Number(hasMedia(a)) || a.name.localeCompare(b.name, 'pt'))
      for (const product of fallback) {
        selections.push({ product, reason: 'eligible_fallback', relation: null })
        used.add(product.id)
        dynamicAnchors.add(product.id)
        if (selections.length >= target) break
      }
    }

    results.push({
      slot,
      selections,
      complete: !slot.required || selections.length >= slot.minItems,
    })
  }

  return {
    template: { id: template.id, key: template.key, label: template.label, description: template.description },
    slots: results,
    complete: results.every((result) => result.complete),
  }
}
