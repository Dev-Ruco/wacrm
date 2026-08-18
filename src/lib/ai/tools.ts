import type { CatalogProduct } from '@/lib/catalog/types'
import type { RankedAgentCatalogProduct } from '@/lib/catalog/agent-search'
import type { AgentToolDefinition, AgentToolCall } from './types'
import {
  loadSearchCatalogToolSettings,
  visualReferenceMeetsMinimumConfidence,
  type SearchCatalogToolSettings,
} from './tool-settings'
import {
  rankCatalogByVisualReference,
  type VisualProductMatch,
} from './visual-reference-search'
import { createAutoReplyTools as createBaseAutoReplyTools } from './operational-tools'
import { setWebsiteActivityIfWebsite } from '@/lib/site-chat/activity'

export type {
  HandoffToolRequest,
  ScheduledVisitRequest,
} from './tools/index'

interface SearchProductRow extends CatalogProduct {
  product_ref: string
  product_key: string
  requested_size_match?: 'match' | 'unknown' | 'mismatch'
  matched_attributes?: Record<string, string> | null
}

interface SearchToolResult {
  ok?: boolean
  query?: string
  products?: SearchProductRow[]
  found?: boolean
  instruction?: string
  [key: string]: unknown
}

const OPERATIONAL_RUNTIME_TOOLS = new Set([
  'check_availability',
  'create_order',
  'get_order_status',
  'update_contact',
])

function parseToolArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function parseSearchResult(raw: string): SearchToolResult | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as SearchToolResult
      : null
  } catch {
    return null
  }
}

function augmentSearchCatalogueTool(tool: AgentToolDefinition): AgentToolDefinition {
  if (tool.name !== 'search_catalog') return tool
  const parameters = tool.parameters as {
    properties?: Record<string, unknown>
    [key: string]: unknown
  }
  return {
    ...tool,
    description:
      `${tool.description} ` +
      'When the customer supplied a recent reference photograph and asks you to identify, find, compare or check availability of the visible commercial item, set visual_reference=true. Describe only the target product/object in query; never identify or infer who a person in the photograph is. The server will apply the business visual-search settings, compare against real catalogue photographs when enabled, and return a confidence level. If one photograph contains multiple products, search one target item at a time.',
    parameters: {
      ...parameters,
      properties: {
        ...(parameters.properties ?? {}),
        visual_reference: {
          type: 'boolean',
          description:
            'True only when a recent customer image is being used as a visual product/object reference. The server applies the configured visual-search policy and never infers stock or identity from pixels.',
        },
      },
    },
  }
}

function asVisualCandidates(products: readonly SearchProductRow[]): RankedAgentCatalogProduct[] {
  return products.map((row, index) => ({
    product: row,
    productKey: row.product_key,
    score: Math.max(1, products.length - index),
    sizeMatch: row.requested_size_match ?? 'unknown',
    matchedAttributes: row.matched_attributes ?? undefined,
  }))
}

function visualMatchPayload(match: VisualProductMatch) {
  const factualAvailability = match.matchedColorStockQuantity === null
    ? null
    : match.matchedColorStockQuantity > 0
  return {
    score: match.score,
    confidence: match.confidence,
    reason: match.reason,
    recommended_image_index: match.matchedMedia.imageIndex,
    matched_media: {
      source: match.matchedMedia.source,
      variant_id: match.matchedMedia.variantId,
      color: match.matchedMedia.color,
      size: match.matchedMedia.size,
    },
    matched_color_stock_quantity: match.matchedColorStockQuantity,
    matched_color_available_sizes: match.matchedColorAvailableSizes,
    matched_color_available: factualAvailability,
  }
}

function instructionForVisualConfidence(
  confidence: 'high' | 'medium' | 'low' | null,
  settings: SearchCatalogToolSettings,
): string {
  const minimum = settings.visual_reference.minimum_confidence
  const meetsMinimum = visualReferenceMeetsMinimumConfidence(confidence, minimum)
  if (!meetsMinimum) {
    return `The visual result did not meet this business's configured minimum confidence (${minimum}). Do not claim that the reference corresponds to any exact catalogue item. You may present the strongest similar candidates for customer confirmation, using only factual catalogue fields for price, stock, colour and size. Never identify any person in the photograph.`
  }
  if (confidence === 'high') {
    return 'Visual comparison found one clearly stronger candidate and it meets the configured confidence threshold. You may say the reference appears to correspond to the top catalogue product, but do not claim absolute visual certainty and never identify any person in the photograph. Availability, sizes and prices may be stated only from the factual catalogue fields returned here. If useful, call send_product with the returned product_ref and recommended_image_index to show the matching catalogue/variant photograph.'
  }
  return 'Visual comparison is plausible and meets this business minimum threshold, but it is not unique. Do not claim an exact match. Present the best one or two catalogue candidates and ask the customer to confirm which one they mean; use send_product with each candidate product_ref and recommended_image_index when visual confirmation helps. Availability, sizes and prices must come only from factual catalogue fields.'
}

/**
 * Public AI tool facade. The underlying catalogue tool remains the code-owned
 * permission/audit boundary; the operational layer adds generic business
 * actions, while visual reference search remains a read-only mode of
 * search_catalog. Existing tenant permissions and Skills continue to apply.
 */
