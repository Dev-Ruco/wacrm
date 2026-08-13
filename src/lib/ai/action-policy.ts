import type {
  AgentToolDefinition,
  AgentToolExecutor,
  ChatMessage,
  CommercialStrategy,
} from './types'
import { chatContentText } from './types'

/**
 * Runtime action classes are platform semantics, not tenant vocabulary.
 * They describe the side-effect level of a tool and can be reused by any
 * business capability without teaching the core what that business sells.
 */
export type AgentActionClass = 'read' | 'present' | 'write' | 'escalate'

export const TOOL_ACTION_CLASS: Readonly<Record<string, AgentActionClass>> = {
  search_catalog: 'read',
  search_knowledge: 'read',
  get_style_opinion: 'read',
  send_product: 'present',
  add_tag: 'write',
  create_deal: 'write',
  schedule_visit: 'write',
  handoff_human: 'escalate',
}

// Cross-business presentation language only. No product/category vocabulary:
// the shared runtime asks whether the customer explicitly wants to SEE/SEND
// media, not what a particular tenant sells.
const EXPLICIT_PRESENTATION_RE =
  /\b(foto(?:s|grafia|grafias)?|imagem|imagens|visual|ver|vejo|mostra(?:r|-me|-nos)?|mostrar|manda(?:r)?|envia(?:r)?|photo(?:s)?|picture(?:s)?|image(?:s)?|show|see|send|muestra(?:me)?|mostrar|verlo|verla|imagen(?:es)?)\b/i

const SHORT_AFFIRMATION_RE =
  /^\s*(sim|claro|pode|podes|ok|okay|yes|sure|please|por favor|si|sí|vale)\s*[.!?]*\s*$/i

function latestUserIndex(messages: ChatMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

export function customerExplicitlyRequestedPresentation(
  messages: ChatMessage[],
): boolean {
  const index = latestUserIndex(messages)
  if (index < 0) return false
  const latest = chatContentText(messages[index].content).trim()
  if (EXPLICIT_PRESENTATION_RE.test(latest)) return true

  if (!SHORT_AFFIRMATION_RE.test(latest)) return false
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const message = messages[previous]
    if (message.role !== 'assistant') continue
    return EXPLICIT_PRESENTATION_RE.test(chatContentText(message.content))
  }
  return false
}

function cataloguePolicyDescription(strategy: CommercialStrategy): string {
  const recommendation = strategy.autoRecommend
    ? 'You may recommend when the customer has given enough need or preference to make a useful recommendation; do not turn greetings, vague rejections or unrelated remarks into unsolicited catalogue pushes.'
    : 'Do not proactively recommend catalogue items unless the customer explicitly asks for suggestions or states a sufficiently specific item need.'
  const stock = strategy.checkStock
    ? 'Before confirming availability or encouraging a purchase, rely on current stock returned by the catalogue.'
    : 'Never make a stock claim unless trusted result data already supports it.'
  const continuity = strategy.keepSelectedProduct
    ? 'Keep a clearly selected item as the active referent until the customer rejects it, selects another item or changes topic.'
    : 'Do not assume a previously selected item remains active after ambiguity or a topic change.'

  return `Account policy: present at most ${strategy.maxProducts} option(s) in one turn. ${recommendation} ${stock} ${continuity}`
}

function withTenantPolicy(
  tool: AgentToolDefinition,
  strategy: CommercialStrategy,
): AgentToolDefinition {
  if (tool.name !== 'search_catalog' && tool.name !== 'send_product') return tool
  return {
    ...tool,
    description: `${tool.description} ${cataloguePolicyDescription(strategy)}`,
  }
}

/**
 * Enforce presentation policy before the model sees its tool list. Text-first
 * tenants retain search/read capabilities but do not see send_product until
 * the customer explicitly asks for a visual presentation. Definitions are
 * also decorated with that tenant's catalogue policy, so account settings
 * travel with the capability instead of leaking into non-catalogue tenants.
 */
export function toolsAllowedForTurn(args: {
  tools?: AgentToolDefinition[]
  messages: ChatMessage[]
  strategy?: CommercialStrategy
}): AgentToolDefinition[] | undefined {
  const { tools, messages, strategy } = args
  if (!tools || tools.length === 0 || !strategy) return tools

  const decorated = tools.map((tool) => withTenantPolicy(tool, strategy))
  if (strategy.preferVisual) return decorated
  if (customerExplicitlyRequestedPresentation(messages)) return decorated
  return decorated.filter((tool) => tool.name !== 'send_product')
}

/**
 * Hard boundary for PRESENT actions. The model gets guidance in the tool
 * schema, but the server also enforces maxProducts so a tenant setting is not
 * merely a prompt suggestion. This wrapper is provider-agnostic and leaves
 * every non-presentation tool untouched.
 */
export function executorWithTenantPolicy(args: {
  executeTool?: AgentToolExecutor
  strategy?: CommercialStrategy
}): AgentToolExecutor | undefined {
  const { executeTool, strategy } = args
  if (!executeTool || !strategy) return executeTool

  let presentations = 0
  return async (call) => {
    if (call.name === 'send_product') {
      if (presentations >= strategy.maxProducts) {
        return JSON.stringify({
          ok: false,
          policy_blocked: true,
          reason: `This account allows at most ${strategy.maxProducts} presented option(s) per turn.`,
          instruction: 'Do not queue another product in this turn. Continue naturally with the options already presented.',
        })
      }
      presentations += 1
    }
    return executeTool(call)
  }
}
