import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type OfferingAttributeValueType = 'text' | 'number' | 'boolean' | 'enum'
export type OfferingAttributeScalar = string | number | boolean

export interface OfferingAttributeOption {
  value: string
  label: string
  aliases: string[]
  enabled: boolean
  sortOrder: number
}

export interface OfferingAttributeDefinition {
  id: string
  offeringTypeId: string | null
  key: string
  label: string
  valueType: OfferingAttributeValueType
  unit: string | null
  isFilterable: boolean
  allowMultiple: boolean
  required: boolean
  enabled: boolean
  sortOrder: number
  options: OfferingAttributeOption[]
}

export interface OfferingAttributeConstraintAlternative {
  definitionId: string
  offeringTypeId: string | null
  valueType: OfferingAttributeValueType
  canonicalValue: string
  aliases: string[]
}

export interface OfferingAttributeConstraint {
  key: string
  label: string
  requestedValue: OfferingAttributeScalar
  alternatives: OfferingAttributeConstraintAlternative[]
}

export interface OfferingAttributeValue {
  productId: string
  definitionId: string
  valueKey: string
  value: unknown
  source: 'manual' | 'import' | 'sync' | 'ai'
  confidence: number | null
  verified: boolean
}

export interface NormalizedOfferingAttributeConstraints {
  constraints: OfferingAttributeConstraint[]
  unknownKeys: string[]
}

interface AttributeDefinitionRow {
  id: string
  offering_type_id: string | null
  key: string
  label: string
  value_type: OfferingAttributeValueType
  unit: string | null
  is_filterable: boolean
  allow_multiple: boolean
  required: boolean
  options: unknown
  enabled: boolean
  sort_order: number
}

interface AttributeValueRow {
  product_id: string
  definition_id: string
  value_key: string
  value: unknown
  source: 'manual' | 'import' | 'sync' | 'ai'
  confidence: number | string | null
  verified: boolean
}

export function normalizeOfferingAttributeText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function scalarToCanonical(value: OfferingAttributeScalar): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return normalizeOfferingAttributeText(value)
}

function uniqueNormalized(values: unknown[]): string[] {
  const unique = new Set<string>()
  for (const value of values) {
    const normalized = normalizeOfferingAttributeText(value)
    if (normalized) unique.add(normalized)
  }
  return Array.from(unique)
}

function parseOptions(input: unknown): OfferingAttributeOption[] {
  if (!Array.isArray(input)) return []
  return input.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const value = typeof item.value === 'string' ? item.value.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : value
    if (!value || !label) return []
    return [{
      value,
      label,
      aliases: Array.isArray(item.aliases)
        ? item.aliases.filter((alias): alias is string => typeof alias === 'string' && Boolean(alias.trim()))
        : [],
      enabled: item.enabled !== false,
      sortOrder: typeof item.sort_order === 'number' && Number.isFinite(item.sort_order)
        ? item.sort_order
        : index,
    }]
  })
}

function matchingDefinitions(
  definitions: readonly OfferingAttributeDefinition[],
  requestedKey: string,
): OfferingAttributeDefinition[] {
  const wanted = normalizeOfferingAttributeText(requestedKey)
  if (!wanted) return []
  return definitions.filter((definition) =>
    definition.enabled &&
    definition.isFilterable &&
    (
      normalizeOfferingAttributeText(definition.key) === wanted ||
      normalizeOfferingAttributeText(definition.label) === wanted
    ),
  )
}

function resolveAlternative(
  definition: OfferingAttributeDefinition,
  requestedValue: OfferingAttributeScalar,
): OfferingAttributeConstraintAlternative | null {
  const requested = scalarToCanonical(requestedValue)
  if (!requested) return null

  if (definition.valueType === 'enum') {
    const option = definition.options.find((candidate) => {
      if (!candidate.enabled) return false
      return uniqueNormalized([
        candidate.value,
        candidate.label,
        ...candidate.aliases,
      ]).includes(requested)
    })
    if (!option) return null

    return {
      definitionId: definition.id,
      offeringTypeId: definition.offeringTypeId,
      valueType: definition.valueType,
      canonicalValue: normalizeOfferingAttributeText(option.value),
      aliases: uniqueNormalized([option.value, option.label, ...option.aliases]),
    }
  }

  return {
    definitionId: definition.id,
    offeringTypeId: definition.offeringTypeId,
    valueType: definition.valueType,
    canonicalValue: requested,
    aliases: [requested],
  }
}

export function resolveOfferingAttributeConstraint(
  definitions: readonly OfferingAttributeDefinition[],
  requestedKey: string,
  requestedValue: OfferingAttributeScalar,
): OfferingAttributeConstraint | null {
  const matches = matchingDefinitions(definitions, requestedKey)
  if (matches.length === 0) return null

  const alternatives = matches
    .map((definition) => resolveAlternative(definition, requestedValue))
    .filter((alternative): alternative is OfferingAttributeConstraintAlternative => alternative !== null)

  if (alternatives.length === 0) return null

  return {
    key: matches[0].key,
    label: matches[0].label,
    requestedValue,
    alternatives,
  }
}