export function createAutoReplyTools(
  args: Parameters<typeof createBaseAutoReplyTools>[0],
): ReturnType<typeof createBaseAutoReplyTools> {
  const base = createBaseAutoReplyTools(args)
  const tools = base.tools.map(augmentSearchCatalogueTool)
  let settingsPromise: Promise<SearchCatalogToolSettings> | null = null
  const visualSettings = () => {
    settingsPromise ??= loadSearchCatalogToolSettings(
      args.db,
      args.accountId,
      args.config.agentId,
    )
    return settingsPromise
  }

  const executeTool = async (call: AgentToolCall): Promise<string> => {
    if (call.name === 'search_catalog') {
      await setWebsiteActivityIfWebsite(args.db, args.conversationId, 'searching_catalog').catch((error) =>
        console.error('[website activity] catalogue state failed:', error),
      )
    }
    if (OPERATIONAL_RUNTIME_TOOLS.has(call.name)) {
      const parsed = parseToolArguments(call.arguments)
      if (!parsed) throw new Error(`Invalid JSON arguments for operational tool: ${call.name}`)
      // The operational layer consumes the same parsed-object form used by
      // the mature base handlers internally. Keep the public provider-facing
      // AgentToolCall contract (JSON string) unchanged at this facade.
      return base.executeTool({
        ...call,
        arguments: parsed as unknown as string,
      })
    }

    if (call.name !== 'search_catalog') return base.executeTool(call)

    const requested = parseToolArguments(call.arguments)
    if (!requested || requested.visual_reference !== true) {
      return base.executeTool(call)
    }

    const settings = await visualSettings()
    const visualPolicy = settings.visual_reference
    const baseArguments = { ...requested }
    delete baseArguments.visual_reference

    const requestedLimit = typeof baseArguments.limit === 'number' && Number.isFinite(baseArguments.limit)
      ? Math.floor(baseArguments.limit)
      : visualPolicy.max_candidates
    const responseLimit = Math.min(
      visualPolicy.max_candidates,
      Math.max(1, requestedLimit),
    )

    // Even a visually disabled request still runs ordinary trusted catalogue
    // retrieval, but never sends the customer image into a visual comparison.
    baseArguments.limit = visualPolicy.enabled
      ? visualPolicy.max_candidates
      : responseLimit

    const rawSearch = await base.executeTool({
      ...call,
      arguments: JSON.stringify(baseArguments),
    })
    const search = parseSearchResult(rawSearch)
    if (!search || !Array.isArray(search.products) || search.products.length === 0) {
      return rawSearch
    }

    if (!visualPolicy.enabled) {
      return JSON.stringify({
        ...search,
        products: search.products.slice(0, responseLimit),
        visual_reference: {
          requested: true,
          enabled: false,
          comparison_succeeded: false,
          confidence: null,
        },
        instruction:
          'Visual reference search is disabled for this business. The customer photograph was not compared with catalogue images. Use only the ordinary catalogue results and never claim that the photograph was visually matched.',
      })
    }

    const query = typeof search.query === 'string' && search.query.trim()
      ? search.query.trim()
      : typeof baseArguments.query === 'string'
        ? baseArguments.query.trim()
        : ''

    const visual = await rankCatalogByVisualReference({
      db: args.db,
      accountId: args.accountId,
      conversationId: args.conversationId,
      config: args.config,
      query,
      candidates: asVisualCandidates(search.products),
      limit: responseLimit,
      maxCandidates: visualPolicy.max_candidates,
      useVariantImages: visualPolicy.use_variant_images,
    })

    if (!visual.referenceFound) {
      return JSON.stringify({
        ...search,
        products: search.products.slice(0, responseLimit),
        visual_reference: {
          requested: true,
          enabled: true,
          reference_found: false,
          comparison_succeeded: false,
          confidence: null,
          minimum_confidence: visualPolicy.minimum_confidence,
        },
        instruction:
          'No recent customer photograph could be resolved for visual comparison. Do not pretend that the image was analysed. Continue only with ordinary catalogue facts or ask the customer to resend the reference image.',
      })
    }

    if (!visual.comparisonSucceeded || visual.matches.length === 0) {
      return JSON.stringify({
        ...search,
        products: search.products.slice(0, responseLimit),
        visual_reference: {
          requested: true,
          enabled: true,
          reference_found: true,
          comparison_succeeded: false,
          confidence: null,
          minimum_confidence: visualPolicy.minimum_confidence,
        },
        instruction:
          'The customer image was available but the visual catalogue comparison could not be completed reliably. Do not claim an exact match. You may offer the ordinary text-search candidates as possibilities or ask for another photograph.',
      })
    }

    const originalByKey = new Map(
      search.products.map((product) => [product.product_key, product] as const),
    )
    const visuallyRanked = visual.matches.flatMap((match) => {
      const original = originalByKey.get(match.productKey)
      if (!original) return []
      return [{
        ...original,
        visual_match: visualMatchPayload(match.visual),
      }]
    })
    const meetsMinimum = visualReferenceMeetsMinimumConfidence(
      visual.confidence,
      visualPolicy.minimum_confidence,
    )

    return JSON.stringify({
      ...search,
      products: visuallyRanked,
      found: visuallyRanked.length > 0,
      visual_reference: {
        requested: true,
        enabled: true,
        reference_found: true,
        comparison_succeeded: true,
        confidence: visual.confidence,
        minimum_confidence: visualPolicy.minimum_confidence,
        meets_minimum_confidence: meetsMinimum,
        max_candidates: visualPolicy.max_candidates,
        variant_images_used: visualPolicy.use_variant_images,
      },
      instruction: instructionForVisualConfidence(visual.confidence, settings),
    })
  }

  return {
    ...base,
    tools,
    executeTool,
  }
}
