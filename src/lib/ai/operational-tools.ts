import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { AgentToolKey } from './tool-permissions'
import {
  createAutoReplyTools as createBaseAutoReplyTools,
  type ToolCall,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolOutcome,
} from './tools'

const OPERATIONAL_TOOL_KEYS = new Set<AgentToolKey>([
  'check_availability',
  'create_order',
  'get_order_status',
  'update_contact',
])

function parseArgs(call: ToolCall): Record<string, unknown> {
  try {
    const value = JSON.parse(call.argumentsJson || '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function stringArg(value: unknown, max = 1200): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  return cleaned ? cleaned.slice(0, max) : null
}

function positiveInteger(value: unknown, fallback = 1): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? Math.min(n, 10_000) : fallback
}

function runtimeInstructions(context: ToolExecutionContext, key: AgentToolKey): string {
  const text = context.toolSettings?.get(key)?.instructions?.trim()
  return text ? `\n\nInstruções desta empresa: ${text}` : ''
}

function enabled(context: ToolExecutionContext, key: AgentToolKey): boolean {
  if (!context.permissions[key]) return false
  const setting = context.toolSettings?.get(key)
  return setting ? setting.enabled !== false : true
}

function definitions(context: ToolExecutionContext): ToolDefinition[] {
  const defs: ToolDefinition[] = []

  if (enabled(context, 'check_availability')) {
    defs.push({
      type: 'function',
      function: {
        name: 'check_availability',
        description:
          'Verifica a disponibilidade operacional real de uma oferta ou recurso para um intervalo. Use antes de prometer ou marcar um horário.' +
          runtimeInstructions(context, 'check_availability'),
        parameters: {
          type: 'object',
          properties: {
            starts_at: { type: 'string', description: 'Data/hora inicial em ISO 8601 com timezone.' },
            duration_minutes: { type: 'integer', description: 'Duração em minutos; padrão 60.' },
            offering_id: { type: 'string', description: 'ID real da oferta/produto quando conhecido.' },
            entity_id: { type: 'string', description: 'ID real do recurso/pessoa/local quando conhecido.' },
            entity_name: { type: 'string', description: 'Nome exacto ou suficientemente específico do recurso, se não houver ID.' },
          },
          required: ['starts_at'],
        },
      },
    })
  }

  if (enabled(context, 'create_order')) {
    defs.push({
      type: 'function',
      function: {
        name: 'create_order',
        description:
          'Cria uma encomenda rastreável somente quando o cliente já manifestou intenção clara de comprar. Os preços são sempre lidos do catálogo; nunca forneça preço calculado pelo modelo. Esta ferramenta não confirma pagamento.' +
          runtimeInstructions(context, 'create_order'),
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              minItems: 1,
              maxItems: 30,
              items: {
                type: 'object',
                properties: {
                  product_id: { type: 'string', description: 'ID real de catalog_products.' },
                  quantity: { type: 'integer', minimum: 1, maximum: 10000 },
                },
                required: ['product_id', 'quantity'],
              },
            },
            fulfillment_method: {
              type: 'string',
              enum: ['delivery', 'pickup', 'other'],
              description: 'Forma de entrega explicitamente definida ou confirmada pelo cliente.',
            },
            fulfillment_notes: {
              type: 'string',
              description: 'Instruções de entrega/levantamento fornecidas pelo cliente. Não inventar endereço.',
            },
          },
          required: ['items'],
        },
      },
    })
  }

  if (enabled(context, 'get_order_status')) {
    defs.push({
      type: 'function',
      function: {
        name: 'get_order_status',
        description:
          'Consulta o estado factual de uma encomenda do contacto actual. Use antes de afirmar pagamento, confirmação, entrega, cancelamento ou conclusão.' +
          runtimeInstructions(context, 'get_order_status'),
        parameters: {
          type: 'object',
          properties: {
            order_id: { type: 'string', description: 'UUID da encomenda quando conhecido.' },
            reference: { type: 'string', description: 'Referência externa/visível da encomenda quando conhecida.' },
          },
        },
      },
    })
  }

  if (enabled(context, 'update_contact')) {
    defs.push({
      type: 'function',
      function: {
        name: 'update_contact',
        description:
          'Actualiza dados estruturados do contacto apenas quando o próprio cliente os forneceu ou corrigiu explicitamente. Não inferir nome, email, empresa nem campos personalizados.' +
          runtimeInstructions(context, 'update_contact'),
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            email: { type: 'string' },
            company: { type: 'string' },
            custom_fields: {
              type: 'object',
              description: 'Mapa campo->valor usando nomes de campos personalizados já existentes nesta conta.',
              additionalProperties: { type: 'string' },
            },
          },
        },
      },
    })
  }

  return defs
}

