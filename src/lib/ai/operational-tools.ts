import { extractCurrencyAmounts } from './guardrails'
import type { AgentToolKey } from './tool-permissions'
import { createAutoReplyTools as createBaseAutoReplyTools } from './tools/index'
import type { AgentToolDefinition, AgentToolExecutor } from './types'

type ToolArgs = Parameters<typeof createBaseAutoReplyTools>[0]
type ToolCall = Parameters<AgentToolExecutor>[0]

const OPERATIONAL_TOOL_KEYS = new Set<AgentToolKey>([
  'check_availability',
  'create_order',
  'get_order_status',
  'update_contact',
])

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function text(value: unknown, max = 1200): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

function positiveInteger(value: unknown, fallback = 1): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10_000) : fallback
}

function enabled(args: ToolArgs, key: AgentToolKey): boolean {
  return Boolean(args.permissions[key])
}

function extraDescription(args: ToolArgs, key: AgentToolKey): string {
  const extra = args.toolInstructions?.[key]?.trim()
  return extra ? ` Account-specific guidance: ${extra}` : ''
}

function operationalDefinitions(args: ToolArgs): AgentToolDefinition[] {
  const tools: AgentToolDefinition[] = []
  if (enabled(args, 'check_availability')) {
    tools.push({
      name: 'check_availability',
      description:
        'Check real configured operational availability for an offering or resource before promising a time or scheduling a visit.' +
        extraDescription(args, 'check_availability'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          starts_at: { type: 'string', description: 'Start datetime in ISO 8601 including timezone.' },
          duration_minutes: { type: 'integer', minimum: 1, maximum: 1440 },
          offering_id: { type: 'string', description: 'Real catalog offering UUID when known.' },
          entity_id: { type: 'string', description: 'Real business resource/entity UUID when known.' },
          entity_name: { type: 'string', description: 'Resource/person/place name when an entity UUID is not known.' },
        },
        required: ['starts_at'],
      },
    })
  }
  if (enabled(args, 'create_order')) {
    tools.push({
      name: 'create_order',
      description:
        'Create a trackable customer order only after clear purchase intent. Product names and prices are loaded from the real catalogue; never supply a model-generated price. Creating an order NEVER confirms payment.' +
        extraDescription(args, 'create_order'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 30,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                product_id: { type: 'string', description: 'Real catalog_products UUID.' },
                quantity: { type: 'integer', minimum: 1, maximum: 10000 },
              },
              required: ['product_id', 'quantity'],
            },
          },
          fulfillment_method: { type: 'string', enum: ['delivery', 'pickup', 'other'] },
          fulfillment_notes: { type: 'string', description: 'Only customer-provided delivery/pickup instructions; never invent an address.' },
        },
        required: ['items'],
      },
    })
  }
  if (enabled(args, 'get_order_status')) {
    tools.push({
      name: 'get_order_status',
      description:
        'Read the factual status of an order belonging to the current contact. Use this before claiming payment, confirmation, fulfilment, cancellation or delivery.' +
        extraDescription(args, 'get_order_status'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          order_id: { type: 'string' },
          reference: { type: 'string' },
        },
      },
    })
  }
  if (enabled(args, 'update_contact')) {
    tools.push({
      name: 'update_contact',
      description:
        'Save structured contact data only when the customer explicitly supplied or corrected it. Never infer profile data.' +
        extraDescription(args, 'update_contact'),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          email: { type: 'string' },
          company: { type: 'string' },
          custom_fields: {
            type: 'object',
            description: 'Existing custom-field names mapped to explicit customer-provided values.',
            additionalProperties: { type: 'string' },
          },
        },
      },
    })
  }
  return tools
}

