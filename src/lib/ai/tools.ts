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
import { schedulingEvidenceIsComplete } from './scheduling-grounding'
import { createAutoReplyTools as createBaseAutoReplyTools } from './operational-tools'
import { loadHandoffQueues, resolveHandoffRoute } from './handoff-routing'
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

interface AvailabilityCheck {
  available: boolean
  startsAt: string | null
}

type QueueAwareToolArgs = Parameters<typeof createBaseAutoReplyTools>[0] & {
  config: Parameters<typeof createBaseAutoReplyTools>[0]['config'] & {
    handoffAgentId?: string | null
  }
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

function parseAvailabilityCheck(raw: string): AvailabilityCheck | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      available: parsed.available === true,
      startsAt: typeof parsed.starts_at === 'string' ? parsed.starts_at : null,
    }
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

function augmentHandoffTool(tool: AgentToolDefinition): AgentToolDefinition {
  if (tool.name !== 'handoff_human') return tool
  const parameters = tool.parameters as {
    properties?: Record<string, unknown>
    [key: string]: unknown
  }
  return {
    ...tool,
    description:
      `${tool.description} ` +
      'This account may have specialist human queues. On the first handoff call, omit routing_key unless the server already returned an exact configured key in this turn. If routing is needed, the tool returns the available queues; call it again with exactly one returned routing_key. Never invent a department or routing key.',
    parameters: {
      ...parameters,
      properties: {
        ...(parameters.properties ?? {}),
        routing_key: {
          type: 'string',
          description:
            'Optional exact specialist routing key returned by a previous handoff_human result in this turn. Omit on the first call or when no specialist clearly applies.',
        },
      },
    },
  }
}

function augmentGroundedTool(tool: AgentToolDefinition): AgentToolDefinition {
  if (tool.name === 'search_knowledge') {
    return {
      ...tool,
      description:
        `${tool.description} ` +
        'MANDATORY for company-specific factual questions when this tool is available, including address/location, opening hours, contacts, payment methods, delivery or pickup conditions, returns/exchanges, policies and services. Do not answer such facts from memory or expose an internal placeholder; search first.',
    }
  }
  if (tool.name === 'schedule_visit') {
    return {
      ...tool,
      description:
        `${tool.description} ` +
        'The server rejects scheduling unless the recent customer messages explicitly contain BOTH a date and a specific time. Never choose either on the customer’s behalf. When check_availability is enabled, verify that exact time first.',
    }
  }
  return tool
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
  return 'Visual comparison is plausible and meets this business minimum threshold, but it is not unique. Do not claim an exact match. Present the best one or two catalogue candidates and ask the customer to confirm which one they mean; use send_product with each candidate product_ref and recommended_image_index when visual confirmation helps. Availability, sizes and prices must come only from the factual catalogue fields.'
}

async function recentCustomerTexts(
  args: Parameters<typeof createBaseAutoReplyTools>[0],
): Promise<string[]> {
  if (!args.conversationId) return []
  const { data, error } = await args.db
    .from('messages')
    .select('content_text')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .in('content_type', ['text', 'interactive'])
    .order('created_at', { ascending: false })
    .limit(3)
  if (error) throw new Error(`Recent customer messages could not be verified: ${error.message}`)
  return (data ?? [])
    .map((row) => typeof row.content_text === 'string' ? row.content_text : '')
    .filter(Boolean)
    .reverse()
}

function sameScheduledStart(scheduledAt: string, checkedAt: string): boolean {
  const scheduled = new Date(scheduledAt).getTime()
  const checked = new Date(checkedAt).getTime()
  return Number.isFinite(scheduled) && Number.isFinite(checked) && Math.abs(scheduled - checked) <= 5 * 60_000
}

