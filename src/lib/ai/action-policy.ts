import type { AgentToolDefinition, ChatMessage, CommercialStrategy } from './types'
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

// Cross-business, cross-language presentation verbs only. There is no
// product/category vocabulary here: the policy asks whether the customer is
// explicitly asking to SEE/SEND media, not what the business sells.
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

/**
 * True only when this turn explicitly asks to see/send something, or when a
 * short affirmation directly answers the assistant's immediately preceding
 * offer to show/send media. This is deliberately business-agnostic.
 */
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

/**
 * Enforce the account's media policy at the provider boundary. A tenant with
 * automatic visual presentation disabled still gets search_catalog and all
 * other tools; only send_product is hidden until the customer asks to see or
 * receive media. This turns the setting into a real runtime rule instead of
 * a prompt suggestion while keeping the shared Agent Runtime generic.
 */
export function toolsAllowedForTurn(args: {
  tools?: AgentToolDefinition[]
  messages: ChatMessage[]
  strategy?: CommercialStrategy
}): AgentToolDefinition[] | undefined {
  const { tools, messages, strategy } = args
  if (!tools || tools.length === 0 || !strategy) return tools
  if (strategy.preferVisual) return tools
  if (customerExplicitlyRequestedPresentation(messages)) return tools
  return tools.filter((tool) => tool.name !== 'send_product')
}
