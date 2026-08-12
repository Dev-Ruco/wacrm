import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { searchCatalogues } from './search'
import type { CatalogProduct } from './types'

export type AgentCatalogSearchMode = 'browse' | 'lookup'

export interface AgentCatalogSearchInput {
  query: string
  category?: string | null
  color?: string | null
  size?: string | null
  limit: number
  mode: AgentCatalogSearchMode
  excludeProductKeys?: string[]
}

export interface RankedAgentCatalogProduct {
  product: CatalogProduct
  productKey: string
  score: number
  sizeMatch: 'match' | 'unknown' | 'mismatch'
}

const MAX_CANDIDATES = 60
const CANDIDATE_MULTIPLIER = 8

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value: string | null | undefined): string[] {
  return normalize(value)
    .split(' ')
    .map((item) => item.trim())
    .filter((item) => item.length >= 2)
}

export function catalogProductKey(product: CatalogProduct): string {
  return `${normalize(product.sourceName) || 'catalog'}:${product.id}`
}

function textIncludesAll(haystack: string, needles: string[]): boolean {
  return needles.length === 0 || needles.every((needle) => haystack.includes(needle))
}

function categoryMatches(product: CatalogProduct, category: string | null | undefined): boolean {
  const required = tokens(category)
  if (required.length === 0) return true
  const explicitCategory = normalize(product.category)
  const fallback = normalize(`${product.name} ${product.description ?? ''}`)
  return textIncludesAll(explicitCategory, required) || textIncludesAll(fallback, required)
}

function colorMatches(product: CatalogProduct, color: string | null | undefined): boolean {
  const required = tokens(color)
  if (required.length === 0) return true
  const values = [
    product.description ?? '',
    ...(product.variants ?? []).map((variant) => variant.color ?? ''),
  ]
  const haystack = normalize(values.join(' '))
  return textIncludesAll(haystack, required)
}

function productSizeMatch(
  product: CatalogProduct,
  size: string | null | undefined,
): 'match' | 'unknown' | 'mismatch' {
  const wanted = normalize(size)
  if (!wanted) return 'unknown'
  const sizes = (product.variants ?? [])
    .map((variant) => normalize(variant.size))
    .filter(Boolean)
  if (sizes.length === 0) return 'unknown'
  return sizes.includes(wanted) ? 'match' : 'mismatch'
}

function relevanceScore(product: CatalogProduct, input: AgentCatalogSearchInput): number {
  const name = normalize(product.name)
  const category = normalize(product.category)
  const description = normalize(product.description)
  const query = normalize(input.query)
  const wantedCategory = normalize(input.category)
  const wantedColor = normalize(input.color)
  let score = 0

  if (query) {
    if (name === query) score += 160
    else if (name.startsWith(query)) score += 100
    else if (name.includes(query)) score += 70
    if (description.includes(query)) score += 25
    if (category.includes(query)) score += 35
  }
  if (wantedCategory) {
    if (category === wantedCategory) score += 120
    else if (category.includes(wantedCategory)) score += 80
    else if (name.includes(wantedCategory)) score += 55
  }
  if (wantedColor && normalize(product.description).includes(wantedColor)) score += 45
  if (product.imageUrl || product.variants?.some((variant) => variant.imageUrl)) score += 20
  if (product.stockQuantity !== null && product.stockQuantity > 0) score += 10

  const sizeMatch = productSizeMatch(product, input.size)
  if (sizeMatch === 'match') score += 50
  if (sizeMatch === 'mismatch') score -= 30
  return score
}

function uniqueProducts(products: CatalogProduct[]): CatalogProduct[] {
  const unique = new Map<string, CatalogProduct>()
  for (const product of products) {
    const key = catalogProductKey(product)
    if (!unique.has(key)) unique.set(key, product)
  }
  return Array.from(unique.values())
}

function retrievalQueries(input: AgentCatalogSearchInput): string[] {
  const candidates = [input.query, input.category, input.color]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean)
  return Array.from(new Set(candidates)).slice(0, 3)
}

/**
 * Agent-facing catalogue retrieval.
 *
 * The legacy search layer is intentionally kept as a broad source adapter.
 * This layer fetches a wider candidate pool, applies explicit category/colour
 * constraints as AND conditions, removes products already shown by the live
 * conversation state, then ranks and limits. It never sends WhatsApp media.
 */
export async function searchCatalogForAgent(
  db: WacrmSupabaseClient,
  accountId: string,
  input: AgentCatalogSearchInput,
): Promise<RankedAgentCatalogProduct[]> {
  const candidateLimit = Math.min(
    MAX_CANDIDATES,
    Math.max(20, input.limit * CANDIDATE_MULTIPLIER),
  )
  const queries = retrievalQueries(input)
  if (queries.length === 0) return []

  const settled = await Promise.allSettled(
    queries.map((query) => searchCatalogues(db, accountId, { query, limit: candidateLimit })),
  )
  const candidates = uniqueProducts(
    settled.flatMap((result) => {
      if (result.status === 'fulfilled') return result.value
      console.warn('[agent catalog search] source query failed:', result.reason)
      return []
    }),
  )

  const excluded = new Set(input.excludeProductKeys ?? [])
  return candidates
    .filter((product) => !excluded.has(catalogProductKey(product)))
    .filter((product) => categoryMatches(product, input.category))
    .filter((product) => colorMatches(product, input.color))
    .map((product) => ({
      product,
      productKey: catalogProductKey(product),
      score: relevanceScore(product, input),
      sizeMatch: productSizeMatch(product, input.size),
    }))
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'pt'))
    .slice(0, input.limit)
}
