import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import {
  catalogAttributeConstraintSearchTerms,
  loadCatalogAttributeDefinitions,
  loadCatalogProductAttributeValues,
  normalizeCatalogAttributeConstraints,
  productMatchesCatalogAttributeConstraints,
  type CatalogAttributeConstraint,
  type CatalogAttributeScalar,
} from './attributes'
import { searchCatalogues } from './search'
import { loadCatalogTaxonomy, type CatalogTaxonomyGroups } from './taxonomy'
import type { CatalogProduct } from './types'

export type AgentCatalogSearchMode = 'browse' | 'lookup'

export interface AgentCatalogSearchInput {
  query: string
  category?: string | null
  color?: string | null
  size?: string | null
  /** Tenant-defined hard constraints. Unknown keys/values never silently pass. */
  attributes?: Record<string, CatalogAttributeScalar>
  limit: number
  mode: AgentCatalogSearchMode
  excludeProductKeys?: string[]
}

export interface RankedAgentCatalogProduct {
  product: CatalogProduct
  productKey: string
  score: number
  sizeMatch: 'match' | 'unknown' | 'mismatch'
  matchedAttributes?: Record<string, string>
}

const MAX_CANDIDATES = 60
const CANDIDATE_MULTIPLIER = 8
const MAX_RETRIEVAL_QUERIES = 12
const INTERNAL_SOURCE_NAME = 'Catálogo interno'

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

