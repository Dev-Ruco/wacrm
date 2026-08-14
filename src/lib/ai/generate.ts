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
import { getAgentTraceContext } from './trace-context'
import type { AgentTraceStepHandle } from './trace'
import type { ProviderLifecycleEvent } from './providers/shared'

export interface GenerateArgs {
  config: Pick<AiConfig, 'provider' | 'model' | 'apiKey' | 'temperature'> & {
    commercialStrategy?: CommercialStrategy
  }
  systemPrompt: string
  messages: ChatMessage[]
  tools?: AgentToolDefinition[]
  executeTool?: AgentToolExecutor
  observabilityLabel?: string
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

export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const {
    config,
    systemPrompt,
    messages,
    tools,
    executeTool,
    observabilityLabel = 'LLM',
  } = args
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

  const trace = getAgentTraceContext()
  trace?.setRuntime(config.provider, config.model)
  const roundSteps = new Map<number, AgentTraceStepHandle>()
  const onLifecycleEvent = trace
    ? (event: ProviderLifecycleEvent) => {
        if (event.type === 'round_started') {
          const handle = trace.startStep(
            'llm_round',
            `${observabilityLabel} · Round ${event.round}`,
            {
              provider: event.provider,
              model: event.model,
              round: event.round,
            },
          )
          roundSteps.set(event.round, handle)
          return
        }

        const handle = roundSteps.get(event.round)
        if (!handle) return
        roundSteps.delete(event.round)
        if (event.type === 'round_finished') {
          trace.finishStep(handle, 'completed', {
            provider: event.provider,
            model: event.model,
            round: event.round,
            duration_ms: event.durationMs,
            tool_call_count: event.toolCallCount,
            usage: event.usage
              ? {
                  prompt_tokens: event.usage.promptTokens,
                  completion_tokens: event.usage.completionTokens,
                  total_tokens: event.usage.totalTokens,
                }
              : null,
          })
        } else {
          trace.finishStep(handle, 'failed', {
            provider: event.provider,
            model: event.model,
            round: event.round,
            duration_ms: event.durationMs,
            error_code: event.errorCode,
          })
        }
      }
    : undefined

  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt: effectiveSystemPrompt,
    messages,
    timeoutMs,
    tools: effectiveTools,
    executeTool: effectiveExecutor,
    temperature: config.temperature,
    onLifecycleEvent,
  }

  try {
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
  } catch (error) {
    trace?.recordEvent(
      'llm_generation_failed',
      `${observabilityLabel} falhou`,
      {
        provider: config.provider,
        model: config.model,
        error_code: error instanceof AiError ? error.code : 'generation_failed',
      },
      'failed',
    )
    throw error
  }
}

export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoff = raw.includes(HANDOFF_SENTINEL)
  const text = raw.split(HANDOFF_SENTINEL).join('').trim()
  return { text, handoff, usage }
}
