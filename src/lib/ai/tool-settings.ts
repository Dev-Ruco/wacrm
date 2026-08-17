import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type VisualReferenceMinimumConfidence = 'high' | 'medium'

export interface VisualReferenceToolSettings {
  enabled: boolean
  minimum_confidence: VisualReferenceMinimumConfidence
  max_candidates: number
  use_variant_images: boolean
}

export interface SearchCatalogToolSettings {
  visual_reference: VisualReferenceToolSettings
}

export const DEFAULT_VISUAL_REFERENCE_TOOL_SETTINGS: VisualReferenceToolSettings = {
  enabled: true,
  minimum_confidence: 'medium',
  max_candidates: 5,
  use_variant_images: true,
}

export const DEFAULT_SEARCH_CATALOG_TOOL_SETTINGS: SearchCatalogToolSettings = {
  visual_reference: DEFAULT_VISUAL_REFERENCE_TOOL_SETTINGS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function boundedCandidateCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_VISUAL_REFERENCE_TOOL_SETTINGS.max_candidates
  }
  return Math.min(6, Math.max(1, Math.floor(value)))
}

/** Normalize persisted JSON defensively so older or partially configured rows
 * keep safe defaults instead of widening visual-search behaviour. */
export function normalizeSearchCatalogToolSettings(raw: unknown): SearchCatalogToolSettings {
  const root = isRecord(raw) ? raw : {}
  const visualRaw = isRecord(root.visual_reference) ? root.visual_reference : {}
  return {
    visual_reference: {
      enabled:
        typeof visualRaw.enabled === 'boolean'
          ? visualRaw.enabled
          : DEFAULT_VISUAL_REFERENCE_TOOL_SETTINGS.enabled,
      minimum_confidence:
        visualRaw.minimum_confidence === 'high' || visualRaw.minimum_confidence === 'medium'
          ? visualRaw.minimum_confidence
          : DEFAULT_VISUAL_REFERENCE_TOOL_SETTINGS.minimum_confidence,
      max_candidates: boundedCandidateCount(visualRaw.max_candidates),
      use_variant_images:
        typeof visualRaw.use_variant_images === 'boolean'
          ? visualRaw.use_variant_images
          : DEFAULT_VISUAL_REFERENCE_TOOL_SETTINGS.use_variant_images,
    },
  }
}

/** Strict parser for administrator writes. Unlike runtime normalization, bad
 * UI/API input is rejected rather than silently corrected. */
export function parseSearchCatalogToolSettingsInput(raw: unknown): SearchCatalogToolSettings | null {
  if (!isRecord(raw) || !isRecord(raw.visual_reference)) return null
  const visual = raw.visual_reference
  if (typeof visual.enabled !== 'boolean') return null
  if (visual.minimum_confidence !== 'high' && visual.minimum_confidence !== 'medium') return null
  if (
    typeof visual.max_candidates !== 'number' ||
    !Number.isInteger(visual.max_candidates) ||
    visual.max_candidates < 1 ||
    visual.max_candidates > 6
  ) return null
  if (typeof visual.use_variant_images !== 'boolean') return null

  return {
    visual_reference: {
      enabled: visual.enabled,
      minimum_confidence: visual.minimum_confidence,
      max_candidates: visual.max_candidates,
      use_variant_images: visual.use_variant_images,
    },
  }
}

export function visualReferenceMeetsMinimumConfidence(
  confidence: 'high' | 'medium' | 'low' | null,
  minimum: VisualReferenceMinimumConfidence,
): boolean {
  if (!confidence) return false
  if (minimum === 'high') return confidence === 'high'
  return confidence === 'high' || confidence === 'medium'
}

/** Load only the settings owned by the current account+agent. Defaults are
 * deliberate for rolling deployments where the settings migration has not
 * reached the database yet. */
export async function loadSearchCatalogToolSettings(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string | null | undefined,
): Promise<SearchCatalogToolSettings> {
  if (!agentId) return normalizeSearchCatalogToolSettings(null)
  try {
    const { data, error } = await db
      .from('agent_tools')
      .select('settings')
      .eq('account_id', accountId)
      .eq('agent_id', agentId)
      .eq('tool_key', 'search_catalog')
      .maybeSingle()
    if (error) throw error
    return normalizeSearchCatalogToolSettings((data as { settings?: unknown } | null)?.settings)
  } catch (error) {
    console.warn('[ai tools] structured search_catalog settings unavailable; using defaults:', error)
    return normalizeSearchCatalogToolSettings(null)
  }
}