async function resolveEntityId(
  args: ToolArgs,
  entityId: string | null,
  entityName: string | null,
): Promise<string | null> {
  if (entityId) return entityId
  if (!entityName) return null
  const { data, error } = await args.db
    .from('business_entities')
    .select('id, name')
    .eq('account_id', args.accountId)
    .eq('enabled', true)
    .ilike('name', `%${entityName}%`)
    .limit(3)
  if (error) throw new Error(`Availability resource lookup failed: ${error.message}`)
  if (!data?.length) throw new Error(`No configured resource matched “${entityName}”.`)
  if (data.length > 1) {
    throw new Error(`Resource name is ambiguous: ${data.map((row) => row.name).join(', ')}.`)
  }
  return data[0].id
}

async function executeAvailability(call: ToolCall, args: ToolArgs): Promise<string> {
  const input = parseObject(call.arguments)
  const startsAt = text(input.starts_at, 100)
  if (!startsAt) throw new Error('starts_at is required.')
  const start = new Date(startsAt)
  if (Number.isNaN(start.getTime())) throw new Error('starts_at must be a valid ISO 8601 datetime.')
  const durationMinutes = Math.min(1440, positiveInteger(input.duration_minutes, 60))
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const offeringId = text(input.offering_id, 80)
  const entityId = await resolveEntityId(args, text(input.entity_id, 80), text(input.entity_name, 180))
  if (!offeringId && !entityId) throw new Error('Identify an offering or resource before checking availability.')

  const { data, error } = await args.db.rpc('check_operational_availability', {
    p_account_id: args.accountId,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_offering_id: offeringId,
    p_entity_id: entityId,
  })
  if (error) throw new Error(`Availability check failed: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error('Availability could not be determined.')
  return JSON.stringify({
    ok: true,
    available: Boolean(row.available),
    reason: row.reason ?? null,
    source: row.source ?? null,
    capacity: row.capacity ?? null,
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    offering_id: offeringId,
    entity_id: entityId,
    instruction: row.available
      ? 'The configured schedule confirms this interval. This does not itself create a booking.'
      : 'Do not promise or schedule this interval as available.',
  })
}

interface RequestedItem { productId: string; quantity: number }
function parseItems(value: unknown): RequestedItem[] {
  if (!Array.isArray(value)) return []
  const merged = new Map<string, number>()
  for (const raw of value.slice(0, 30)) {
    const item = parseObject(raw)
    const productId = text(item.product_id, 80)
    if (!productId) continue
    merged.set(productId, (merged.get(productId) ?? 0) + positiveInteger(item.quantity, 1))
  }
  return [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity }))
}

async function executeCreateOrder(call: ToolCall, args: ToolArgs): Promise<string> {
  const input = parseObject(call.arguments)
  const requested = parseItems(input.items)
  if (requested.length === 0) throw new Error('At least one valid product is required.')

  const { data: products, error } = await args.db
    .from('catalog_products')
    .select('id, name, price, currency, stock_quantity, is_active')
    .eq('account_id', args.accountId)
    .eq('is_active', true)
    .in('id', requested.map((item) => item.productId))
  if (error) throw new Error(`Product validation failed: ${error.message}`)
  if ((products ?? []).length !== requested.length) {
    throw new Error('One or more products are missing, inactive or outside this account. Search the catalogue again.')
  }

  const byId = new Map((products ?? []).map((product) => [product.id, product]))
  const currencies = new Set((products ?? []).map((product) => String(product.currency || 'MZN').toUpperCase()))
  if (currencies.size !== 1) throw new Error('A single order cannot mix catalogue currencies.')
  const currency = [...currencies][0]
  const items = requested.map((item) => ({ product: byId.get(item.productId)!, quantity: item.quantity }))
  const unavailable = items.filter(({ product, quantity }) =>
    product.stock_quantity !== null && Number(product.stock_quantity) < quantity,
  )
  if (unavailable.length > 0) {
    throw new Error(`Insufficient stock for: ${unavailable.map(({ product }) => product.name).join(', ')}.`)
  }
  const total = items.reduce((sum, { product, quantity }) => sum + Number(product.price) * quantity, 0)
  const fulfillmentRaw = text(input.fulfillment_method, 30)
  const fulfillment = fulfillmentRaw === 'delivery' || fulfillmentRaw === 'pickup' ? fulfillmentRaw : 'other'
  const notes = text(input.fulfillment_notes, 1200)
  const stockVerified = items.every(({ product }) => product.stock_quantity !== null)

  const { data: order, error: orderError } = await args.db
    .from('customer_orders')
    .insert({
      account_id: args.accountId,
      contact_id: args.contactId,
      conversation_id: args.conversationId || null,
      agent_id: args.config.agentId,
      status: 'pending_payment',
      fulfillment_method: fulfillment,
      fulfillment_notes: notes,
      total_amount: total,
      currency,
      metadata: {
        created_by: 'ai_agent',
        stock_unverified_product_ids: items
          .filter(({ product }) => product.stock_quantity === null)
          .map(({ product }) => product.id),
      },
    })
    .select('id')
    .single()
  if (orderError || !order) throw new Error(`Order could not be created: ${orderError?.message ?? 'unknown error'}`)

  const reference = `ORD-${order.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
  const rows = items.map(({ product, quantity }) => ({
    account_id: args.accountId,
    order_id: order.id,
    catalog_product_id: product.id,
    product_name: product.name,
    quantity,
    unit_price: Number(product.price),
    currency,
  }))
  const { error: itemError } = await args.db.from('customer_order_items').insert(rows)
  if (itemError) {
    await args.db.from('customer_orders').delete().eq('id', order.id).eq('account_id', args.accountId)
    throw new Error(`Order items could not be saved: ${itemError.message}`)
  }
  const { error: referenceError } = await args.db
    .from('customer_orders')
    .update({ external_ref: reference })
    .eq('id', order.id)
    .eq('account_id', args.accountId)
  if (referenceError) console.warn('[ai operational tools] order reference update failed:', referenceError)

  return JSON.stringify({
    ok: true,
    created: true,
    order_id: order.id,
    reference,
    status: 'pending_payment',
    total_amount: total,
    currency,
    fulfillment_method: fulfillment,
    stock_verified: stockVerified,
    items: rows.map((row) => ({
      product_id: row.catalog_product_id,
      name: row.product_name,
      quantity: row.quantity,
      unit_price: row.unit_price,
      currency: row.currency,
    })),
    instruction:
      'The order exists, but payment is NOT confirmed. If stock_verified=false, do not claim physical availability without another trusted source.',
  })
}

async function executeOrderStatus(call: ToolCall, args: ToolArgs): Promise<string> {
  const input = parseObject(call.arguments)
  const orderId = text(input.order_id, 80)
  const reference = text(input.reference, 120)
  let query = args.db
    .from('customer_orders')
    .select('id, external_ref, status, fulfillment_method, fulfillment_notes, total_amount, currency, created_at, updated_at')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
  if (orderId) query = query.eq('id', orderId)
  else if (reference) query = query.ilike('external_ref', reference)
  else query = query.order('created_at', { ascending: false })
  const { data: order, error } = await query.limit(1).maybeSingle()
  if (error) throw new Error(`Order lookup failed: ${error.message}`)
  if (!order) return JSON.stringify({ ok: true, found: false, instruction: 'Do not invent an order status.' })

  const { data: items, error: itemError } = await args.db
    .from('customer_order_items')
    .select('catalog_product_id, product_name, quantity, unit_price, currency')
    .eq('account_id', args.accountId)
    .eq('order_id', order.id)
  if (itemError) throw new Error(`Order items could not be loaded: ${itemError.message}`)
  return JSON.stringify({ ok: true, found: true, order: { ...order, items: items ?? [] } })
}

async function executeUpdateContact(call: ToolCall, args: ToolArgs): Promise<string> {
  const input = parseObject(call.arguments)
  const patch: Record<string, string> = {}
  const name = text(input.name, 180)
  const company = text(input.company, 180)
  const email = text(input.email, 320)
  if (name) patch.name = name
  if (company) patch.company = company
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('The supplied email format is invalid.')
    patch.email = email
  }

  const rawCustom = parseObject(input.custom_fields)
  const customPairs = Object.entries(rawCustom)
    .map(([key, value]) => [text(key, 100), text(value, 1000)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
    .slice(0, 20)
  if (Object.keys(patch).length === 0 && customPairs.length === 0) {
    throw new Error('No explicit valid contact data was supplied.')
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await args.db
      .from('contacts')
      .update(patch)
      .eq('id', args.contactId)
      .eq('account_id', args.accountId)
    if (error) throw new Error(`Contact update failed: ${error.message}`)
  }

  const savedCustomFields: string[] = []
  if (customPairs.length > 0) {
    const { data: fields, error } = await args.db
      .from('custom_fields')
      .select('id, field_name')
      .eq('account_id', args.accountId)
      .in('field_name', customPairs.map(([fieldName]) => fieldName))
    if (error) throw new Error(`Custom-field lookup failed: ${error.message}`)
    const byName = new Map((fields ?? []).map((field) => [String(field.field_name).toLocaleLowerCase(), field.id]))
    for (const [fieldName, value] of customPairs) {
      const fieldId = byName.get(fieldName.toLocaleLowerCase())
      if (!fieldId) continue
      const { error: valueError } = await args.db.from('contact_custom_values').upsert(
        { contact_id: args.contactId, custom_field_id: fieldId, value },
        { onConflict: 'contact_id,custom_field_id' },
      )
      if (!valueError) savedCustomFields.push(fieldName)
    }
  }

  return JSON.stringify({
    ok: true,
    updated_fields: Object.keys(patch),
    updated_custom_fields: savedCustomFields,
    instruction: 'Only explicitly supplied customer data was persisted.',
  })
}

async function executeOperational(call: ToolCall, args: ToolArgs): Promise<string> {
  const key = call.name as AgentToolKey
  if (!OPERATIONAL_TOOL_KEYS.has(key) || !enabled(args, key)) {
    throw new Error(`Tool is disabled for this agent: ${call.name}`)
  }
  if (call.name === 'check_availability') return executeAvailability(call, args)
  if (call.name === 'create_order') return executeCreateOrder(call, args)
  if (call.name === 'get_order_status') return executeOrderStatus(call, args)
  if (call.name === 'update_contact') return executeUpdateContact(call, args)
  throw new Error(`Unknown operational tool: ${call.name}`)
}

/** Additive wrapper: mature catalogue/CRM tools keep their implementation in
 * tools/index.ts; this layer only adds generic operational actions. */
export function createAutoReplyTools(args: ToolArgs) {
  const base = createBaseAutoReplyTools(args)
  const operational = operationalDefinitions(args)
  const operationalNames = new Set(operational.map((tool) => tool.name))
  const operationalTrustedAmounts = new Set<number>()

  const executeTool: AgentToolExecutor = async (call) => {
    if (!operationalNames.has(call.name)) return base.executeTool(call)
    const startedAt = Date.now()
    let succeeded = false
    try {
      const result = await executeOperational(call, args)
      for (const amount of extractCurrencyAmounts(result)) operationalTrustedAmounts.add(amount)
      succeeded = true
      return result
    } finally {
      const ms = Math.max(0, Date.now() - startedAt)
      try {
        args.onToolCall?.({ name: call.name, ms, succeeded })
      } catch (error) {
        console.error('[ai operational tools] trace callback failed:', error)
      }
      if (args.config.agentId && args.conversationId) {
        try {
          const { error } = await args.db.from('agent_tool_calls').insert({
            account_id: args.accountId,
            agent_id: args.config.agentId,
            conversation_id: args.conversationId,
            tool_key: call.name,
            duration_ms: ms,
            succeeded,
          })
          if (error) console.error('[ai operational tools] call log failed:', error)
        } catch (error) {
          console.error('[ai operational tools] call log failed:', error)
        }
      }
    }
  }

  return {
    ...base,
    tools: [...base.tools, ...operational],
    executeTool,
    getTrustedPriceAmounts: () => [
      ...base.getTrustedPriceAmounts(),
      ...operationalTrustedAmounts,
    ],
  }
}
