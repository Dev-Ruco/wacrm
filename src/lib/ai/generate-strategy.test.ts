import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import { generateReply } from './generate'
import type { AgentToolDefinition, AiConfig } from './types'

function config(): AiConfig {
  return {
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    commercialStrategy: {
      ...DEFAULT_COMMERCIAL_STRATEGY,
      maxProducts: 2,
      preferVisual: false,
      qualificationOrder: 'color_then_size',
    },
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    bufferWindowSeconds: 12,
    maxReplyChunks: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }
}

const SEARCH_TOOL: AgentToolDefinition = {
  name: 'search_catalog',
  description: 'Search the current catalogue.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}

function okResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'Resposta.' } }] }),
  } as unknown as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live catalogue strategy injection', () => {
  it('adds the account catalogue strategy when catalogue tools are active', async () => {
    await generateReply({
      config: config(),
      systemPrompt: 'Base agent prompt.',
      messages: [{ role: 'user', content: 'Quero uma legging.' }],
      tools: [SEARCH_TOOL],
      executeTool: async () => JSON.stringify({ ok: true, products: [] }),
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    const system = body.messages[0].content as string
    expect(system).toContain('Catalogue strategy — account-level rules for this tenant:')
    expect(system).toContain('Present at most 2 product options')
    expect(system).toContain('Automatic media presentation is disabled')
    expect(system).toContain('colour first, then size')
  })

  it('does not inject catalogue strategy into non-catalogue model tasks', async () => {
    await generateReply({
      config: config(),
      systemPrompt: 'Internal summariser.',
      messages: [{ role: 'user', content: 'Summarise this.' }],
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    expect(body.messages[0].content).toBe('Internal summariser.')
  })

  it('does not duplicate a catalogue strategy already present in the prompt', async () => {
    const marker = 'Catalogue strategy — account-level rules for this tenant:'
    await generateReply({
      config: config(),
      systemPrompt: `Base.\n\n${marker}\n- Existing policy.`,
      messages: [{ role: 'user', content: 'Quero uma legging.' }],
      tools: [SEARCH_TOOL],
      executeTool: async () => JSON.stringify({ ok: true, products: [] }),
    })

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))
    const system = body.messages[0].content as string
    expect(system.split(marker)).toHaveLength(2)
  })
})
