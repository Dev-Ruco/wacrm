import type { CatalogProduct } from '@/lib/catalog/types'
import type { RankedAgentCatalogProduct } from '@/lib/catalog/agent-search'
import type { AgentToolDefinition, AgentToolCall } from './types'
import {
  rankCatalogByVisualReference,
  type VisualProductMatch,
} from './visual-reference-search'
import { createAutoReplyTools as createBaseAutoReplyTools } from './tools/index'

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
      'When the customer supplied a recent reference photograph and asks you to identify, find, compare or check availability of the visible commercial item, set visual_reference=true. Describe only the target product/object in query; never identify or infer who a person in the photograph is. The server will compare the customer reference against real catalogue photographs and return a confidence level. If one photograph contains multiple products, search one target item at a time.',
    parameters: {
      ...parameters,
      properties: {
        ...(parameters.properties ?? {}),
        visual_reference: {
          type: 'boolean',
          description:
            'True only when a recent customer image is being used as a visual product/object reference. This triggers server-side comparison against real catalogue and variant photographs. It never infers stock or identity from pixels.',
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
): string {
  if (confidence === 'high') {
    return 'Visual comparison found one clearly stronger candidate. You may say the reference appears to correspond to the top catalogue product, but do not claim absolute visual certainty and never identify any person in the photograph. Availability, sizes and prices may be stated only from the factual catalogue fields returned here. If useful, call send_product with the returned product_ref and recommended_image_index to show the matching catalogue/variant photograph.'
  }
  if (confidence === 'medium') {
    return 'Visual comparison is plausible but not unique. Do not claim an exact match. Present the best one or two catalogue candidates and ask the customer to confirm which one they mean; use send_product with each candidate product_ref and recommended_image_index when a visual confirmation helps. Availability, sizes and prices must come only from the factual catalogue fields.'
  }
  return 'Visual comparison did not establish a reliable exact match. Say honestly that you could not confirm the exact item, and offer the returned similar catalogue candidates only if useful. Never invent identity, availability, price, colour or size from the reference photograph.'
}

/**
 * Public AI tool facade. The underlying catalogue tool remains the code-owned
 * permission/audit boundary; visual reference search is a read-only mode of
 * search_catalog, so existing tenant permissions and Skills continue to apply.
 */
export function createAutoReplyTools(
  args: Parameters<typeof createBaseAutoReplyTools>[0],
): ReturnType<typeof createBaseAutoReplyTools> {
  const base = createBaseAutoReplyTools(args)
  const tools = base.tools.map(augmentSearchCatalogueTool)

  const executeTool = async (call: AgentToolCall): Promise<string> => {
    if (call.name !== 'search_catalog') return base.executeTool(call)

    const requested = parseToolArguments(call.arguments)
    if (!requested || requested.visual_reference !== true) {
      return base.executeTool(call)
    }

    const baseArguments = { ...requested }
    delete baseArguments.visual_reference
    const requestedLimit = typeof baseArguments.limit === 'number' && Number.isFinite(baseArguments.limit)
      ? Math.floor(baseArguments.limit)
      : 5
    baseArguments.limit = Math.min(10, Math.max(6, requestedLimit))

    // First run the ordinary trusted catalogue retrieval. This creates the
    // temporary product_ref values inside the base tool set, so send_product
    // can later use the exact same server-validated products.
    const rawSearch = await base.executeTool({
      ...call,
      arguments: JSON.stringify(baseArguments),
    })
    const search = parseSearchResult(rawSearch)
    if (!search || !Array.isArray(search.products) || search.products.length === 0) {
      return rawSearch
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
      limit: Math.min(5, Math.max(1, requestedLimit)),
    })

    if (!visual.referenceFound) {
      return JSON.stringify({
        ...search,
        products: search.products.slice(0, Math.min(5, Math.max(1, requestedLimit))),
        visual_reference: {
          requested: true,
          reference_found: false,
          comparison_succeeded: false,
          confidence: null,
        },
        instruction:
          'No recent customer photograph could be resolved for visual comparison. Do not pretend that the image was analysed. Continue only with ordinary catalogue facts or ask the customer to resend the reference image.',
      })
    }

    if (!visual.comparisonSucceeded || visual.matches.length === 0) {
      return JSON.stringify({
        ...search,
        products: search.products.slice(0, Math.min(5, Math.max(1, requestedLimit))),
        visual_reference: {
          requested: true,
          reference_found: true,
          comparison_succeeded: false,
          confidence: null,
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

    return JSON.stringify({
      ...search,
      products: visuallyRanked,
      found: visuallyRanked.length > 0,
      visual_reference: {
        requested: true,
        reference_found: true,
        comparison_succeeded: true,
        confidence: visual.confidence,
      },
      instruction: instructionForVisualConfidence(visual.confidence),
    })
  }

  return {
    ...base,
    tools,
    executeTool,
  }
}