async function resolveEntityId(
  db: WacrmSupabaseClient,
  accountId: string,
  entityId: string | null,
  entityName: string | null,
): Promise<{ id: string | null; error: string | null }> {
  if (entityId) return { id: entityId, error: null }
  if (!entityName) return { id: null, error: null }

  const { data, error } = await db
    .from('business_entities')
    .select('id, name')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .ilike('name', `%${entityName}%`)
    .limit(3)
  if (error) return { id: null, error: error.message }
  if (!data?.length) return { id: null, error: `Nenhum recurso encontrado para “${entityName}”.` }
  if (data.length > 1) {
    return {
      id: null,
      error: `O nome “${entityName}” corresponde a vários recursos: ${data.map((row) => row.name).join(', ')}.`,
    }
  }
  return { id: data[0].id, error: null }
}

async function checkAvailability(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
  const args = parseArgs(call)
  const startsAt = stringArg(args.starts_at, 100)
  const offeringId = stringArg(args.offering_id, 80)
  const entityName = stringArg(args.entity_name, 180)
  const explicitEntityId = stringArg(args.entity_id, 80)
  const durationMinutes = Math.min(24 * 60, positiveInteger(args.duration_minutes, 60))
  if (!startsAt) return { toolCallId: call.id, name: call.name, ok: false, message: 'Falta starts_at.' }
  const start = new Date(startsAt)
  if (!Number.isFinite(start.getTime())) {
    return { toolCallId: call.id, name: call.name, ok: false, message: 'starts_at não é uma data/hora ISO válida.' }
  }
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const entity = await resolveEntityId(context.db, context.accountId, explicitEntityId, entityName)
  if (entity.error) return { toolCallId: call.id, name: call.name, ok: false, message: entity.error }
  if (!offeringId && !entity.id) {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      message: 'Para verificar disponibilidade é necessário identificar a oferta ou o recurso.',
    }
  }

  const { data, error } = await context.db.rpc('check_operational_availability', {
    p_account_id: context.accountId,
    p_starts_at: start.toISOString(),
    p_ends_at: end.toISOString(),
    p_offering_id: offeringId,
    p_entity_id: entity.id,
  })
  if (error) return { toolCallId: call.id, name: call.name, ok: false, message: `Falha ao verificar disponibilidade: ${error.message}` }
  const row = Array.isArray(data) ? data[0] : data
  if (!row) return { toolCallId: call.id, name: call.name, ok: false, message: 'A disponibilidade não pôde ser determinada.' }
  return {
    toolCallId: call.id,
    name: call.name,
    ok: true,
    message: row.available ? 'Disponibilidade confirmada para o período solicitado.' : `Indisponível: ${row.reason ?? 'sem horário disponível'}.`,
    data: {
      available: Boolean(row.available),
      reason: row.reason ?? null,
      source: row.source ?? null,
      capacity: row.capacity ?? null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      offering_id: offeringId,
      entity_id: entity.id,
    },
  }
}

interface RequestedOrderItem {
  product_id: string
  quantity: number
}

function requestedItems(value: unknown): RequestedOrderItem[] {
  if (!Array.isArray(value)) return []
  const seen = new Map<string, number>()
  for (const raw of value.slice(0, 30)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, unknown>
    const id = stringArg(item.product_id, 80)
    if (!id) continue
    const quantity = positiveInteger(item.quantity, 1)
    seen.set(id, (seen.get(id) ?? 0) + quantity)
  }
  return [...seen.entries()].map(([product_id, quantity]) => ({ product_id, quantity }))
}

