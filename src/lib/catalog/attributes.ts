import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type CatalogAttributeValueType = 'text' | 'number' | 'boolean' | 'enum'
export type CatalogAttributeScalar = string | number | boolean

export interface CatalogAttributeOption {
  id: string
  canonicalValue: string
  label: string
  aliases: string[]
  enabled: boolean
  sortOrder: number
}

export interface CatalogAttributeDefinition {
  id: string
  key: string
  label: string
  valueType: CatalogAttributeValueType
  unit: string | null
  isFilterable: boolean
  allowMultiple: boolean
  enabled: boolean
  sortOrder: number
  options: CatalogAttributeOption[]
}

export interface CatalogAttributeConstraint {
  definitionId: string
  key: string
  label: string
  valueType: CatalogAttributeValueType
  requestedValue: CatalogAttributeScalar
  canonicalValue: string
  aliases: string[]
}

export interface CatalogProductAttributeValue {
  productId: string
  definitionId: string
  optionId: string | null
  valueKey: string
  value: unknown
  source: 'manual' | 'import' | 'sync' | 'ai'
  confidence: number | null
  verified: boolean
}

export interface NormalizedCatalogAttributeConstraints {
  constraints: CatalogAttributeConstraint[]
  unknownKeys: string[]
}

interface AttributeDefinitionRow {
  id: string
  key: string
  label: string
  value_type: CatalogAttributeValueType
  unit: string | null
  is_filterable: boolean
  allow_multiple: boolean
  enabled: boolean
  sort_order: number
}

interface AttributeOptionRow {
  id: string
  definition_id: string
  canonical_value: string
  label: string
  aliases: string[] | null
  enabled: boolean
  sort_order: number
}

interface ProductAttributeValueRow {
  product_id: string
  definition_id: string
  option_id: string | null
  value_key: string
  value: unknown
  source: 'manual' | 'import' | 'sync' | 'ai'
  confidence: number | string | null
  verified: boolean
}

export function normalizeCatalogAttributeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scalarToCanonical(value: CatalogAttributeScalar): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return normalizeCatalogAttributeText(value)
}

function uniqueNormalized(values: unknown[]): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    const normalized = normalizeCatalogAttributeText(value)
    if (normalized) unique.add(normalized)
  }
  return Array.from(unique)
}

export function findCatalogAttributeDefinition(
  definitions: readonly CatalogAttributeDefinition[],
  requestedKey: string,
): CatalogAttributeDefinition | null {
  const wanted = normalizeCatalogAttributeText(requestedKey)
  if (!wanted) return null
  return definitions.find((definition) =>
    normalizeCatalogAttributeText(definition.key) === wanted ||
    normalizeCatalogAttributeText(definition.label) === wanted,
  ) ?? null
}

export function resolveCatalogAttributeConstraint(
  definitions: readonly CatalogAttributeDefinition[],
  requestedKey: string,
  requestedValue: CatalogAttributeScalar,
): CatalogAttributeConstraint | null {
  const definition = findCatalogAttributeDefinition(definitions, requestedKey)
  if (!definition || !definition.enabled || !definition.isFilterable) return null

  const requested = scalarToCanonical(requestedValue)
  if (!requested) return null

  if (definition.valueType === 'enum') {
    const option = definition.options.find((candidate) => {
      if (!candidate.enabled) return false
      const terms = uniqueNormalized([
        candidate.canonicalValue,
        candidate.label,
        ...candidate.aliases,
      ])
      return terms.includes(requested)
    })
    if (!option) return null

    return {
      definitionId: definition.id,
      key: definition.key,
      label: definition.label,
      valueType: definition.valueType,
      requestedValue,
      canonicalValue: normalizeCatalogAttributeText(option.canonicalValue),
      aliases: uniqueNormalized([
        option.canonicalValue,
        option.label,
        ...option.aliases,
      ]),
    }
  }

  return {
    definitionId: definition.id,
    key: definition.key,
    label: definition.label,
    valueType: definition.valueType,
    requestedValue,
    canonicalValue: requested,
    aliases: [requested],
  }
}

export function normalizeCatalogAttributeConstraints(
  definitions: readonly CatalogAttributeDefinition[],
  input: Record<string, CatalogAttributeScalar> | null | undefined,
): NormalizedCatalogAttributeConstraints {
  if (!input) return { constraints: [], unknownKeys: [] }

  const constraints: CatalogAttributeConstraint[] = []
  const unknownKeys: string[] = []

  for (const [key, value] of Object.entries(input)) {
    const definition = findCatalogAttributeDefinition(definitions, key)
    const resolved = resolveCatalogAttributeConstraint(definitions, key, value)
    if (!definition || !definition.enabled || !definition.isFilterable || !resolved) {
      unknownKeys.push(key)
      continue
    }
    constraints.push(resolved)
  }

  return { constraints, unknownKeys }
}

