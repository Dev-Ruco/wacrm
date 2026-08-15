import type { PersistedCompositionState } from '@/lib/catalog/composition'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export interface ConversationCatalogState {
  lastQuery: string | null
  lastFilters: Record<string, unknown>
  shownProductKeys: string[]
  shownMediaKeys: string[]
  rejectedProductKeys: string[]
  selectedProductKey: string | null
  selectedProductName: string | null
  compositionTemplateId: string | null
  compositionState: PersistedCompositionState
}

const EMPTY_COMPOSITION: PersistedCompositionState = { slots: {} }

const EMPTY_STATE: ConversationCatalogState = {
  lastQuery: null,
  lastFilters: {},
  shownProductKeys: [],
  shownMediaKeys: [],
  rejectedProductKeys: [],
  selectedProductKey: null,
  selectedProductName: null,
  compositionTemplateId: null,
  compositionState: EMPTY_COMPOSITION,
}

function emptyState(): ConversationCatalogState {
  return { ...EMPTY_STATE, lastFilters: {}, compositionState: { slots: {} } }
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  )
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asCompositionState(value: unknown): PersistedCompositionState {
  const raw = asObject(value)
  const slotsRaw = asObject(raw.slots)
  const slots: PersistedCompositionState['slots'] = {}
  for (const [rawKey, rawItems] of Object.entries(slotsRaw).slice(0, 24)) {
    const key = rawKey.trim().slice(0, 80)
    if (!key || !Array.isArray(rawItems)) continue
    const items = rawItems
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
      .map((item) => ({
        productId: typeof item.productId === 'string' ? item.productId.trim() : '',
        productKey: typeof item.productKey === 'string' ? item.productKey.trim() : '',
        name: typeof item.name === 'string' ? item.name.trim().slice(0, 200) : '',
      }))
      .filter((item) => item.productId && item.productKey && item.name)
      .slice(0, 20)
    if (items.length) slots[key] = items
  }
  return { slots }
}

function mergeUnique(current: string[], additions: string[]): string[] {
  return Array.from(new Set([...current, ...additions])).slice(-500)
}

function safeFilterText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

function safeAttributeFilters(value: unknown): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const entries: Array<[string, string]> = []
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    const key = rawKey.trim().slice(0, 80)
    if (!key) continue
    if (
      typeof rawValue !== 'string' &&
      typeof rawValue !== 'number' &&
      typeof rawValue !== 'boolean'
    ) continue
    const printable = String(rawValue).trim().slice(0, 120)
    if (!printable) continue
    entries.push([key, printable])
    if (entries.length >= 12) break
  }
  return entries
}

function compositionPromptLines(state: ConversationCatalogState): string[] {
  const entries = Object.entries(state.compositionState.slots)
    .filter(([, items]) => items.length > 0)
    .slice(0, 12)
  if (!entries.length) return []
  return [
    `Active composition has ${entries.length} populated slot(s).`,
    ...entries.map(([slot, items]) =>
      `- ${slot}: ${items.slice(0, 5).map((item) => JSON.stringify(item.name)).join(', ')}`,
    ),
    'When the customer says to keep one part and change another, preserve the requested slots and revise only the named slot(s) through the composition capability. Do not expose internal slot keys or state.',
  ]
}

/**
 * Small operational context block for the model. Product keys and media keys
 * stay server-side; the model only receives human-readable catalogue context.
 * This is current-conversation state, not durable customer memory.
 */
export function conversationCatalogStatePrompt(
  state: ConversationCatalogState,
): string | null {
  const category = safeFilterText(state.lastFilters.category)
  const color = safeFilterText(state.lastFilters.color)
  const size = safeFilterText(state.lastFilters.size)
  const attributes = safeAttributeFilters(state.lastFilters.attributes)
  const compositionLines = compositionPromptLines(state)
  const hasContext = Boolean(
    state.selectedProductName || state.lastQuery || category || color || size || attributes.length || compositionLines.length,
  )
  if (!hasContext) return null

  const lines = [
    'Current catalogue conversation state — operational context from this WhatsApp conversation, not long-term customer memory.',
  ]
  if (state.selectedProductName) {
    lines.push(`Selected/current product: ${JSON.stringify(state.selectedProductName)}.`)
  }
  if (state.lastQuery) lines.push(`Last catalogue query: ${JSON.stringify(state.lastQuery)}.`)
  const filters = [
    category ? `category=${JSON.stringify(category)}` : null,
    color ? `color=${JSON.stringify(color)}` : null,
    size ? `size=${JSON.stringify(size)}` : null,
    ...attributes.map(([key, value]) => `attribute.${key}=${JSON.stringify(value)}`),
  ].filter(Boolean)
  if (filters.length > 0) lines.push(`Last explicit filters: ${filters.join(', ')}.`)
  if (state.shownProductKeys.length > 0) {
    lines.push(
      `${state.shownProductKeys.length} product(s) have already been shown in this conversation; browse-mode catalogue search excludes them server-side.`,
    )
  }
  lines.push(...compositionLines)
  lines.push(
    'Use this only to preserve continuity. For "more/other" keep relevant previous constraints and browse for unseen products; for questions about the selected/current product use lookup mode. Do not mention this internal state to the customer.',
  )
  return lines.join('\n')
}

