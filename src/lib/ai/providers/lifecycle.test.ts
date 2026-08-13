import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateOpenAi } from './openai'
import { generateAnthropic } from './anthropic'
import type { ProviderLifecycleEvent } from './shared'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('provider lifecycle observability', () => {
  it('reports real OpenAI rounds around a tool call', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        choices: [{ message: { content: 'Resposta final.' } }],
        usage: { prompt_tokens: 14, completion_tokens: 3, total_tokens: 17 },
      }))
    globalThis.fetch = fetchMock as typeof fetch
    const events: ProviderLifecycleEvent[] = []

    const result = await generateOpenAi({
      apiKey: 'test', model: 'test-model', systemPrompt: 'system',
      messages: [{ role: 'user', content: 'Olá' }], timeoutMs: 1_000,
      tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } }],
      executeTool: async () => JSON.stringify({ ok: true }),
      onLifecycleEvent: (event) => events.push(event),
    })

    expect(result.text).toBe('Resposta final.')
    expect(events.map((event) => [event.type, event.round])).toEqual([
      ['round_started', 1], ['round_finished', 1], ['round_started', 2], ['round_finished', 2],
    ])
    expect(events[1]).toMatchObject({ type: 'round_finished', toolCallCount: 1 })
    expect(events[3]).toMatchObject({ type: 'round_finished', toolCallCount: 0 })
  })

  it('reports real Anthropic rounds around a tool call', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'tool_use', id: 'tool-1', name: 'lookup', input: {} }],
        usage: { input_tokens: 9, output_tokens: 2 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: 'text', text: 'Resposta final.' }],
        usage: { input_tokens: 12, output_tokens: 3 },
      }))
    globalThis.fetch = fetchMock as typeof fetch
    const events: ProviderLifecycleEvent[] = []

    const result = await generateAnthropic({
      apiKey: 'test', model: 'test-model', systemPrompt: 'system',
      messages: [{ role: 'user', content: 'Olá' }], timeoutMs: 1_000,
      tools: [{ name: 'lookup', description: 'Lookup', parameters: { type: 'object', properties: {} } }],
      executeTool: async () => JSON.stringify({ ok: true }),
      onLifecycleEvent: (event) => events.push(event),
    })

    expect(result.text).toBe('Resposta final.')
    expect(events.map((event) => [event.type, event.round])).toEqual([
      ['round_started', 1], ['round_finished', 1], ['round_started', 2], ['round_finished', 2],
    ])
    expect(events[1]).toMatchObject({ type: 'round_finished', toolCallCount: 1 })
    expect(events[3]).toMatchObject({ type: 'round_finished', toolCallCount: 0 })
  })
})
