import { describe, expect, it, vi } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { createAgentTraceCollector, recordTrace } from './trace'

function liveTraceDb() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const updates: Array<{ table: string; payload: Record<string, unknown> }> = []
  const from = vi.fn((table: string) => ({
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
  }))
  return { db: { from } as unknown as WacrmSupabaseClient, inserts, updates }
}

async function flushTraceWrites() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('agent trace', () => {
  it('one-shot writer remains privacy-reduced and marks the run complete', async () => {
    const { db, inserts } = liveTraceDb()
    await recordTrace(db, {
      accountId: 'acct-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      startedAt: 100,
      intent: 'sales',
      modelTier: 'smart',
      finalAction: 'reply',
      totalMs: 321.4,
      memoryMatchCount: 2,
      guardrailViolations: [],
      toolCalls: [{ name: 'search_catalog', ms: 88.7, succeeded: true }],
    })
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({
      table: 'agent_traces',
      payload: {
        account_id: 'acct-1',
        agent_id: 'agent-1',
        conversation_id: 'conv-1',
        turn_id: 'turn-1',
        status: 'completed',
        final_action: 'reply',
        total_ms: 321,
        memory_match_count: 2,
        tool_calls: [{ sequence: 0, name: 'search_catalog', ms: 89, succeeded: true }],
      },
    })
    expect(JSON.stringify(inserts)).not.toContain('arguments')
    expect(JSON.stringify(inserts)).not.toContain('result')
  })

  it('creates a running parent, ordered lifecycle steps and one final update', async () => {
    const { db, inserts, updates } = liveTraceDb()
    let now = 1000
    const trace = createAgentTraceCollector({
      db,
      accountId: 'acct-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      inboundMessageId: 'wamid-1',
      provider: 'openai',
      model: 'model-1',
      now: () => now,
    })
    trace.setIntent('faq', 'fast')
    now += 12
    trace.setMemoryMatchCount(2)
    now += 20
    trace.recordToolCall({ name: 'search_knowledge', ms: 20, succeeded: true })
    now += 10
    trace.recordGuardrailViolations(['unsupported_price'])
    now += 100
    trace.finish('handoff', 'blocked')
    trace.finish('reply')
    await flushTraceWrites()

    const parent = inserts.find((row) => row.table === 'agent_traces')
    expect(parent?.payload).toMatchObject({
      account_id: 'acct-1',
      conversation_id: 'conv-1',
      turn_id: 'turn-1',
      status: 'running',
      provider: 'openai',
      model: 'model-1',
      inbound_message_id: 'wamid-1',
    })
    const stepInserts = inserts
      .filter((row) => row.table === 'agent_trace_steps')
      .map((row) => row.payload)
    expect(stepInserts.map((row) => row.type)).toEqual([
      'message_received',
      'intent_classified',
      'memory_retrieved',
      'guardrail_checked',
      'handoff_triggered',
    ])
    expect(stepInserts.map((row) => row.sequence)).toEqual([0, 1, 2, 3, 4])
    const finalUpdate = updates.filter((row) => row.table === 'agent_traces').at(-1)
    expect(finalUpdate?.payload).toMatchObject({
      status: 'blocked',
      final_action: 'handoff',
      intent: 'faq',
      model_tier: 'fast',
      memory_match_count: 2,
      guardrail_violations: ['unsupported_price'],
      tool_calls: [{ sequence: 0, name: 'search_knowledge', ms: 20, succeeded: true }],
    })
  })

  it('does not throw when observability storage fails', async () => {
    const db = {
      from: () => ({
        insert: async () => ({ error: new Error('telemetry unavailable') }),
        update: () => {
          const result = { error: new Error('telemetry unavailable') }
          const chain: Record<string, unknown> = {
            eq: () => chain,
            then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve(result).then(resolve, reject),
          }
          return chain
        },
      }),
    } as unknown as WacrmSupabaseClient
    const trace = createAgentTraceCollector({
      db,
      accountId: 'acct-1',
      agentId: 'agent-1',
      conversationId: 'conv-1',
    })
    expect(() =>
      trace.recordToolCall({ name: 'search_catalog', ms: 1, succeeded: true }),
    ).not.toThrow()
    expect(() => trace.finish('reply')).not.toThrow()
    await flushTraceWrites()
  })
})
