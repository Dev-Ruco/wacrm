import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type CatalogHealthSeverity = 'info' | 'warning' | 'critical'

export interface CatalogHealthIssue {
  issueType: string
  severity: CatalogHealthSeverity
  title: string
  description: string
  productId: string | null
  sourceId: string | null
  evidence: Record<string, unknown>
}

export interface CatalogHealthSummary {
  score: number
  totalProducts: number
  activeProducts: number
  productsWithMedia: number
  productsWithOfferingType: number
  missingRequiredAttributeCount: number
  failedMirrorSourceCount: number
  issues: CatalogHealthIssue[]
}

interface ProductRow {
  id: string
  name: string
  image_url: string | null
  offering_type_id: string | null
  source_id: string | null
  is_active: boolean
}

interface DefinitionRow {
  id: string
  offering_type_id: string | null
  label: string
  required: boolean
  enabled: boolean
}

interface ValueRow {
  product_id: string
  definition_id: string
}

interface SourceRow {
  id: string
  name: string
  source_type: string
  sync_mode: string | null
  last_sync_status: string | null
  last_sync_error: string | null
  is_active: boolean
}

function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

export async function scanCatalogHealth(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<CatalogHealthSummary> {
  const [productsResult, definitionsResult, valuesResult, sourcesResult, typesResult] = await Promise.all([
    db.from('catalog_products')
      .select('id, name, image_url, offering_type_id, source_id, is_active')
      .eq('account_id', accountId),
    db.from('offering_attribute_definitions')
      .select('id, offering_type_id, label, required, enabled')
      .eq('account_id', accountId)
      .eq('enabled', true),
    db.from('offering_attribute_values')
      .select('product_id, definition_id')
      .eq('account_id', accountId),
    db.from('catalog_sources')
      .select('id, name, source_type, sync_mode, last_sync_status, last_sync_error, is_active')
      .eq('account_id', accountId)
      .eq('is_active', true),
    db.from('offering_types')
      .select('id')
      .eq('account_id', accountId)
      .eq('enabled', true),
  ])

  for (const result of [productsResult, definitionsResult, valuesResult, sourcesResult, typesResult]) {
    if (result.error) throw new Error(`Catalogue health lookup failed: ${result.error.message}`)
  }

  const products = (productsResult.data ?? []) as ProductRow[]
  const activeProducts = products.filter((product) => product.is_active)
  const definitions = (definitionsResult.data ?? []) as DefinitionRow[]
  const values = (valuesResult.data ?? []) as ValueRow[]
  const sources = (sourcesResult.data ?? []) as SourceRow[]
  const hasOfferingTypes = (typesResult.data ?? []).length > 0
  const issues: CatalogHealthIssue[] = []

  const valuesByProduct = new Map<string, Set<string>>()
  for (const value of values) {
    const current = valuesByProduct.get(value.product_id) ?? new Set<string>()
    current.add(value.definition_id)
    valuesByProduct.set(value.product_id, current)
  }

  let productsWithMedia = 0
  let productsWithOfferingType = 0
  let missingRequiredAttributeCount = 0

  for (const product of activeProducts) {
    if (product.image_url) {
      productsWithMedia += 1
    } else {
      // Media is useful for many retail businesses but is not a universal
      // requirement for a generic SaaS catalogue: services, appointments,
      // subscriptions and other offerings may be perfectly valid without a
      // product image. Surface it as optional information instead of lowering
      // the tenant's readiness score by default.
      issues.push({
        issueType: 'missing_media',
        severity: 'info',
        title: 'Oferta sem imagem principal',
        description: `${product.name} não possui imagem principal. Isto só limita apresentações visuais quando forem relevantes para este negócio.`,
        productId: product.id,
        sourceId: product.source_id,
        evidence: { product_name: product.name },
      })
    }

    if (product.offering_type_id) {
      productsWithOfferingType += 1
    } else if (hasOfferingTypes) {
      issues.push({
        issueType: 'missing_offering_type',
        severity: 'info',
        title: 'Oferta sem tipo estruturado',
        description: `${product.name} ainda não está associada a um tipo de oferta.`,
        productId: product.id,
        sourceId: product.source_id,
        evidence: { product_name: product.name },
      })
    }

    const applicableRequired = definitions.filter((definition) =>
      definition.required && (
        definition.offering_type_id === null ||
        definition.offering_type_id === product.offering_type_id
      ),
    )
    const productValues = valuesByProduct.get(product.id) ?? new Set<string>()
    for (const definition of applicableRequired) {
      if (productValues.has(definition.id)) continue
      missingRequiredAttributeCount += 1
      issues.push({
        issueType: `missing_required_attribute:${definition.id}`,
        severity: 'warning',
        title: `Atributo obrigatório em falta: ${definition.label}`,
        description: `${product.name} não tem valor para o atributo obrigatório “${definition.label}”.`,
        productId: product.id,
        sourceId: product.source_id,
        evidence: {
          product_name: product.name,
          definition_id: definition.id,
          definition_label: definition.label,
        },
      })
    }
  }

  const nameGroups = new Map<string, ProductRow[]>()
  for (const product of activeProducts) {
    const key = normalizeName(product.name)
    if (!key) continue
    const current = nameGroups.get(key) ?? []
    current.push(product)
    nameGroups.set(key, current)
  }
  for (const duplicates of nameGroups.values()) {
    if (duplicates.length < 2) continue
    for (const product of duplicates) {
      issues.push({
        issueType: 'possible_duplicate_name',
        severity: 'info',
        title: 'Possível duplicado',
        description: `Existem ${duplicates.length} ofertas activas com o nome “${product.name}”.`,
        productId: product.id,
        sourceId: product.source_id,
        evidence: { duplicate_product_ids: duplicates.map((item) => item.id) },
      })
    }
  }

  let failedMirrorSourceCount = 0
  for (const source of sources) {
    if (source.sync_mode !== 'mirror') continue
    if (source.last_sync_status === 'succeeded') continue
    failedMirrorSourceCount += 1
    issues.push({
      issueType: 'mirror_not_healthy',
      severity: source.last_sync_status === 'failed' ? 'critical' : 'warning',
      title: `Espelho canónico indisponível: ${source.name}`,
      description: source.last_sync_status === 'failed'
        ? `A última sincronização falhou${source.last_sync_error ? `: ${source.last_sync_error}` : '.'}`
        : 'A fonte está configurada como espelho mas ainda não concluiu uma sincronização.',
      productId: null,
      sourceId: source.id,
      evidence: { last_sync_status: source.last_sync_status },
    })
  }

  const denominator = Math.max(activeProducts.length, 1)

  // Readiness is driven only by facts the tenant itself declared required and
  // by objective source integrity. Optional presentation choices (for example,
  // having an image) must not make a service business look unhealthy simply
  // because it is not a retail catalogue.
  const requiredPenalty = Math.min(
    0.55,
    (missingRequiredAttributeCount / denominator) * 0.08,
  )
  const mirrorPenalty = Math.min(0.3, failedMirrorSourceCount * 0.1)
  const duplicatePenalty = Math.min(
    0.15,
    (issues.filter((issue) => issue.issueType === 'possible_duplicate_name').length /
      denominator) *
      0.03,
  )
  const score = activeProducts.length === 0
    ? 100
    : clampScore(100 * (1 - requiredPenalty - mirrorPenalty - duplicatePenalty))

  return {
    score,
    totalProducts: products.length,
    activeProducts: activeProducts.length,
    productsWithMedia,
    productsWithOfferingType,
    missingRequiredAttributeCount,
    failedMirrorSourceCount,
    issues,
  }
}
