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

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const MAX_TOOL_ROUNDS = 4

type OpenAiUserContent = Array<
  | { type: 'text'; text: string }
  | {
      type: 'image_url'
      image_url: { url: string; detail: 'auto' }
    }
>

type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAiUserContent }
  | {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAiToolCall[]
    }
  | { role: 'tool'; tool_call_id: string; content: string }

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiResponse {
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: OpenAiToolCall[]
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
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

function toOpenAiMessage(message: ChatMessage): OpenAiMessage {
  if (message.role === 'assistant') {
    return { role: 'assistant', content: chatContentText(message.content) }
  }
  if (typeof message.content === 'string') {
    return { role: 'user', content: message.content }
  }
  return {
    role: 'user',
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text' as const, text: part.text }
        : {
            type: 'image_url' as const,
            image_url: { url: part.url, detail: 'auto' as const },
          },
    ),
  }
}

export async function generateOpenAi(args: ProviderArgs): Promise<ProviderResult> {
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

  if (tools.length > 0 && !executeTool) {
    throw new AiError('AI tools were configured without a server executor.', {
      code: 'invalid_tool_configuration',
      status: 500,
    })
  }

  const mergedMessages = mergeConsecutive(messages)
  let transcript: OpenAiMessage[] = [
    { role: 'system', content: systemPrompt },
    ...mergedMessages.map(toOpenAiMessage),
  ]
  const request = (requestMessages: OpenAiMessage[]) =>
    fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: requestMessages,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        ...(typeof temperature === 'number' ? { temperature } : {}),
        ...(tools.length > 0
          ? {
              tools: tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              tool_choice: 'auto',
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
      provider: 'openai',
      model,
    })

    let res: Response
    try {
      res = await request(transcript)
      if (round === 0 && res.status === 400 && hasImageContent(mergedMessages)) {
        transcript = [
          { role: 'system', content: systemPrompt },
          ...withoutImageContent(mergedMessages).map(toOpenAiMessage),
        ]
        res = await request(transcript)
      }
    } catch (err) {
      const failure = toNetworkError(err)
      emitProviderLifecycle(onLifecycleEvent, {
        type: 'round_failed',
        round: roundNumber,
        provider: 'openai',
        model,
        durationMs: Math.max(0, Date.now() - roundStartedAt),
        errorCode: failure.code,
      })
      throw failure
    }

    if (!res.ok) {
      const failure = await providerHttpError('OpenAI', res)
      emitProviderLifecycle(onLifecycleEvent, {
        type: 'round_failed',
        round: roundNumber,
        provider: 'openai',
        model,
        durationMs: Math.max(0, Date.now() - roundStartedAt),
        errorCode: failure.code,
      })
      throw failure
    }

    const data = (await res.json().catch(() => null)) as OpenAiResponse | null
    const roundUsage = normalizeUsage({
      prompt: data?.usage?.prompt_tokens,
      completion: data?.usage?.completion_tokens,
      total: data?.usage?.total_tokens,
    })
    accumulatedUsage = addUsage(accumulatedUsage, roundUsage)

    const message = data?.choices?.[0]?.message
    if (!message) {
      const failure = new AiError('OpenAI returned an empty response.', {
        code: 'empty_response',
      })
      emitProviderLifecycle(onLifecycleEvent, {
        type: 'round_failed',
        round: roundNumber,
        provider: 'openai',
        model,
        durationMs: Math.max(0, Date.now() - roundStartedAt),
        errorCode: failure.code,
      })
      throw failure
    }

    const toolCalls = message.tool_calls ?? []
    emitProviderLifecycle(onLifecycleEvent, {
      type: 'round_finished',
      round: roundNumber,
      provider: 'openai',
      model,
      durationMs: Math.max(0, Date.now() - roundStartedAt),
      usage: roundUsage,
      toolCallCount: toolCalls.length,
    })

    if (toolCalls.length === 0) {
      const text = message.content
      if (!text || typeof text !== 'string' || !text.trim()) {
        throw new AiError('OpenAI returned an empty response.', {
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

    transcript.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: toolCalls,
    })

    for (const call of toolCalls) {
      let result: string
      try {
        result = await executeTool!({
          id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        result = JSON.stringify({ ok: false, error: detail })
      }
      transcript.push({ role: 'tool', tool_call_id: call.id, content: result })
    }
  }

  throw new AiError('The AI tool loop ended unexpectedly.', {
    code: 'tool_loop_failed',
  })
}
