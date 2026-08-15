import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { AgentToolKey } from '../tool-permissions'
import { createAutoReplyTools } from './index'

function permissions(searchCatalog: boolean): Record<AgentToolKey, boolean> {
  return {
    search_catalog: searchCatalog,
    send_product: false,
    search_knowledge: false,
    add_tag: false,
    create_deal: false,
    schedule_visit: false,
    get_style_opinion: false,
    handoff_human: false,
  }
}

function runtime() {
  return createAutoReplyTools({
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
    permissions: permissions(true),
  })
}

describe('search_catalog Business Offering filters', () => {
  it('publishes the provider-neutral attributes schema', () => {
    const search = runtime().tools.find((tool) => tool.name === 'search_catalog')
    expect(search).toBeDefined()
    const schema = JSON.stringify(search?.parameters)
    expect(schema).toContain('attributes')
    expect(schema).toContain('Exact configured Business Offering attribute key')
    expect(schema).not.toContain('legging, top')
  })

  it('rejects malformed structured attributes before catalogue access', async () => {
    const tools = runtime()
    await expect(tools.executeTool({
      id: 'call-1',
      name: 'search_catalog',
      arguments: JSON.stringify({
        query: 'oferta',
        attributes: { capacity: 5 },
      }),
    })).rejects.toThrow('attributes must be an array.')
  })
})
