import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/ai/admin-client'
import { loadAiConfig } from '@/lib/ai/config'
import { generateReply } from '@/lib/ai/generate'
import {
  buildCatalogImageEnrichmentPrompt,
  parseCatalogImageEnrichment,
  type CatalogImageEnrichment,
} from '@/lib/catalog/image-enrichment'
import { loadCatalogTaxonomy, type CatalogTaxonomyGroups } from '@/lib/catalog/taxonomy'

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Snaps a free-text value the vision model returned to this account's
 * own canonical taxonomy value when it (or one of its configured
 * aliases) matches. Unknown values remain suggestions instead of being
 * forced into an unrelated tenant category.
 */
export function snapToCanonicalValue(
  raw: string | null,
  groups: readonly (readonly string[])[],
): string | null {
  if (!raw) return raw
  const normalizedRaw = normalizeForMatch(raw)
  for (const group of groups) {
    if (group.some((alias) => normalizeForMatch(alias) === normalizedRaw)) {
      return group[0]
    }
  }
  return raw
}

/**
 * Backwards-compatible export kept for tests/callers that used the old
 * classifier helper. The classifier is editorial-only: it can prepare
 * commercial naming, category, colour and description, but price is outside
 * the AI contract.
 */
export function buildClassificationSystemPrompt(knownCategories: string[]): string {
  return buildCatalogImageEnrichmentPrompt(knownCategories)
}

/**
 * POST /api/catalog/classify — commercially enriches one product photo already
 * uploaded to the catalogue bucket. The vision model may propose a searchable
 * commercial name, category, colour and sales-ready description.
 *
 * Price and currency are deliberately never returned by this route. Even if a
 * model attempts to include them, parseCatalogImageEnrichment discards them.
 */
export async function POST(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const imageUrl = typeof body?.image_url === 'string' ? body.image_url.trim() : ''
    if (!imageUrl) {
      return NextResponse.json({ error: 'image_url is required.' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId)
    if (!config) {
      return NextResponse.json(
        { error: 'Configure primeiro o agente de IA para poder organizar fotografias.' },
        { status: 409 },
      )
    }

    const taxonomy: CatalogTaxonomyGroups = await loadCatalogTaxonomy(db, accountId)
    const knownCategories = taxonomy.categoryGroups.map((group) => group[0]).filter(Boolean)

    const generated = await generateReply({
      config,
      systemPrompt: buildCatalogImageEnrichmentPrompt(knownCategories),
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', url: imageUrl }],
        },
      ],
    })

    const enrichment = parseCatalogImageEnrichment(generated.text)
    const snapped: CatalogImageEnrichment = {
      ...enrichment,
      category: snapToCanonicalValue(enrichment.category, taxonomy.categoryGroups),
      color: snapToCanonicalValue(enrichment.color, taxonomy.colorGroups),
    }
    return NextResponse.json(snapped)
  } catch (error) {
    return toErrorResponse(error)
  }
}
