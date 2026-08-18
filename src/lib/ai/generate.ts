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
import { catalogueCommercialStrategyPrompt } from './commercial-strategy'
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

const CATALOGUE_STRATEGY_MARKER =
  'Catalogue strategy — account-level rules for this tenant:'

interface OperationalClaimRequirement {
  claim: string
  tools: string[]
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

function hasCatalogueTools(tools: AgentToolDefinition[] | undefined): boolean {
  return Boolean(
    tools?.some((tool) =>
      tool.name === 'search_catalog' ||
      tool.name === 'send_product' ||
      tool.name === 'compose_solution',
    ),
  )
}

function toolExecutionSucceeded(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return true
    const record = parsed as Record<string, unknown>
    if (record.ok === false) return false
    if (record.created === false || record.scheduled === false) return false
    return true
  } catch {
    // Existing tools sometimes return human-readable success text. A thrown
    // executor error remains the authoritative failure signal in that case.
    return true
  }
}

function hasPositiveReservationClaim(text: string): boolean {
  if (/\bn[aã]o\s+(?:ficou|foi|est[aá])\s+reservad[oa]\b/i.test(text)) return false
  return /\b(?:j[aá]\s+)?(?:ficou|foi|est[aá])\s+reservad[oa]\b|\breserva\s+(?:foi|ficou|est[aá])\s+(?:feita|confirmada|registada|registrada)\b/i.test(
    text,
  )
}

function hasPositiveScheduleClaim(text: string): boolean {
  if (/\bn[aã]o\s+(?:ficou|foi|est[aá])\s+agendad[oa]\b/i.test(text)) return false
  return /\b(?:j[aá]\s+)?(?:ficou|foi|est[aá])\s+agendad[oa]\b|\bagendamento\s+(?:foi|ficou|est[aá])\s+(?:feito|confirmado|registado|registrado)\b/i.test(
    text,
  )
}

function operationalClaimRequirements(text: string): OperationalClaimRequirement[] {
  const requirements: OperationalClaimRequirement[] = []
  if (hasPositiveReservationClaim(text)) {
    requirements.push({
      claim: 'reservation completed',
      tools: ['create_order', 'schedule_visit'],
    })
  }
  if (hasPositiveScheduleClaim(text)) {
    requirements.push({ claim: 'visit scheduled', tools: ['schedule_visit'] })
  }
  if (
    !/\bpedido\s+n[aã]o\s+(?:foi|ficou|est[aá])\s+(?:criado|registado|registrado|confirmado)\b/i.test(text) &&
    /\bpedido\s+(?:foi|ficou|est[aá])\s+(?:criado|registado|registrado|confirmado)\b/i.test(text)
  ) {
    requirements.push({ claim: 'order created', tools: ['create_order'] })
  }
  if (
    /\b(?:dados|contacto|contato|perfil)\s+(?:foram|foi|ficou|est[aá])\s+(?:actualizad[oa]s?|atualizad[oa]s?|guardad[oa]s?|salv[oa]s?)\b/i.test(text)
  ) {
    requirements.push({ claim: 'contact updated', tools: ['update_contact'] })
  }
  if (
    /\b(?:neg[oó]cio|oportunidade|deal)\s+(?:foi|ficou|est[aá])\s+(?:criad[oa]|registad[oa]|registrad[oa])\b/i.test(text)
  ) {
    requirements.push({ claim: 'deal created', tools: ['create_deal'] })
  }
  return requirements
}

export function unsupportedOperationalClaims(
  text: string,
  successfulTools: ReadonlySet<string>,
): OperationalClaimRequirement[] {
  return operationalClaimRequirements(text).filter(
    (requirement) =>
      !requirement.tools.some((toolName) => successfulTools.has(toolName)),
  )
}

function mergeUsage(first: AiUsage | null, second: AiUsage | null): AiUsage | null {
  if (!first) return second
  if (!second) return first
  return {
    promptTokens: first.promptTokens + second.promptTokens,
    completionTokens: first.completionTokens + second.completionTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  }
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
  const effectiveTools = toolsAllowedForTurn({
    tools,
    messages,
    strategy: config.commercialStrategy,
  })
  const internalContext = serverInternalContext(messages)
  const catalogueStrategy =
    config.commercialStrategy &&
    hasCatalogueTools(effectiveTools) &&
    !systemPrompt.includes(CATALOGUE_STRATEGY_MARKER)
      ? catalogueCommercialStrategyPrompt(config.commercialStrategy)
      : null
  const effectiveSystemPrompt = [systemPrompt, catalogueStrategy, internalContext]
    .filter((part): part is string => Boolean(part))
    .join('\n\n')
  const tenantExecutor = executorWithTenantPolicy({
    executeTool,
    strategy: config.commercialStrategy,
  })
  const successfulTools = new Set<string>()
  const effectiveExecutor: AgentToolExecutor | undefined = tenantExecutor
    ? async (call) => {
        const result = await tenantExecutor(call)
        if (toolExecutionSucceeded(result)) successfulTools.add(call.name)
        return result
      }
    : undefined

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

  const callProvider = async (prompt: string) => {
    const currentArgs = { ...providerArgs, systemPrompt: prompt }
    switch (config.provider) {
      case 'openai':
        return generateOpenAi(currentArgs)
      case 'anthropic':
        return generateAnthropic(currentArgs)
      default:
        throw new AiError(`Unsupported AI provider: ${config.provider}`, {
          code: 'unsupported_provider',
          status: 400,
        })
    }
  }

  try {
    const first = await callProvider(effectiveSystemPrompt)
    let parsed = parseGeneration(first.text, first.usage)
    let unsupported = parsed.handoff
      ? []
      : unsupportedOperationalClaims(parsed.text, successfulTools)

    if (unsupported.length > 0) {
      trace?.recordEvent(
        'operational_claim_repair',
        'Afirmação operacional sem confirmação foi enviada para autocorrecção',
        {
          claims: unsupported.map((item) => item.claim),
          successful_tools: Array.from(successfulTools),
        },
      )
      const repairPrompt = [
        effectiveSystemPrompt,
        'Operational grounding correction: a previous draft in this SAME turn claimed that an operational action was completed without a successful confirming tool call. Do not repeat that unsupported completion claim. If the corresponding enabled tool is available and the customer has supplied all facts required to act safely, use the tool now. Otherwise say naturally that the action is not yet confirmed/completed and ask only for the next genuinely required detail. Never imply that a reservation, order, schedule, CRM update or deal exists merely because the customer requested it.',
        `Unsupported claims to correct: ${unsupported.map((item) => item.claim).join(', ')}.`,
      ].join('\n\n')
      const repaired = await callProvider(repairPrompt)
      parsed = parseGeneration(repaired.text, mergeUsage(first.usage, repaired.usage))
      unsupported = parsed.handoff
        ? []
        : unsupportedOperationalClaims(parsed.text, successfulTools)
      if (unsupported.length > 0) {
        throw new AiError(
          'The model repeated an operational completion claim without tool confirmation.',
          { code: 'ungrounded_operational_claim', status: 502 },
        )
      }
    }

    return parsed
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
