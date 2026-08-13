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
  // Credentials remain the only required config fields. commercialStrategy
  // is optional because nested model calls (e.g. vision helpers) do not need
  // tenant conversation policy; full auto-reply/draft calls pass it naturally.
  config: Pick<AiConfig, 'provider' | 'model' | 'apiKey' | 'temperature'> & {
    commercialStrategy?: CommercialStrategy
  }
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
  /** Optional, server-controlled tools available to the assistant. */
  tools?: AgentToolDefinition[]
  /** Validated executor bound to the current account/conversation context. */
  executeTool?: AgentToolExecutor
}

function serverInternalContext(messages: ChatMessage[]): string | null {
  const contexts = messages
    .map((message) =>
      (message as ChatMessage & { internalContext?: string }).internalContext?.trim(),
    )
    .filter((value): value is string => Boolean(value))
  const unique = Array.from(new Set(contexts))
  if (unique.length === 0) return null
  return unique.map((value) => value.slice(0, 8_000)).join('\n\n')
}

/**
 * Generate the next reply from the account's configured provider.
 * Before the provider sees or executes tools, generic tenant policy is applied
 * at the runtime boundary. Server-maintained internal context attached by the
 * conversation builder is promoted into the system prompt and never sent as
 * a fake customer/business history message.
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