async function executeQueueAwareHandoff(
  args: QueueAwareToolArgs,
  base: ReturnType<typeof createBaseAutoReplyTools>,
  call: AgentToolCall,
): Promise<string> {
  const parsed = parseToolArguments(call.arguments)
  if (!parsed) throw new Error('Invalid JSON arguments for handoff_human.')

  const requestedKey = typeof parsed.routing_key === 'string'
    ? parsed.routing_key.trim().toLowerCase()
    : ''
  const queues = await loadHandoffQueues(args.db, args.accountId)

  if (!requestedKey && queues.length > 1) {
    return JSON.stringify({
      ok: false,
      handoff_requested: false,
      needs_routing: true,
      queues: queues.map((queue) => ({
        routing_key: queue.routingKey,
        name: queue.name,
        description: queue.description,
      })),
      instruction:
        'Choose the single specialist queue that clearly matches the subject and call handoff_human again with its exact routing_key. If none clearly fits, call again with routing_key="general_fallback" so the server uses the configured fallback instead of inventing a queue.',
    })
  }

  const useGeneralFallback = requestedKey === 'general_fallback'
  const effectiveKey = useGeneralFallback
    ? null
    : requestedKey || (queues.length === 1 ? queues[0].routingKey : null)

  if (effectiveKey && !queues.some((queue) => queue.routingKey === effectiveKey)) {
    return JSON.stringify({
      ok: false,
      handoff_requested: false,
      needs_routing: true,
      invalid_routing_key: effectiveKey,
      queues: queues.map((queue) => ({
        routing_key: queue.routingKey,
        name: queue.name,
        description: queue.description,
      })),
      instruction:
        'The routing key is not configured. Retry with one exact routing_key from queues, or routing_key="general_fallback".',
    })
  }

  const route = await resolveHandoffRoute({
    db: args.db,
    accountId: args.accountId,
    requestedRoutingKey: effectiveKey,
    fallbackUserId: args.config.handoffAgentId,
  })

  // The normal auto-reply handoff lifecycle already persists assignment and
  // sends the assignee notification. Point its existing config object at the
  // selected eligible specialist rather than creating a competing path.
  args.config.handoffAgentId = route.assigneeUserId

  if (!route.assigneeUserId && route.notifyUserIds.length > 0 && args.conversationId) {
    const queueLabel = route.queue?.name ? ` (${route.queue.name})` : ''
    const rows = route.notifyUserIds.map((userId) => ({
      account_id: args.accountId,
      user_id: userId,
      type: 'conversation_assigned',
      conversation_id: args.conversationId,
      contact_id: args.contactId,
      title: 'Handoff sem especialista disponível',
      body: `A IA pediu intervenção humana${queueLabel}, mas não encontrou um membro elegível. A conversa ficará sem responsável até alguém assumir.`,
    }))
    const { error } = await args.db.from('notifications').insert(rows)
    if (error) console.error('[handoff routing] admin fallback notification failed:', error)
  }

  const queueSummary = route.queue
    ? `Equipa: ${route.queue.name} (${route.queue.routingKey})`
    : null
  const originalSummary = typeof parsed.summary === 'string' ? parsed.summary.trim() : ''
  const forwarded: Record<string, unknown> = {
    ...parsed,
    summary: [queueSummary, originalSummary].filter(Boolean).join('\n') || undefined,
  }
  delete forwarded.routing_key

  return base.executeTool({ ...call, arguments: JSON.stringify(forwarded) })
}

/**
 * Public AI tool facade. The underlying catalogue tool remains the code-owned
 * permission/audit boundary; the operational layer adds generic business
 * actions, while visual reference search remains a read-only mode of
 * search_catalog. Existing tenant permissions and Skills continue to apply.
 */
export function createAutoReplyTools(
  args: QueueAwareToolArgs,
): ReturnType<typeof createBaseAutoReplyTools> {
  const base = createBaseAutoReplyTools(args)
  const tools = base.tools
    .map(augmentSearchCatalogueTool)
    .map(augmentHandoffTool)
    .map(augmentGroundedTool)
  let settingsPromise: Promise<SearchCatalogToolSettings> | null = null
  let lastAvailabilityCheck: AvailabilityCheck | null = null
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
    if (call.name === 'handoff_human') {
      return executeQueueAwareHandoff(args, base, call)
    }
    if (OPERATIONAL_RUNTIME_TOOLS.has(call.name)) {
      const parsed = parseToolArguments(call.arguments)
      if (!parsed) throw new Error(`Invalid JSON arguments for operational tool: ${call.name}`)
      const result = await base.executeTool({
        ...call,
        arguments: JSON.stringify(parsed),
      })
      if (call.name === 'check_availability') {
        lastAvailabilityCheck = parseAvailabilityCheck(result)
      }
      return result
    }

    if (call.name === 'schedule_visit') {
      const parsed = parseToolArguments(call.arguments)
      const scheduledAt = parsed && typeof parsed.scheduled_at === 'string'
        ? parsed.scheduled_at
        : ''
      const customerTexts = await recentCustomerTexts(args)
      if (!schedulingEvidenceIsComplete(customerTexts)) {
        throw new Error(
          'Visit not scheduled: the customer must explicitly provide or confirm both a date and a specific time. Ask for the missing detail instead of choosing one.',
        )
      }
      if (args.permissions.check_availability) {
        if (!lastAvailabilityCheck?.available || !lastAvailabilityCheck.startsAt) {
          throw new Error(
            'Visit not scheduled: check_availability must confirm the requested time in this turn before scheduling.',
          )
        }
        if (!sameScheduledStart(scheduledAt, lastAvailabilityCheck.startsAt)) {
          throw new Error(
            'Visit not scheduled: the scheduled time differs from the interval confirmed by check_availability.',
          )
        }
      }
      return base.executeTool(call)
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
