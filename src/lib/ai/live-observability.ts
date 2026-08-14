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

const RUN_STATUSES = new Set<LiveRunStatus>(['running', 'completed', 'failed', 'blocked', 'handoff'])
const STEP_STATUSES = new Set<LiveStepStatus>(['running', 'completed', 'failed', 'blocked'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Realtime payloads are external runtime data, even when TypeScript knows the
 * database shape. Validate them before putting them into React state so a
 * partial/old row can never crash the live visualizer.
 */
export function normalizeLiveRun(value: unknown): AgentLiveRun | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.conversation_id !== 'string' ||
    typeof value.final_action !== 'string' ||
    typeof value.status !== 'string' ||
    !RUN_STATUSES.has(value.status as LiveRunStatus) ||
    typeof value.started_at !== 'string' ||
    typeof value.created_at !== 'string'
  ) return null

  return {
    id: value.id,
    conversation_id: value.conversation_id,
    intent: nullableString(value.intent),
    model_tier: nullableString(value.model_tier),
    final_action: value.final_action,
    status: value.status as LiveRunStatus,
    provider: nullableString(value.provider),
    model: nullableString(value.model),
    total_ms: Math.max(0, finiteNumber(value.total_ms)),
    started_at: value.started_at,
    finished_at: nullableString(value.finished_at),
    created_at: value.created_at,
  }
}

export function normalizeLiveStep(value: unknown): AgentLiveStep | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.trace_id !== 'string' ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    typeof value.type !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.status !== 'string' ||
    !STEP_STATUSES.has(value.status as LiveStepStatus) ||
    typeof value.started_at !== 'string'
  ) return null

  return {
    id: value.id,
    trace_id: value.trace_id,
    sequence: Math.max(0, Math.trunc(value.sequence)),
    type: value.type,
    label: value.label,
    status: value.status as LiveStepStatus,
    started_at: value.started_at,
    finished_at: nullableString(value.finished_at),
    duration_ms: value.duration_ms === null ? null : Math.max(0, finiteNumber(value.duration_ms)),
    metadata: isRecord(value.metadata) ? value.metadata : {},
  }
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

export function upsertLiveRun(rows: AgentLiveRun[], incoming: unknown): AgentLiveRun[] {
  const normalized = normalizeLiveRun(incoming)
  if (!normalized) return rows
  const rest = rows.filter((row) => row.id !== normalized.id)
  return [normalized, ...rest]
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, 30)
}

export function upsertLiveStep(rows: AgentLiveStep[], incoming: unknown): AgentLiveStep[] {
  const normalized = normalizeLiveStep(incoming)
  if (!normalized) return rows
  return [...rows.filter((row) => row.id !== normalized.id), normalized].sort(
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