function bestAliasGroup(
  requested: string,
  groups: readonly (readonly string[])[],
): string[] | null {
  const candidates = groups
    .map((group) => group.map(normalize))
    .map((group) => ({
      group,
      score: Math.max(
        0,
        ...group.map((alias) => {
          if (requested === alias) return 10_000 + alias.length
          if (requested.includes(alias) || alias.includes(requested)) return alias.length
          return 0
        }),
      ),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
  return candidates[0]?.group ?? null
}

function matchesAliases(
  haystack: string,
  requested: string | null | undefined,
  groups: readonly (readonly string[])[],
): boolean {
  const normalizedRequested = normalize(requested)
  if (!normalizedRequested) return true
  const matchingGroup = bestAliasGroup(normalizedRequested, groups)
  if (matchingGroup) return matchingGroup.some((alias) => haystack.includes(alias))
  return textIncludesAll(haystack, tokens(normalizedRequested))
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false
  return (` ${haystack} `).includes(` ${phrase} `)
}

/**
 * Generic catalogue safety gate. It uses ONLY the current tenant's configured
 * category taxonomy. If a product name clearly names a different configured
 * category than the one requested, the stale/incorrect stored category is not
 * allowed to win merely because it would otherwise receive the exact-category
 * ranking bonus. Products whose names do not contain any known category remain
 * eligible, so this is deliberately conservative rather than a classifier.
 */
export function catalogNameConflictsWithRequestedCategory(
  productName: string,
  requestedCategory: string | null | undefined,
  categoryGroups: readonly (readonly string[])[],
): boolean {
  const requested = normalize(requestedCategory)
  if (!requested || categoryGroups.length === 0) return false

  const requestedGroup = bestAliasGroup(requested, categoryGroups)
  if (!requestedGroup) return false

  const normalizedName = normalize(productName)
  if (!normalizedName) return false

  const matchedGroups = categoryGroups
    .map((group) => group.map(normalize).filter(Boolean))
    .filter((group) => group.some((alias) => containsPhrase(normalizedName, alias)))

  if (matchedGroups.length === 0) return false
  const explicitlyMatchesRequested = matchedGroups.some((group) =>
    group.some((alias) => requestedGroup.includes(alias)),
  )
  return !explicitlyMatchesRequested
}

function categoryMatches(
  product: CatalogProduct,
  category: string | null | undefined,
  taxonomy: CatalogTaxonomyGroups,
): boolean {
  if (!normalize(category)) return true
  const explicitCategory = normalize(product.category)
  const fallback = normalize(`${product.name} ${product.description ?? ''}`)
  return (
    matchesAliases(explicitCategory, category, taxonomy.categoryGroups) ||
    matchesAliases(fallback, category, taxonomy.categoryGroups)
  )
}

function colorMatches(
  product: CatalogProduct,
  color: string | null | undefined,
  taxonomy: CatalogTaxonomyGroups,
): boolean {
  if (!normalize(color)) return true
  const values = [
    product.description ?? '',
    ...(product.variants ?? []).map((variant) => variant.color ?? ''),
  ]
  return matchesAliases(normalize(values.join(' ')), color, taxonomy.colorGroups)
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

function relevanceScore(
  product: CatalogProduct,
  input: AgentCatalogSearchInput,
  taxonomy: CatalogTaxonomyGroups,
): number {
  const name = normalize(product.name)
  const category = normalize(product.category)
  const description = normalize(product.description)
  const query = normalize(input.query)
  const wantedCategory = normalize(input.category)
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
    else if (categoryMatches(product, input.category, taxonomy)) score += 80
  }
  if (input.color && colorMatches(product, input.color, taxonomy)) score += 45
  if (product.imageUrl || product.variants?.some((variant) => variant.imageUrl)) score += 20
  if (product.stockQuantity !== null && product.stockQuantity > 0) score += 10

  const sizeMatch = productSizeMatch(product, input.size)
  if (sizeMatch === 'match') score += 50
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

function addAliasTerms(
  output: string[],
  requested: string | null | undefined,
  groups: readonly (readonly string[])[],
  maxAliases: number,
): void {
  const wanted = normalize(requested)
  if (!wanted) return
  const group = bestAliasGroup(wanted, groups)
  if (!group) return

  // The taxonomy loader keeps canonical_value first. Always include it, then
  // include a small set of alternative aliases distinct from the model token.
  const aliases = [group[0], ...group.filter((alias) => alias !== wanted)].filter(Boolean)
  output.push(...aliases.slice(0, maxAliases))
}

/**
 * Build a bounded set of source queries from the model request and the current
 * tenant vocabulary. Category and colour get independent alias budgets so one
 * group can never crowd the other out (e.g. `white` must still reach a source
 * that stores the configured equivalent in another language).
 */
export function buildAgentCatalogRetrievalQueries(
  input: AgentCatalogSearchInput,
  taxonomy: CatalogTaxonomyGroups,
  attributeConstraints: readonly CatalogAttributeConstraint[] = [],
): string[] {
  const candidates: string[] = [input.query]
  if (input.category) candidates.push(input.category)
  addAliasTerms(candidates, input.category, taxonomy.categoryGroups, 3)
  if (input.color) candidates.push(input.color)
  addAliasTerms(candidates, input.color, taxonomy.colorGroups, 4)
  candidates.push(...catalogAttributeConstraintSearchTerms(attributeConstraints).slice(0, 4))

  const unique = new Map<string, string>()
  for (const candidate of candidates) {
    const trimmed = candidate?.trim() ?? ''
    const key = normalize(trimmed)
    if (key && !unique.has(key)) unique.set(key, trimmed)
  }
  return Array.from(unique.values()).slice(0, MAX_RETRIEVAL_QUERIES)
}

function isInternalCatalogProduct(product: CatalogProduct): boolean {
  return product.sourceType === 'internal' || product.sourceName === INTERNAL_SOURCE_NAME
}

function matchedAttributeEvidence(
  constraints: readonly CatalogAttributeConstraint[],
): Record<string, string> | undefined {
  if (constraints.length === 0) return undefined
  return Object.fromEntries(constraints.map((constraint) => [constraint.key, constraint.canonicalValue]))
}

/**
 * Agent-facing catalogue retrieval.
 *
 * The legacy search layer is intentionally kept as a broad source adapter.
 * This layer fetches a wider candidate pool, applies explicit category/colour
 * and tenant-defined attribute constraints as AND conditions, removes products
 * already shown by the live conversation state, rejects strong name/category
 * conflicts using only the tenant taxonomy, then ranks and limits. A known size
 * mismatch is also excluded; products with no size data stay eligible but are
 * marked unknown so the agent can be honest. It never sends WhatsApp media.
 *
 * Generic structured attributes are currently authoritative on the canonical
 * internal catalogue only. External connector rows stay eligible for legacy
 * fields, but cannot satisfy a generic hard constraint until synchronised into
 * canonical product attribute values. This prevents inferred/unknown facts from
 * being presented as verified catalogue facts.
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

  const taxonomy = await loadCatalogTaxonomy(db, accountId)
  const requestedAttributes = input.attributes && Object.keys(input.attributes).length > 0
    ? input.attributes
    : null

  const definitions = requestedAttributes
    ? await loadCatalogAttributeDefinitions(db, accountId)
    : []
  const normalizedAttributes = normalizeCatalogAttributeConstraints(definitions, requestedAttributes)

  // Hard constraints that are unknown to the tenant schema must not be ignored.
  if (normalizedAttributes.unknownKeys.length > 0) {
    console.info('[agent catalog search] unknown attribute constraints:', {
      accountId,
      keys: normalizedAttributes.unknownKeys,
    })
    return []
  }

  const queries = buildAgentCatalogRetrievalQueries(
    input,
    taxonomy,
    normalizedAttributes.constraints,
  )
  if (queries.length === 0) return []

  const settled = await Promise.allSettled(
    queries.map((query) =>
      searchCatalogues(db, accountId, {
        query,
        limit: candidateLimit,
        categoryGroups: taxonomy.categoryGroups,
        colorGroups: taxonomy.colorGroups,
      }),
    ),
  )
  const candidates = uniqueProducts(
    settled.flatMap((result) => {
      if (result.status === 'fulfilled') return result.value
      console.warn('[agent catalog search] source query failed:', result.reason)
      return []
    }),
  )

  const structuredConstraints = normalizedAttributes.constraints
  const internalProductIds = structuredConstraints.length > 0
    ? candidates.filter(isInternalCatalogProduct).map((product) => product.id)
    : []
  const attributeValues = structuredConstraints.length > 0
    ? await loadCatalogProductAttributeValues(db, accountId, internalProductIds)
    : []

  const excluded = new Set(input.excludeProductKeys ?? [])
  return candidates
    .filter((product) => !excluded.has(catalogProductKey(product)))
    .filter((product) => !catalogNameConflictsWithRequestedCategory(product.name, input.category, taxonomy.categoryGroups))
    .filter((product) => categoryMatches(product, input.category, taxonomy))
    .filter((product) => colorMatches(product, input.color, taxonomy))
    .filter((product) => {
      if (structuredConstraints.length === 0) return true
      if (!isInternalCatalogProduct(product)) return false
      return productMatchesCatalogAttributeConstraints(product.id, attributeValues, structuredConstraints)
    })
    .map((product) => ({ product, sizeMatch: productSizeMatch(product, input.size) }))
    .filter(({ sizeMatch }) => sizeMatch !== 'mismatch')
    .map(({ product, sizeMatch }) => ({
      product,
      productKey: catalogProductKey(product),
      score: relevanceScore(product, input, taxonomy),
      sizeMatch,
      matchedAttributes: matchedAttributeEvidence(structuredConstraints),
    }))
    .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'pt'))
    .slice(0, input.limit)
}