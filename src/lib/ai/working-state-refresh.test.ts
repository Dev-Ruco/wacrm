import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { loadAiConfig } from './config'
import { generateReply } from './generate'
import { refreshWorkingConversationState } from './working-state-refresh'

vi.mock('./config', () => ({ loadAiConfig: vi.fn() }))
vi.mock('./generate', () => ({ generateReply: vi.fn() }))

function fakeDb(opts: { metaError?: boolean; sourceMessageId?: string | null } = {}) {
  const state = { select: '', table: '' }
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const chain = {
    from: (table: string) => {
      state.table = table
      return chain
    },
    select: (columns: string) => {
      state.select = columns
      return chain
    },
    eq: () => chain,
    maybeSingle: () => {
      if (state.select.includes('source_message_id')) {
        if (opts.metaError) return Promise.resolve({ data: null, error: { message: 'missing table' } })
        return Promise.resolve({
          data: opts.sourceMessageId === undefined
            ? null
            : { source_message_id: opts.sourceMessageId, context_reset_at: null },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    },
    upsert,
  }
  return { db: chain as unknown as WacrmSupabaseClient, upsert }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(loadAiConfig).mockResolvedValue({
    provider: 'openai',
    model: 'test-model',
    apiKey: 'test-key',
    systemPrompt: null,
    commercialStrategy: {
      maxProducts: 3,
      preferVisual: false,
      autoRecommend: true,
      checkStock: true,
      keepSelectedProduct: true,
      qualificationOrder: 'size_then_color',
      initiativeMode: 'conversation_first',
    },
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 30,
    bufferWindowSeconds: 12,
    maxReplyChunks: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
  })
})

describe('refreshWorkingConversationState', () => {
  it('does not spend an LLM call while the migration/storage is unavailable', async () => {
    const { db } = fakeDb({ metaError: true })
    const state = await refreshWorkingConversationState({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contextResetAt: null,
      sourceMessageId: 'msg-1',
      messages: [{ role: 'user', content: 'I changed my mind.' }],
    })

    expect(state.currentGoal).toBeNull()
    expect(generateReply).not.toHaveBeenCalled()
  })

  it('extracts arbitrary tenant keys and persists the newest inbound once', async () => {
    const { db, upsert } = fakeDb()
    vi.mocked(generateReply).mockResolvedValue({
      text: JSON.stringify({
        current_goal: 'find a different option',
        constraints: { location: 'central area' },
        preferences: { timing: 'morning' },
        exclusions: { provider: 'previous choice' },
        selected_entity: null,
        pending_question: 'Which day works?',
        status: 'waiting_customer',
      }),
      handoff: false,
      usage: null,
    })

    const state = await refreshWorkingConversationState({
      db,
      accountId: 'acct-1',
      conversationId: 'conv-1',
      contextResetAt: null,
      sourceMessageId: 'msg-2',
      messages: [
        { role: 'assistant', content: 'Would you like the previous option?' },
        { role: 'user', content: 'No, I need something else in the morning.' },
      ],
    })

    expect(state).toMatchObject({
      currentGoal: 'find a different option',
      constraints: { location: 'central area' },
      preferences: { timing: 'morning' },
      exclusions: { provider: 'previous choice' },
      status: 'waiting_customer',
    })
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acct-1',
        conversation_id: 'conv-1',
        source_message_id: 'msg-2',
      }),
      { onConflict: 'account_id,conversation_id' },
    )
  })
})
