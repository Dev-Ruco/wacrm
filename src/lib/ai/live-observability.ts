export type LiveRunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'handoff'
export type LiveStepStatus = 'running' | 'completed' | 'failed' | 'blocked'

export interface AgentLiveRun {
  id: string
  conversation_id: string
  intent: string | null
  model_tier: string | null
  final_action: string
  status: LiveRunStatus
  provider: string | null
  model: string | null
  total_ms: number
  started_at: string
  finished_at: string | null
  created_at: string
}

export interface AgentLiveStep {
  id: string
  trace_id: string
  sequence: number
  type: string
  label: string
  status: LiveStepStatus
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  metadata: Record<string, unknown>
}

export interface LiveGraphNode {
  id: string
  step: AgentLiveStep
}

export interface LiveGraphEdge {
  id: string
  source: string
  target: string
  active: boolean
}

/**
 * The execution graph is derived only from persisted steps. It never creates
 * decorative "possible" nodes, so the canvas cannot claim that a capability
 * participated when the runtime did not record it.
 */
export function buildLiveExecutionGraph(steps: AgentLiveStep[]): {
  nodes: LiveGraphNode[]
  edges: LiveGraphEdge[]
} {
  const ordered = [...steps].sort((a, b) => a.sequence - b.sequence)
  const nodes = ordered.map((step) => ({ id: step.id, step }))
  const edges = ordered.slice(1).map((step, index) => {
    const previous = ordered[index]
    return {
      id: `${previous.id}:${step.id}`,
      source: previous.id,
      target: step.id,
      active: step.status === 'running',
    }
  })
  return { nodes, edges }
}

export function upsertLiveRun(rows: AgentLiveRun[], incoming: AgentLiveRun): AgentLiveRun[] {
  const rest = rows.filter((row) => row.id !== incoming.id)
  return [incoming, ...rest]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, 30)
}

export function upsertLiveStep(rows: AgentLiveStep[], incoming: AgentLiveStep): AgentLiveStep[] {
  return [...rows.filter((row) => row.id !== incoming.id), incoming].sort(
    (a, b) => a.sequence - b.sequence,
  )
}

export function runDurationMs(run: AgentLiveRun, now = Date.now()): number {
  if (run.status !== 'running') return Math.max(0, run.total_ms ?? 0)
  const start = Date.parse(run.started_at)
  return Number.isFinite(start) ? Math.max(0, now - start) : 0
}

export function stepKind(type: string):
  | 'message'
  | 'context'
  | 'memory'
  | 'skill'
  | 'model'
  | 'tool'
  | 'guardrail'
  | 'response'
  | 'handoff'
  | 'system' {
  if (type.includes('message')) return 'message'
  if (type.includes('context') || type.includes('state')) return 'context'
  if (type.includes('memory')) return 'memory'
  if (type.includes('skill')) return 'skill'
  if (type.includes('llm') || type.includes('model')) return 'model'
  if (type.includes('tool')) return 'tool'
  if (type.includes('guardrail')) return 'guardrail'
  if (type.includes('response')) return 'response'
  if (type.includes('handoff')) return 'handoff'
  return 'system'
}
