import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { DEFAULT_AGENT_TOOLS } from './tool-permissions'
import { createAutoReplyTools } from './tools'

describe('AI tool facade', () => {
  it('adds visual-reference search as a mode of the existing catalogue permission', () => {
    const toolSet = createAutoReplyTools({
      db: {} as WacrmSupabaseClient,
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
      config: {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        embeddingsApiKey: null,
      },
      permissions: { ...DEFAULT_AGENT_TOOLS },
    })

    const search = toolSet.tools.find((tool) => tool.name === 'search_catalog')
    expect(search).toBeDefined()
    expect(
      (search?.parameters as { properties?: Record<string, unknown> }).properties,
    ).toHaveProperty('visual_reference')
    expect(toolSet.tools.some((tool) => tool.name === 'search_catalog_by_image')).toBe(false)
  })

  it('does not expose visual search when catalogue search permission is disabled', () => {
    const toolSet = createAutoReplyTools({
      db: {} as WacrmSupabaseClient,
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
      config: {
        provider: 'openai',
        model: 'test-model',
        apiKey: 'test-key',
        embeddingsApiKey: null,
      },
      permissions: { ...DEFAULT_AGENT_TOOLS, search_catalog: false },
    })

    expect(toolSet.tools.some((tool) => tool.name === 'search_catalog')).toBe(false)
  })
})
