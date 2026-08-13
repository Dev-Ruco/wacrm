import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { executorWithTenantPolicy } from './action-policy'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import { createAgentTraceCollector } from './trace'

function fakeDb() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const client = {
    from: (table: string) => ({
      insert: async (payload: Record<string, unknown>) => {
        inserts.push({ table, payload })
        return { error: null }
      },
      update: (payload: Record<string, unknown>) => {
        updates.push({ table, payload })
        const result = { error: null }
        const chain: Record<string, unknown> = {
          eq: () => chain,
          then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
            Promise.resolve(result).then(resolve, reject),
        }
        return chain
      },
    }),
  } as unknown as WacrmSupabaseClient
  return { client, inserts, updates }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('tool observability', () => {
  it('records the real tool execution with privacy-reduced input and output', async () => {
    const { client, inserts, updates } = fakeDb()
    const trace = createAgentTraceCollector({
      db: client,
      accountId: 'acct-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
    })
    const executeTool = async () => JSON.stringify({
      ok: true,
      found: true,
      products: [
        {
          product_ref: 'catalog_result_1',
          name: 'Produto A',
          category: 'categoria',
          media_count: 1,
          private_notes: 'não deve aparecer',
        },
      ],
    })
    const wrapped = executorWithTenantPolicy({
      executeTool,
      strategy: DEFAULT_COMMERCIAL_STRATEGY,
    })!

    await wrapped({
      id: 'call-1',
      name: 'search_catalog',
      arguments: JSON.stringify({
        query: 'produto para treino',
        category: 'categoria',
        private_customer_note: 'não persistir',
      }),
    })
    trace.finish('reply')
    await flush()

    const toolStart = inserts
      .filter((row) => row.table === 'agent_trace_steps')
      .map((row) => row.payload)
      .find((row) => row.type === 'tool_called')
    expect(toolStart).toMatchObject({
      label: 'search_catalog',
      metadata: {
        action_class: 'read',
        input: { query: 'produto para treino', category: 'categoria' },
      },
    })
    expect(JSON.stringify(toolStart)).not.toContain('private_customer_note')

    const toolFinish = updates
      .filter((row) => row.table === 'agent_trace_steps')
      .map((row) => row.payload)
      .find((row) => row.status === 'completed' && row.metadata)
    expect(toolFinish).toMatchObject({
      status: 'completed',
      metadata: {
        action_class: 'read',
        output: { ok: true, found: true, returned_count: 1 },
      },
    })
    expect(JSON.stringify(toolFinish)).not.toContain('private_notes')
  })
})