export function normalizeOfferingAttributeConstraints(
  definitions: readonly OfferingAttributeDefinition[],
  input: Record<string, OfferingAttributeScalar> | null | undefined,
): NormalizedOfferingAttributeConstraints {
  if (!input) return { constraints: [], unknownKeys: [] }

  const constraints: OfferingAttributeConstraint[] = []
  const unknownKeys: string[] = []

  for (const [key, value] of Object.entries(input)) {
    const resolved = resolveOfferingAttributeConstraint(definitions, key, value)
    if (!resolved) {
      unknownKeys.push(key)
      continue
    }
    constraints.push(resolved)
  }

  return { constraints, unknownKeys }
}

export function offeringAttributeConstraintSearchTerms(
  constraints: readonly OfferingAttributeConstraint[],
): string[] {
  const terms = new Set<string>()
  for (const constraint of constraints) {
    for (const alternative of constraint.alternatives) {
      for (const term of [alternative.canonicalValue, ...alternative.aliases]) {
        const normalized = normalizeOfferingAttributeText(term)
        if (normalized.length >= 2) terms.add(normalized)
      }
    }
  }
  return Array.from(terms)
}

function valueCandidates(row: OfferingAttributeValue): string[] {
  const rawScalar = (
    typeof row.value === 'string' ||
    typeof row.value === 'number' ||
    typeof row.value === 'boolean'
  ) ? row.value : ''
  return uniqueNormalized([row.valueKey, rawScalar])
}

function alternativeAppliesToProduct(
  alternative: OfferingAttributeConstraintAlternative,
  productOfferingTypeId: string | null | undefined,
): boolean {
  // undefined means the caller has not hydrated the product type. This path is
  // safe because the database trigger guarantees a type-scoped value can only
  // exist on a product of that same type. Explicit null means a genuinely
  // untyped offering, so only global definitions apply.
  if (productOfferingTypeId === undefined) return true
  return alternative.offeringTypeId === null || alternative.offeringTypeId === productOfferingTypeId
}

export function productMatchesOfferingAttributeConstraints(
  productId: string,
  productOfferingTypeId: string | null | undefined,
  values: readonly OfferingAttributeValue[],
  constraints: readonly OfferingAttributeConstraint[],
): boolean {
  if (constraints.length === 0) return true
  const productValues = values.filter((value) => value.productId === productId)

  return constraints.every((constraint) => {
    const applicable = constraint.alternatives.filter((alternative) =>
      alternativeAppliesToProduct(alternative, productOfferingTypeId),
    )
    if (applicable.length === 0) return false

    return applicable.some((alternative) => {
      const accepted = new Set(uniqueNormalized([
        alternative.canonicalValue,
        ...alternative.aliases,
      ]))
      return productValues
        .filter((row) => row.definitionId === alternative.definitionId)
        .some((row) => valueCandidates(row).some((candidate) => accepted.has(candidate)))
    })
  })
}

export function offeringAttributeEvidence(
  constraints: readonly OfferingAttributeConstraint[],
): Record<string, string> | undefined {
  if (constraints.length === 0) return undefined
  return Object.fromEntries(constraints.map((constraint) => [
    constraint.key,
    constraint.alternatives[0]?.canonicalValue ?? scalarToCanonical(constraint.requestedValue),
  ]))
}

export async function loadOfferingAttributeDefinitions(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<OfferingAttributeDefinition[]> {
  const { data, error } = await db
    .from('offering_attribute_definitions')
    .select('id, offering_type_id, key, label, value_type, unit, is_filterable, allow_multiple, required, options, enabled, sort_order')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) {
    throw new Error(`Offering attribute definitions lookup failed: ${error.message}`)
  }

  return ((data ?? []) as AttributeDefinitionRow[]).map((row) => ({
    id: row.id,
    offeringTypeId: row.offering_type_id,
    key: row.key,
    label: row.label,
    valueType: row.value_type,
    unit: row.unit,
    isFilterable: row.is_filterable,
    allowMultiple: row.allow_multiple,
    required: row.required,
    enabled: row.enabled,
    sortOrder: row.sort_order,
    options: parseOptions(row.options),
  }))
}

export async function loadOfferingAttributeValues(
  db: WacrmSupabaseClient,
  accountId: string,
  productIds: readonly string[],
): Promise<OfferingAttributeValue[]> {
  const ids = Array.from(new Set(productIds.filter(Boolean)))
  if (ids.length === 0) return []

  const { data, error } = await db
    .from('offering_attribute_values')
    .select('product_id, definition_id, value_key, value, source, confidence, verified')
    .eq('account_id', accountId)
    .in('product_id', ids)

  if (error) throw new Error(`Offering attribute value lookup failed: ${error.message}`)

  return ((data ?? []) as AttributeValueRow[]).map((row) => ({
    productId: row.product_id,
    definitionId: row.definition_id,
    valueKey: row.value_key,
    value: row.value,
    source: row.source,
    confidence: row.confidence === null ? null : Number(row.confidence),
    verified: row.verified,
  }))
}

/**
 * Inferred enrichment may supplement unknown facts, but it must never replace
 * a human-entered or verified fact. This is independent of business domain.
 */
export function canReplaceOfferingAttributeValue(
  existing: Pick<OfferingAttributeValue, 'source' | 'verified'> | null | undefined,
  incomingSource: OfferingAttributeValue['source'],
): boolean {
  if (!existing) return true
  if (existing.verified || existing.source === 'manual') return false
  if (incomingSource === 'ai') return existing.source === 'ai'
  return incomingSource !== 'ai'
}