async function createOrder(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
  const args = parseArgs(call)
  const items = requestedItems(args.items)
  if (items.length === 0) return { toolCallId: call.id, name: call.name, ok: false, message: 'A encomenda precisa de pelo menos um produto válido.' }

  const ids = items.map((item) => item.product_id)
  const { data: products, error: productError } = await context.db
    .from('catalog_products')
    .select('id, name, price, currency, stock_quantity, is_active')
    .eq('account_id', context.accountId)
    .eq('is_active', true)
    .in('id', ids)
  if (productError) return { toolCallId: call.id, name: call.name, ok: false, message: `Falha ao validar produtos: ${productError.message}` }
  if ((products ?? []).length !== ids.length) {
    return { toolCallId: call.id, name: call.name, ok: false, message: 'Um ou mais produtos não existem, não pertencem a esta conta ou estão inactivos. Pesquise o catálogo novamente.' }
  }

  const byId = new Map((products ?? []).map((product) => [product.id, product]))
  const currencies = new Set((products ?? []).map((product) => String(product.currency || 'MZN').toUpperCase()))
  if (currencies.size !== 1) {
    return { toolCallId: call.id, name: call.name, ok: false, message: 'Não é possível criar uma única encomenda com produtos em moedas diferentes.' }
  }

  const orderItems = items.map((item) => {
    const product = byId.get(item.product_id)!
    return {
      product,
      quantity: item.quantity,
      lineTotal: Number(product.price) * item.quantity,
    }
  })
  const insufficient = orderItems.filter(({ product, quantity }) =>
    product.stock_quantity !== null && Number(product.stock_quantity) < quantity,
  )
  if (insufficient.length > 0) {
    return {
      toolCallId: call.id,
      name: call.name,
      ok: false,
      message: `Stock insuficiente para: ${insufficient.map(({ product }) => product.name).join(', ')}.`,
    }
  }

  const fulfillmentMethodRaw = stringArg(args.fulfillment_method, 30)
  const fulfillmentMethod = fulfillmentMethodRaw === 'delivery' || fulfillmentMethodRaw === 'pickup'
    ? fulfillmentMethodRaw
    : 'other'
  const fulfillmentNotes = stringArg(args.fulfillment_notes, 1200)
  const currency = [...currencies][0]
  const totalAmount = orderItems.reduce((sum, item) => sum + item.lineTotal, 0)

  const { data: order, error: orderError } = await context.db
    .from('customer_orders')
    .insert({
      account_id: context.accountId,
      contact_id: context.contactId,
      conversation_id: context.conversationId,
      agent_id: context.agentId,
      status: 'pending_payment',
      fulfillment_method: fulfillmentMethod,
      fulfillment_notes: fulfillmentNotes,
      total_amount: totalAmount,
      currency,
      metadata: {
        created_by: 'ai_agent',
        stock_unverified_product_ids: orderItems
          .filter(({ product }) => product.stock_quantity === null)
          .map(({ product }) => product.id),
      },
    })
    .select('id, status, total_amount, currency, fulfillment_method, created_at')
    .single()
  if (orderError || !order) {
    return { toolCallId: call.id, name: call.name, ok: false, message: `Não foi possível criar a encomenda: ${orderError?.message ?? 'erro desconhecido'}` }
  }

  const reference = `ORD-${order.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
  const rows = orderItems.map(({ product, quantity }) => ({
    account_id: context.accountId,
    order_id: order.id,
    catalog_product_id: product.id,
    product_name: product.name,
    quantity,
    unit_price: Number(product.price),
    currency: String(product.currency || currency).toUpperCase(),
  }))
  const { error: itemsError } = await context.db.from('customer_order_items').insert(rows)
  if (itemsError) {
    await context.db.from('customer_orders').delete().eq('id', order.id).eq('account_id', context.accountId)
    return { toolCallId: call.id, name: call.name, ok: false, message: `Não foi possível concluir a encomenda: ${itemsError.message}` }
  }
  const { error: refError } = await context.db
    .from('customer_orders')
    .update({ external_ref: reference })
    .eq('id', order.id)
    .eq('account_id', context.accountId)
  if (refError) console.warn('[ai operational tools] order reference update failed:', refError)

  const stockVerified = orderItems.every(({ product }) => product.stock_quantity !== null)
  return {
    toolCallId: call.id,
    name: call.name,
    ok: true,
    message: `Encomenda ${reference} criada. Estado: pagamento pendente. Total: ${totalAmount.toFixed(2)} ${currency}. Pagamento NÃO está confirmado.${stockVerified ? '' : ' Alguns itens não têm controlo de stock configurado; não afirme disponibilidade física sem outra fonte confiável.'}`,
    data: {
      order_id: order.id,
      reference,
      status: 'pending_payment',
      total_amount: totalAmount,
      currency,
      fulfillment_method: fulfillmentMethod,
      stock_verified: stockVerified,
      items: rows.map((row) => ({ product_id: row.catalog_product_id, name: row.product_name, quantity: row.quantity, unit_price: row.unit_price, currency: row.currency })),
    },
  }
}

async function getOrderStatus(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
  const args = parseArgs(call)
  const orderId = stringArg(args.order_id, 80)
  const reference = stringArg(args.reference, 120)
  let query = context.db
    .from('customer_orders')
    .select('id, external_ref, status, fulfillment_method, fulfillment_notes, total_amount, currency, created_at, updated_at')
    .eq('account_id', context.accountId)
    .eq('contact_id', context.contactId)
  if (orderId) query = query.eq('id', orderId)
  else if (reference) query = query.ilike('external_ref', reference)
  else query = query.order('created_at', { ascending: false }).limit(1)
  const { data, error } = await query.limit(1).maybeSingle()
  if (error) return { toolCallId: call.id, name: call.name, ok: false, message: `Falha ao consultar encomenda: ${error.message}` }
  if (!data) return { toolCallId: call.id, name: call.name, ok: false, message: 'Nenhuma encomenda correspondente foi encontrada para este contacto.' }

  const { data: items, error: itemsError } = await context.db
    .from('customer_order_items')
    .select('catalog_product_id, product_name, quantity, unit_price, currency')
    .eq('account_id', context.accountId)
    .eq('order_id', data.id)
  if (itemsError) return { toolCallId: call.id, name: call.name, ok: false, message: `Encomenda encontrada, mas os itens não puderam ser lidos: ${itemsError.message}` }

  return {
    toolCallId: call.id,
    name: call.name,
    ok: true,
    message: `Encomenda ${data.external_ref ?? data.id}: estado ${data.status}; total ${Number(data.total_amount).toFixed(2)} ${data.currency}; forma ${data.fulfillment_method}.`,
    data: { ...data, items: items ?? [] },
  }
}

async function updateContact(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
  const args = parseArgs(call)
  const patch: Record<string, string> = {}
  const name = stringArg(args.name, 180)
  const email = stringArg(args.email, 320)
  const company = stringArg(args.company, 180)
  if (name) patch.name = name
  if (company) patch.company = company
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { toolCallId: call.id, name: call.name, ok: false, message: 'O email fornecido não tem formato válido; não foi guardado.' }
    }
    patch.email = email
  }

  const custom = args.custom_fields && typeof args.custom_fields === 'object' && !Array.isArray(args.custom_fields)
    ? (args.custom_fields as Record<string, unknown>)
    : {}
  const customPairs = Object.entries(custom)
    .map(([key, value]) => [stringArg(key, 100), stringArg(value, 1000)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
    .slice(0, 20)

  if (Object.keys(patch).length === 0 && customPairs.length === 0) {
    return { toolCallId: call.id, name: call.name, ok: false, message: 'Nenhum dado explícito válido foi fornecido para actualizar.' }
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await context.db
      .from('contacts')
      .update(patch)
      .eq('id', context.contactId)
      .eq('account_id', context.accountId)
    if (error) return { toolCallId: call.id, name: call.name, ok: false, message: `Não foi possível actualizar o contacto: ${error.message}` }
  }

  const savedCustomFields: string[] = []
  if (customPairs.length > 0) {
    const requestedNames = customPairs.map(([key]) => key)
    const { data: fields, error: fieldsError } = await context.db
      .from('custom_fields')
      .select('id, field_name')
      .eq('account_id', context.accountId)
      .in('field_name', requestedNames)
    if (fieldsError) return { toolCallId: call.id, name: call.name, ok: false, message: `Dados básicos actualizados, mas os campos personalizados falharam: ${fieldsError.message}` }
    const byName = new Map((fields ?? []).map((field) => [String(field.field_name).toLocaleLowerCase(), field.id]))
    for (const [fieldName, value] of customPairs) {
      const fieldId = byName.get(fieldName.toLocaleLowerCase())
      if (!fieldId) continue
      const { error } = await context.db.from('contact_custom_values').upsert(
        { contact_id: context.contactId, custom_field_id: fieldId, value },
        { onConflict: 'contact_id,custom_field_id' },
      )
      if (!error) savedCustomFields.push(fieldName)
    }
  }

  return {
    toolCallId: call.id,
    name: call.name,
    ok: true,
    message: 'Dados do contacto actualizados apenas com informação explicitamente fornecida pelo cliente.',
    data: { updated_fields: Object.keys(patch), updated_custom_fields: savedCustomFields },
  }
}

async function executeOperational(call: ToolCall, context: ToolExecutionContext): Promise<ToolOutcome> {
  const key = call.name as AgentToolKey
  if (!OPERATIONAL_TOOL_KEYS.has(key) || !enabled(context, key)) {
    return { toolCallId: call.id, name: call.name, ok: false, message: `Ferramenta ${call.name} não está disponível para este agente.` }
  }
  if (call.name === 'check_availability') return checkAvailability(call, context)
  if (call.name === 'create_order') return createOrder(call, context)
  if (call.name === 'get_order_status') return getOrderStatus(call, context)
  if (call.name === 'update_contact') return updateContact(call, context)
  return { toolCallId: call.id, name: call.name, ok: false, message: `Ferramenta ${call.name} não implementada.` }
}

function operationalPrompt(defs: ToolDefinition[]): string | null {
  if (defs.length === 0) return null
  return [
    'Operational action rules:',
    defs.some((definition) => definition.function.name === 'check_availability')
      ? '- Before promising a bookable time, call check_availability. A schedule window is a fact, not something to infer from prose.'
      : null,
    defs.some((definition) => definition.function.name === 'create_order')
      ? '- create_order is for clear purchase intent only. Its total comes from current catalogue prices. Creating an order never means payment was received.'
      : null,
    defs.some((definition) => definition.function.name === 'get_order_status')
      ? '- For any claim about an existing order, payment, fulfilment or cancellation, prefer get_order_status over memory or conversation text.'
      : null,
    defs.some((definition) => definition.function.name === 'update_contact')
      ? '- update_contact stores only facts the customer explicitly supplied or corrected. Never infer profile data.'
      : null,
  ].filter(Boolean).join('\n')
}

/**
 * Thin additive wrapper around the mature base tool runtime. Existing tools
 * keep their exact implementation; this layer owns only generic operational
 * actions that were missing from the agent.
 */
export function createAutoReplyTools(context: ToolExecutionContext) {
  const base = createBaseAutoReplyTools(context)
  const ops = definitions(context)
  const opNames = new Set(ops.map((definition) => definition.function.name))
  const prompt = operationalPrompt(ops)

  return {
    definitions: [...base.definitions, ...ops],
    systemPrompt: [base.systemPrompt, prompt].filter(Boolean).join('\n\n'),
    execute: async (call: ToolCall): Promise<ToolOutcome> => {
      if (!opNames.has(call.name)) return base.execute(call)
      let outcome: ToolOutcome
      try {
        outcome = await executeOperational(call, context)
      } catch (error) {
        outcome = {
          toolCallId: call.id,
          name: call.name,
          ok: false,
          message: error instanceof Error ? error.message : 'Falha operacional inesperada.',
        }
      }
      context.onToolCall?.(call, outcome)
      return outcome
    },
  }
}
