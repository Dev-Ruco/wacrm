import { describe, expect, it } from 'vitest'
import {
  buildLiveExecutionGraph,
  normalizeLiveRun,
  normalizeLiveStep,
  runDurationMs,
  upsertLiveRun,
  upsertLiveStep,
  type AgentLiveRun,
  type AgentLiveStep,
} from './live-observability'

function run(id: string, startedAt: string, status: AgentLiveRun['status'] = 'completed'): AgentLiveRun {
  return {
    id,
    conversation_id: 'conv-1',
    intent: null,
    model_tier: null,
    final_action: status === 'handoff' ? 'handoff' : 'reply',
    status,
    provider: 'openai',
    model: 'test-model',
    total_ms: 500,
    started_at: startedAt,
    finished_at: status === 'running' ? null : startedAt,
    created_at: startedAt,
  }
}

function step(sequence: number, status: AgentLiveStep['status'] = 'completed'): AgentLiveStep {
  return {
    id: `step-${sequence}`,
    trace_id: 'run-1',
    sequence,
    type: sequence === 1 ? 'tool_finished' : 'message_received',
    label: `Step ${sequence}`,
    status,
    started_at: '2026-08-13T19:00:00.000Z',
    finished_at: status === 'running' ? null : '2026-08-13T19:00:00.100Z',
    duration_ms: status === 'running' ? null : 100,
    metadata: {},
  }
}

describe('live observability view model', () => {
  it('sorts persisted steps and links only consecutive real steps', () => {
    const graph = buildLiveExecutionGraph([step(2), step(0), step(1)])
    expect(graph.nodes.map((node) => node.step.sequence)).toEqual([0, 1, 2])
    expect(graph.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['step-0', 'step-1'],
      ['step-1', 'step-2'],
    ])
  })

  it('marks only an edge entering a running step as active', () => {
    const graph = buildLiveExecutionGraph([step(0), step(1, 'running'), step(2)])
    expect(graph.edges.map((edge) => edge.active)).toEqual([true, false])
  })

  it('upserts realtime rows without duplicating them', () => {
    const runs = upsertLiveRun([run('a', '2026-08-13T18:00:00Z')], run('a', '2026-08-13T18:00:00Z', 'running'))
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('running')

    const steps = upsertLiveStep([step(0)], { ...step(0), status: 'blocked' })
    expect(steps).toHaveLength(1)
    expect(steps[0].status).toBe('blocked')
  })

  it('computes live duration without changing completed duration', () => {
    expect(runDurationMs(run('done', '2026-08-13T18:00:00Z'), Date.parse('2026-08-13T19:00:00Z'))).toBe(500)
    expect(runDurationMs(run('live', '2026-08-13T18:00:00Z', 'running'), Date.parse('2026-08-13T18:00:02Z'))).toBe(2000)
  })

  it('rejects partial realtime rows instead of exposing them to React state', () => {
    expect(normalizeLiveRun({ id: 'run-partial', status: 'running' })).toBeNull()
    expect(normalizeLiveStep({ id: 'step-partial', trace_id: 'run-1' })).toBeNull()
  })

  it('keeps existing state when an invalid realtime row arrives', () => {
    const existingRun = run('a', '2026-08-13T18:00:00Z')
    const existingStep = step(0)
    expect(upsertLiveRun([existingRun], { id: 'broken' })).toEqual([existingRun])
    expect(upsertLiveStep([existingStep], { id: 'broken' })).toEqual([existingStep])
  })

  it('sanitizes malformed step metadata and negative duration values', () => {
    const normalized = normalizeLiveStep({
      ...step(1),
      status: 'completed',
      metadata: 'unexpected',
      duration_ms: -10,
    })
    expect(normalized?.metadata).toEqual({})
    expect(normalized?.duration_ms).toBe(0)
  })
})
