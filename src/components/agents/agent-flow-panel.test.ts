import { describe, expect, it } from 'vitest'
import { buildExecutionFlow } from './agent-flow-panel'
import type { AgentLiveStep } from '@/lib/ai/live-observability'

function step(
  sequence: number,
  type: string,
  label: string,
  status: AgentLiveStep['status'] = 'completed',
): AgentLiveStep {
  return {
    id: `step-${sequence}`,
    trace_id: 'run-1',
    sequence,
    type,
    label,
    status,
    started_at: `2026-08-13T19:00:0${sequence}.000Z`,
    finished_at: `2026-08-13T19:00:0${sequence}.100Z`,
    duration_ms: 100,
    metadata: {},
  }
}

describe('buildExecutionFlow', () => {
  it('renders only steps that the runtime actually persisted', () => {
    const flow = buildExecutionFlow([
      step(0, 'message_received', 'Mensagem'),
      step(1, 'memory_retrieved', 'Memória'),
      step(2, 'response_sent', 'Resposta'),
    ])

    expect(flow.nodes.map((node) => node.id)).toEqual(['step-0', 'step-1', 'step-2'])
    expect(flow.edges).toHaveLength(2)
    expect(flow.nodes.some((node) => node.data.step.type === 'tool_called')).toBe(false)
  })

  it('keeps repeated tool/model steps in execution order instead of collapsing them', () => {
    const flow = buildExecutionFlow([
      step(0, 'message_received', 'Mensagem'),
      step(1, 'llm_round', 'LLM · Round 1'),
      step(2, 'tool_called', 'search_catalog'),
      step(3, 'llm_round', 'LLM · Round 2'),
      step(4, 'tool_called', 'send_product'),
      step(5, 'llm_round', 'LLM · Round 3'),
      step(6, 'response_sent', 'Resposta'),
    ])

    expect(flow.nodes.map((node) => node.data.step.label)).toEqual([
      'Mensagem',
      'LLM · Round 1',
      'search_catalog',
      'LLM · Round 2',
      'send_product',
      'LLM · Round 3',
      'Resposta',
    ])
  })

  it('animates only the edge entering a running step and respects reduced motion', () => {
    const steps = [
      step(0, 'message_received', 'Mensagem'),
      step(1, 'llm_round', 'LLM · Round 1', 'running'),
    ]
    expect(buildExecutionFlow(steps, false).edges[0]?.animated).toBe(true)
    expect(buildExecutionFlow(steps, true).edges[0]?.animated).toBe(false)
  })
})
