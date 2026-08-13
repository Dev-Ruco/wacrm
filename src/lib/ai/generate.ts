import {
  AiError,
  type AgentToolDefinition,
  type AgentToolExecutor,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type CommercialStrategy,
  type GenerateResult,
} from './types'
import { HANDOFF_SENTINEL, aiRequestTimeoutMs } from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'
import { executorWithTenantPolicy, toolsAllowedForTurn } from './action-policy'

export interface GenerateArgs {
  config: Pick<AiConfig, 'provider' | 'model' | 'apiKey' | 'temperature'> & {
    commercialStrategy?: CommercialStrategy
  }
  systemPrompt: string
  messages: ChatMessage[]
  tools?: AgentToolDefinition[]
  executeTool?: AgentToolExecutor
}

function passiveInternalContext(value: string): string {
  const trimmed = value.trim()
  if (!trimmed.startsWith('Working conversation state')) return trimmed
  const stateLine = trimmed
    .split('\n')
    .find((line) => line.trim().startsWith('Current state:'))
  if (!stateLine) return ''
  return [
    'Working conversation state — server-maintained operational continuity for this live conversation, not long-term customer memory.',
    stateLine.trim(),
    'Use this only to preserve the active task across short or ambiguous follow-ups. The newest real customer message overrides stale values. Never invent a missing fact and never mention this internal state to the customer.',
  ].join('\n')
}

function serverInternalContext(messages: ChatMessage[]): string | null {
  const contexts = messages
    .map((message) =>
      (message as ChatMessage & { internalContext?: string }).internalContext?.trim(),
    )
    .filter((value): value is string => Boolean(value))
    .map(passiveInternalContext)
    .filter(Boolean)
  const unique = Array.from(new Set(contexts))
  if (unique.length === 0) return null
  return unique.map((value) => value.slice(0, 8_000)).join('\n\n')
}

/**
 * Generate the next reply from the account's configured provider.
 * Generic tenant policy is enforced at the runtime boundary. Internal context
 * attached by the conversation builder is promoted into the system prompt,
 * never emitted as a fake customer/business history message.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages, tools, executeTool } = args
  const timeoutMs = aiRequestTimeoutMs()
  const internalContext = serverInternalContext(messages)
  const effectiveSystemPrompt = internalContext
    ? `${systemPrompt}\n\n${internalContext}`
    : systemPrompt
  const effectiveTools = toolsAllowedForTurn({
    tools,
    messages,
    strategy: config.commercialStrategy,
  })
  const effectiveExecutor = executorWithTenantPolicy({
    executeTool,
    strategy: config.commercialStrategy,
  })
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: effectiveSystemPrompt,
    messages,
    timeoutMs,
    tools: effectiveTools,
    executeTool: effectiveExecutor,
    temperature: config.temperature,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