export function catalogAttributeConstraintSearchTerms(
  constraints: readonly CatalogAttributeConstraint[],
): string[] {
  const terms = new Set<string>()
  for (const constraint of constraints) {
    for (const term of [constraint.canonicalValue, ...constraint.aliases]) {
      const normalized = normalizeCatalogAttributeText(term)
      if (normalized.length >= 2) terms.add(normalized)
    }
  }
  return Array.from(terms)
}

function valueCandidates(row: CatalogProductAttributeValue): string[] {
  const rawScalar = (
    typeof row.value === 'string' ||
    typeof row.value === 'number' ||
    typeof row.value === 'boolean'
  ) ? row.value : ''
  return uniqueNormalized([row.valueKey, rawScalar])
}

export function productMatchesCatalogAttributeConstraints(
  productId: string,
  values: readonly CatalogProductAttributeValue[],
  constraints: readonly CatalogAttributeConstraint[],
): boolean {
  if (constraints.length === 0) return true
  const productValues = values.filter((value) => value.productId === productId)

  return constraints.every((constraint) => {
    const accepted = new Set(uniqueNormalized([
      constraint.canonicalValue,
      ...constraint.aliases,
    ]))
    return productValues
      .filter((row) => row.definitionId === constraint.definitionId)
      .some((row) => valueCandidates(row).some((candidate) => accepted.has(candidate)))
  })
}

export async function loadCatalogAttributeDefinitions(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<CatalogAttributeDefinition[]> {
  const { data: definitionRows, error: definitionError } = await db
    .from('catalog_attribute_definitions')
    .select('id, key, label, value_type, unit, is_filterable, allow_multiple, enabled, sort_order')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (definitionError) {
    throw new Error(`Catalog attribute definitions lookup failed: ${definitionError.message}`)
  }

  const rows = (definitionRows ?? []) as AttributeDefinitionRow[]
  if (rows.length === 0) return []

  const definitionIds = rows.map((row) => row.id)
  const { data: optionRows, error: optionError } = await db
    .from('catalog_attribute_options')
    .select('id, definition_id, canonical_value, label, aliases, enabled, sort_order')
    .eq('account_id', accountId)
    .in('definition_id', definitionIds)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (optionError) {
    throw new Error(`Catalog attribute options lookup failed: ${optionError.message}`)
  }

  const optionsByDefinition = new Map<string, CatalogAttributeOption[]>()
  for (const row of (optionRows ?? []) as AttributeOptionRow[]) {
    const current = optionsByDefinition.get(row.definition_id) ?? []
    current.push({
      id: row.id,
      canonicalValue: row.canonical_value,
      label: row.label,
      aliases: Array.isArray(row.aliases) ? row.aliases : [],
      enabled: row.enabled,
      sortOrder: row.sort_order,
    })
    optionsByDefinition.set(row.definition_id, current)
  }

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    valueType: row.value_type,
    unit: row.unit,
    isFilterable: row.is_filterable,
    allowMultiple: row.allow_multiple,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    options: optionsByDefinition.get(row.id) ?? [],
  }))
}

export async function loadCatalogProductAttributeValues(
  db: WacrmSupabaseClient,
  accountId: string,
  productIds: readonly string[],
): Promise<CatalogProductAttributeValue[]> {
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('catalog_product_attribute_values')
    .select('product_id, definition_id, option_id, value_key, value, source, confidence, verified')
    .eq('account_id', accountId)
    .in('product_id', ids)

  if (error) throw new Error(`Catalog product attribute lookup failed: ${error.message}`)

  return ((data ?? []) as ProductAttributeValueRow[]).map((row) => ({
    productId: row.product_id,
    definitionId: row.definition_id,
    optionId: row.option_id,
    valueKey: row.value_key,
    value: row.value,
    source: row.source,
    confidence: row.confidence === null ? null : Number(row.confidence),
    verified: row.verified,
  }))
}

/**
 * AI enrichment must never replace a manual/verified fact. This helper is used
 * by import/classification jobs before deciding whether an inferred value may
 * be written.
 */
export function canReplaceCatalogAttributeValue(
  existing: Pick<CatalogProductAttributeValue, 'source' | 'verified'> | null | undefined,
  incomingSource: CatalogProductAttributeValue['source'],
): boolean {
  if (!existing) return true
  if (existing.verified || existing.source === 'manual') return false
  if (incomingSource === 'ai') return existing.source === 'ai'
  return incomingSource !== 'ai'
}