import type {
  AgentToolDefinition,
  AgentToolExecutor,
  ChatMessage,
  CommercialStrategy,
} from './types'
import { chatContentText } from './types'
import {
  TOOL_ACTION_CLASS,
  type AgentActionClass,
} from './tool-action-class'
import { getAgentTraceContext } from './trace-context'
import {
  toolTraceFinishedMetadata,
  toolTraceStartedMetadata,
} from './trace-sanitize'

export { TOOL_ACTION_CLASS }
export type { AgentActionClass }

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
 * Runtime action policy plus provider-agnostic tool observability. Tool
 * metadata is privacy-reduced before it reaches the trace store. A trace
 * failure cannot affect execution because the collector itself is best-effort.
 */
export function executorWithTenantPolicy(args: {
  executeTool?: AgentToolExecutor
  strategy?: CommercialStrategy
}): AgentToolExecutor | undefined {
  const { executeTool, strategy } = args
  if (!executeTool || !strategy) return executeTool

  let presentations = 0
  return async (call) => {
    const trace = getAgentTraceContext()
    const step = trace?.startStep(
      'tool_called',
      call.name,
      toolTraceStartedMetadata(call.name, call.arguments),
    )

    try {
      if (call.name === 'send_product') {
        if (presentations >= strategy.maxProducts) {
          const blocked = JSON.stringify({
            ok: false,
            policy_blocked: true,
            reason: `This account allows at most ${strategy.maxProducts} presented option(s) per turn.`,
            instruction: 'Do not queue another product in this turn. Continue naturally with the options already presented.',
          })
          if (step) {
            trace?.finishStep(
              step,
              'blocked',
              toolTraceFinishedMetadata({
                name: call.name,
                rawArguments: call.arguments,
                rawResult: blocked,
              }),
            )
          }
          return blocked
        }
        presentations += 1
      }

      const result = await executeTool(call)
      if (step) {
        trace?.finishStep(
          step,
          'completed',
          toolTraceFinishedMetadata({
            name: call.name,
            rawArguments: call.arguments,
            rawResult: result,
          }),
        )
      }
      return result
    } catch (error) {
      if (step) {
        trace?.finishStep(
          step,
          'failed',
          toolTraceFinishedMetadata({
            name: call.name,
            rawArguments: call.arguments,
            error,
          }),
        )
      }
      throw error
    }
  }
}
