import { describe, it, expect, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'

// decrypt is identity in tests so we don't depend on real ciphertext.
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (v: string) => `plain:${v}`,
}))

import {
  effectiveAutoReplyCap,
  loadAiConfig,
  MIN_AUTO_REPLY_CAP_PER_CONVERSATION,
} from './config'

function dbReturning(row: Record<string, unknown> | null): WacrmSupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: row, error: null }),
  }
  return chain as unknown as WacrmSupabaseClient
}

const ROW = {
  provider: 'openai',
  model: 'gpt-x',
  api_key: 'enc-key',
  system_prompt: null,
  is_active: false,
  auto_reply_enabled: false,
  auto_reply_max_per_conversation: 3,
  buffer_window_seconds: 12,
  max_reply_chunks: 3,
  embeddings_api_key: null,
}

describe('effectiveAutoReplyCap', () => {
  it('raises legacy low caps so normal multi-turn journeys are not interrupted', () => {
    expect(effectiveAutoReplyCap(10)).toBe(MIN_AUTO_REPLY_CAP_PER_CONVERSATION)
    expect(effectiveAutoReplyCap(3)).toBe(MIN_AUTO_REPLY_CAP_PER_CONVERSATION)
  })

  it('preserves an explicitly configured higher safety cap', () => {
    expect(effectiveAutoReplyCap(80)).toBe(80)
  })
})

describe('loadAiConfig requireActive', () => {
  it('returns null for an inactive config by default', async () => {
    expect(await loadAiConfig(dbReturning(ROW), 'acct')).toBeNull()
  })

  it('returns the config when requireActive is false (Playground path)', async () => {
    const config = await loadAiConfig(dbReturning(ROW), 'acct', {
      requireActive: false,
    })
    expect(config).not.toBeNull()
    expect(config!.provider).toBe('openai')
    expect(config!.apiKey).toBe('plain:enc-key')
    expect(config!.bufferWindowSeconds).toBe(12)
    expect(config!.maxReplyChunks).toBe(3)
    expect(config!.autoReplyMaxPerConversation).toBe(
      MIN_AUTO_REPLY_CAP_PER_CONVERSATION,
    )
  })

  it('returns null when there is no row', async () => {
    expect(
      await loadAiConfig(dbReturning(null), 'acct', { requireActive: false }),
    ).toBeNull()
  })
})
