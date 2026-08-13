import {
  AiError,
  chatContentText,
  type AiUsage,
  type ChatMessage,
  type ProviderResult,
} from '../types'
import { MAX_OUTPUT_TOKENS } from '../defaults'
import {
  emitProviderLifecycle,
  hasImageContent,
  mergeConsecutive,
  normalizeUsage,
  providerHttpError,
  toNetworkError,
  withoutImageContent,
  type ProviderArgs,
} from './shared'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOOL_ROUNDS = 4

interface AnthropicResponse {
  content?: AnthropicResponseBlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
}

type AnthropicTextBlock = { type: 'text'; text: string }
type AnthropicImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string }
}
type AnthropicToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
type AnthropicToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}
type AnthropicResponseBlock = AnthropicTextBlock | AnthropicToolUseBlock
type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

function dataUrlSource(url: string): { type: 'base64'; media_type: string; data: string } | null {
  const match = url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null
  return { type: 'base64', media_type: match[1], data: match[2] }
}

function toAnthropicMessage(message: ChatMessage): AnthropicMessage {
  if (typeof message.content === 'string') {
    return { role: message.role, content: message.content }
  }
  if (message.role === 'assistant') {
    return { role: 'assistant', content: chatContentText(message.content) }
  }

  const blocks: AnthropicContentBlock[] = []
  for (const part of message.content) {
    if (part.type === 'text') {
      blocks.push({ type: 'text', text: part.text })
      continue
    }
    const base64 = dataUrlSource(part.url)
    blocks.push({
      type: 'image',
      source: base64 ?? { type: 'url', url: part.url },
    })
  }
  return { role: 'user', content: blocks }
}

function normalizeForAnthropic(messages: ChatMessage[]): ChatMessage[] {
  const merged = mergeConsecutive(messages)
  while (merged.length > 0 && merged[0].role === 'assistant') merged.shift()
  if (merged.length === 0) {
    return [{ role: 'user', content: '(The customer has not sent a message yet.)' }]
  }
  return merged
}

function addUsage(total: AiUsage | null, next: AiUsage | null): AiUsage | null {
  if (!total) return next
  if (!next) return total
  return {
    promptTokens: total.promptTokens + next.promptTokens,
    completionTokens: total.completionTokens + next.completionTokens,
    totalTokens: total.totalTokens + next.totalTokens,
  }
}

export async function generateAnthropic(args: ProviderArgs): Promise<ProviderResult> {
  const {
    apiKey,
    model,
    systemPrompt,
    messages,
    timeoutMs,
    tools = [],
    executeTool,
    temperature,
    onLifecycleEvent,
  } = args
  const anthropicTemperature =
    typeof temperature === 'number' ? Math.min(1, Math.max(0, temperature)) : undefined

  if (tools.length > 0 && !executeTool) {
    throw new AiError('AI tools were configured without a server executor.', {
      code: 'invalid_tool_configuration',
      status: 500,
    })
  }

  const normalized = normalizeForAnthropic(messages)
  let providerMessages = normalized.map(toAnthropicMessage)
  const request = (requestMessages: AnthropicMessage[]) =>
    fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: requestMessages,
        ...(anthropicTemperature !== undefined ? { temperature: anthropicTemperature } : {}),
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
              })),
            }
          : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })

  let accumulatedUsage: AiUsage | null = null

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const roundNumber = round + 1
    const roundStartedAt = Date.now()
    emitProviderLifecycle(onLifecycleEvent, {
      type: 'round_started',
      round: roundNumber,
      provider: 'anthropic',
      model,
    })

    let res: Response
    try {
      res = await request(providerMessages)
      if (round === 0 && res.status === 400 && hasImageContent(normalized)) {
        providerMessages = withoutImageContent(normalized).map(toAnthropicMessage)
        res = await request(providerMessages)
      }
    } catch (err) {
      const failure = toNetworkError(err)
      emitProviderLifecycle(onLifecycleEvent, {
        type: 'round_failed',
        round: roundNumber,
        provider: 'anthropic',
        model,
        durationMs: Math.max(0, Date.now() - roundStartedAt),
        errorCode: failure.code,
      })
      throw failure
    }

    if (!res.ok) {
      const failure = await providerHttpError('Anthropic', res)
      emitProviderLifecycle(onLifecycleEvent, {
        type: 'round_failed',
        round: roundNumber,
        provider: 'anthropic',
        model,
        durationMs: Math.max(0, Date.now() - roundStartedAt),
        errorCode: failure.code,
      })
      throw failure
    }

    const data = (await res.json().catch(() => null)) as AnthropicResponse | null
    const roundUsage = normalizeUsage({
      prompt: data?.usage?.input_tokens,
      completion: data?.usage?.output_tokens,
    })
    accumulatedUsage = addUsage(accumulatedUsage, roundUsage)

    const content = data?.content ?? []
    const toolUses = content.filter(
      (block): block is AnthropicToolUseBlock => block.type === 'tool_use',
    )

    emitProviderLifecycle(onLifecycleEvent, {
      type: 'round_finished',
      round: roundNumber,
      provider: 'anthropic',
      model,
      durationMs: Math.max(0, Date.now() - roundStartedAt),
      usage: roundUsage,
      toolCallCount: toolUses.length,
    })

    if (toolUses.length === 0) {
      const text = content
        .filter((block): block is AnthropicTextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim()
      if (!text) {
        throw new AiError('Anthropic returned an empty response.', {
          code: 'empty_response',
        })
      }
      return { text, usage: accumulatedUsage }
    }

    if (round === MAX_TOOL_ROUNDS) {
      throw new AiError('The AI exceeded the maximum number of tool steps.', {
        code: 'tool_round_limit',
      })
    }

    providerMessages.push({ role: 'assistant', content })
    const results: AnthropicToolResultBlock[] = []
    for (const toolUse of toolUses) {
      try {
        const result = await executeTool!({
          id: toolUse.id,
          name: toolUse.name,
          arguments: JSON.stringify(toolUse.input ?? {}),
        })
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        })
      } catch (error) {
        results.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: error instanceof Error ? error.message : String(error),
          is_error: true,
        })
      }
    }
    providerMessages.push({ role: 'user', content: results })
  }

  throw new AiError('The AI tool loop ended unexpectedly.', {
    code: 'tool_loop_failed',
  })
}