function mapStateRow(data: Record<string, unknown>): ConversationCatalogState {
  return {
    lastQuery: typeof data.last_query === 'string' ? data.last_query : null,
    lastFilters: asObject(data.last_filters),
    shownProductKeys: asStringArray(data.shown_product_keys),
    shownMediaKeys: asStringArray(data.shown_media_keys),
    rejectedProductKeys: asStringArray(data.rejected_product_keys),
    selectedProductKey:
      typeof data.selected_product_key === 'string' ? data.selected_product_key : null,
    selectedProductName:
      typeof data.selected_product_name === 'string' ? data.selected_product_name : null,
    compositionTemplateId:
      typeof data.composition_template_id === 'string' ? data.composition_template_id : null,
    compositionState: asCompositionState(data.composition_state),
  }
}

export async function loadConversationCatalogState(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
}): Promise<ConversationCatalogState> {
  if (!args.conversationId) return emptyState()
  try {
    const current = await args.db
      .from('conversation_catalog_state')
      .select(
        'last_query, last_filters, shown_product_keys, shown_media_keys, rejected_product_keys, selected_product_key, selected_product_name, composition_template_id, composition_state',
      )
      .eq('account_id', args.accountId)
      .eq('conversation_id', args.conversationId)
      .maybeSingle()
    if (!current.error) return current.data ? mapStateRow(current.data as Record<string, unknown>) : emptyState()

    // Rolling-deploy compatibility while the composition migration is not yet
    // applied. Preserve the historical catalogue continuity instead of making
    // the whole state lookup fail because two new columns do not exist yet.
    const legacy = await args.db
      .from('conversation_catalog_state')
      .select(
        'last_query, last_filters, shown_product_keys, shown_media_keys, rejected_product_keys, selected_product_key, selected_product_name',
      )
      .eq('account_id', args.accountId)
      .eq('conversation_id', args.conversationId)
      .maybeSingle()
    if (legacy.error) {
      console.warn('[catalog state] load failed; continuing stateless:', legacy.error.message)
      return emptyState()
    }
    return legacy.data ? mapStateRow(legacy.data as Record<string, unknown>) : emptyState()
  } catch (error) {
    console.warn('[catalog state] load failed; continuing stateless:', error)
    return emptyState()
  }
}

async function upsertState(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  state: ConversationCatalogState
}): Promise<void> {
  if (!args.conversationId) return
  const base = {
    account_id: args.accountId,
    conversation_id: args.conversationId,
    last_query: args.state.lastQuery,
    last_filters: args.state.lastFilters,
    shown_product_keys: args.state.shownProductKeys,
    shown_media_keys: args.state.shownMediaKeys,
    rejected_product_keys: args.state.rejectedProductKeys,
    selected_product_key: args.state.selectedProductKey,
    selected_product_name: args.state.selectedProductName,
    updated_at: new Date().toISOString(),
  }
  try {
    const current = await args.db.from('conversation_catalog_state').upsert(
      {
        ...base,
        composition_template_id: args.state.compositionTemplateId,
        composition_state: args.state.compositionState,
      },
      { onConflict: 'account_id,conversation_id' },
    )
    if (!current.error) return

    // Same rolling-deploy fallback as the reader. A legacy runtime state write
    // remains useful even when the new composition columns are not available.
    const legacy = await args.db.from('conversation_catalog_state').upsert(
      base,
      { onConflict: 'account_id,conversation_id' },
    )
    if (legacy.error) console.warn('[catalog state] save failed:', legacy.error.message)
  } catch (error) {
    console.warn('[catalog state] save failed:', error)
  }
}

export async function rememberCatalogSearch(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  query: string
  filters: Record<string, unknown>
}): Promise<void> {
  const state = await loadConversationCatalogState(args)
  state.lastQuery = args.query
  state.lastFilters = args.filters
  await upsertState({ ...args, state })
}

export async function rememberProductsShown(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  productKeys: string[]
  mediaKeys: string[]
}): Promise<void> {
  if (!args.productKeys.length && !args.mediaKeys.length) return
  const state = await loadConversationCatalogState(args)
  state.shownProductKeys = mergeUnique(state.shownProductKeys, args.productKeys)
  state.shownMediaKeys = mergeUnique(state.shownMediaKeys, args.mediaKeys)
  await upsertState({ ...args, state })
}

export async function rememberSelectedProduct(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  productKey: string
  productName: string
}): Promise<void> {
  const state = await loadConversationCatalogState(args)
  state.selectedProductKey = args.productKey
  state.selectedProductName = args.productName
  await upsertState({ ...args, state })
}

export async function rememberComposition(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  templateId: string
  composition: PersistedCompositionState
}): Promise<void> {
  const state = await loadConversationCatalogState(args)
  state.compositionTemplateId = args.templateId
  state.compositionState = asCompositionState(args.composition)
  await upsertState({ ...args, state })
}
