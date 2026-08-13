import type { AgentInitiativeMode, CommercialStrategy } from './types'

export const DEFAULT_COMMERCIAL_STRATEGY: CommercialStrategy = {
  maxProducts: 3,
  // New accounts start text-first. Existing accounts that already persisted
  // prefer_visual keep their own value through normalizeCommercialStrategy.
  preferVisual: false,
  autoRecommend: true,
  checkStock: true,
  keepSelectedProduct: true,
  qualificationOrder: 'size_then_color',
  initiativeMode: 'conversation_first',
}

export function normalizeCommercialStrategy(
  value: unknown,
): CommercialStrategy {
  const raw = value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {}

  const maxProductsRaw = Number(raw.max_products ?? raw.maxProducts)
  const maxProducts = Number.isFinite(maxProductsRaw)
    ? Math.min(10, Math.max(1, Math.floor(maxProductsRaw)))
    : DEFAULT_COMMERCIAL_STRATEGY.maxProducts

  const bool = (snake: string, camel: string, fallback: boolean) => {
    const candidate = raw[snake] ?? raw[camel]
    return typeof candidate === 'boolean' ? candidate : fallback
  }

  const orderRaw = raw.qualification_order ?? raw.qualificationOrder
  const qualificationOrder = orderRaw === 'color_then_size'
    ? 'color_then_size'
    : 'size_then_color'

  const initiativeRaw = raw.initiative_mode ?? raw.initiativeMode
  const initiativeMode: AgentInitiativeMode =
    initiativeRaw === 'balanced' || initiativeRaw === 'action_first'
      ? initiativeRaw
      : 'conversation_first'

  return {
    maxProducts,
    preferVisual: bool(
      'prefer_visual',
      'preferVisual',
      DEFAULT_COMMERCIAL_STRATEGY.preferVisual,
    ),
    autoRecommend: bool('auto_recommend', 'autoRecommend', true),
    checkStock: bool('check_stock', 'checkStock', true),
    keepSelectedProduct: bool(
      'keep_selected_product',
      'keepSelectedProduct',
      true,
    ),
    qualificationOrder,
    initiativeMode,
  }
}

export function serializeCommercialStrategy(
  strategy: CommercialStrategy,
): Record<string, unknown> {
  return {
    max_products: strategy.maxProducts,
    prefer_visual: strategy.preferVisual,
    auto_recommend: strategy.autoRecommend,
    check_stock: strategy.checkStock,
    keep_selected_product: strategy.keepSelectedProduct,
    qualification_order: strategy.qualificationOrder,
    initiative_mode: strategy.initiativeMode,
  }
}

function initiativeRule(mode: AgentInitiativeMode): string {
  if (mode === 'action_first') {
    return (
      'Initiative mode is action-first: when the customer has expressed a sufficiently clear goal and a tool can materially advance it, act without unnecessary permission-seeking. ' +
      'This still does not justify guessing missing facts, ignoring a correction, or using a tool on greetings and acknowledgements.'
    )
  }
  if (mode === 'balanced') {
    return (
      'Initiative mode is balanced: act when the customer goal is clear; when a correction, rejection, topic change or vague request leaves the next goal underspecified, acknowledge it and ask one short clarifying question before using a tool.'
    )
  }
  return (
    'Initiative mode is conversation-first: understand the conversational move before acting. A greeting, acknowledgement, correction, rejection, change of mind, vague continuation or topic change is not itself a reason to use a tool. ' +
    'If the customer rejects the previous option or says they want something else but has not yet said what the replacement should be, acknowledge the change and ask one short useful question. ' +
    'Use a tool only when its result is necessary to answer a sufficiently defined request or execute a clear customer intention. This account-level rule refines generic tool-use guidance: not using a tool is correct when the turn is primarily conversational or clarifying.'
  )
}

/**
 * SaaS-wide conversational policy. Safe to inject for every tenant because it
 * contains no catalogue, product, fashion, vehicle, clinic or other domain
 * assumptions. Each account controls the mode through commercial_strategy.
 */
export function conversationPolicyPrompt(strategy: CommercialStrategy): string {
  return [
    'Conversation initiative policy — account-level behaviour for this tenant:',
    `- ${initiativeRule(strategy.initiativeMode)}`,
    '- Treat corrections, negative preferences and changes of mind as first-class information. Do not immediately repeat what the customer just rejected, and do not silently keep an old constraint after the customer withdraws it.',
    '- Prefer one useful question over a checklist when clarification is genuinely needed. If the current message can be answered naturally without a tool, do that.',
  ].join('\n')
}

/**
 * Catalogue-specific policy. Today loadAiConfig still injects this block for
 * backwards compatibility with existing accounts. The generic initiative
 * policy is prepended here so the new behaviour applies immediately; a later
 * capability-scoping cleanup can move the catalogue-only lines behind the
 * existing catalogue capability check without changing tenant data.
 */
export function commercialStrategyPrompt(
  strategy: CommercialStrategy,
): string {
  const qualification = strategy.qualificationOrder === 'color_then_size'
    ? 'colour first, then size'
    : 'size first, then colour'

  const rules = [
    `Present at most ${strategy.maxProducts} product options at a time unless the customer explicitly asks for more.`,
    strategy.preferVisual
      ? 'Automatic media presentation is enabled for this account: once you have deliberately chosen relevant catalogue products, you may use send_product without waiting for the customer to ask for a photograph.'
      : 'Automatic media presentation is disabled for this account: keep product discovery text-first. Do not send product photographs unless the customer explicitly asks to see, show, send or receive an image/photo, including a short affirmative answer to your immediately preceding offer to show one. The runtime also enforces this policy by withholding presentation tools when the request is not visual.',
    strategy.autoRecommend
      ? 'Recommendations are enabled, but only recommend when the customer has expressed enough need or preference to make a useful recommendation. Do not turn greetings, vague changes of mind or unrelated remarks into unsolicited product pushes.'
      : 'Do not proactively recommend products unless the customer explicitly asks for suggestions or names a product need that requires catalogue results.',
    strategy.checkStock
      ? 'Before confirming availability or encouraging a purchase, verify current stock with the available catalogue tools.'
      : 'Do not make stock claims unless stock information is already present in trusted context or tool results.',
    strategy.keepSelectedProduct
      ? 'Once the customer selects or clearly refers to a product, keep that product as the active product context until the customer changes it. A clear rejection or change of subject ends that assumption immediately.'
      : 'Do not assume a previously selected product remains active when the customer changes topic or the reference becomes ambiguous.',
    `When product qualification requires both attributes and they are not already known, ask about ${qualification}. Ask only one useful follow-up question at a time.`,
  ]

  return [
    conversationPolicyPrompt(strategy),
    `Catalogue strategy — account-level rules for this tenant:\n${rules
      .map((rule) => `- ${rule}`)
      .join('\n')}`,
  ].join('\n\n')
}
