import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { GuardrailViolation } from './guardrails'
import { enterAgentTraceContext } from './trace-context'
import { sanitizeTraceMetadata } from './trace-sanitize'

export type ConversationIntent = 'faq' | 'sales' | 'complaint' | 'account' | 'smalltalk'
export type AgentModelTier = 'fast' | 'smart'
export type AgentFinalAction = 'reply' | 'handoff' | 'no_reply'
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'handoff'
export type AgentTraceStepStatus = 'running' | 'completed' | 'failed' | 'blocked'

export interface AgentTraceToolCall { name: string; ms: number; succeeded: boolean }
export interface AgentTraceStepHandle { sequence: number; startedAt: number }

export interface AgentTrace {
  accountId: string
  agentId: string
  conversationId: string
  turnId: string
  startedAt: number
  intent: ConversationIntent | null
  toolCalls: AgentTraceToolCall[]
  memoryMatchCount: number
  guardrailViolations: GuardrailViolation[]
  modelTier: AgentModelTier
  finalAction: AgentFinalAction
  totalMs: number
}

function finalStatus(action: AgentFinalAction): AgentRunStatus {
  return action === 'handoff' ? 'handoff' : 'completed'
}

export async function recordTrace(db: WacrmSupabaseClient, trace: AgentTrace): Promise<void> {
  const finishedAt = trace.startedAt + Math.max(0, trace.totalMs)
  try {
    const { error } = await db.from('agent_traces').insert({
      account_id: trace.accountId,
      agent_id: trace.agentId,
      conversation_id: trace.conversationId,
      turn_id: trace.turnId,
      intent: trace.intent,
      model_tier: trace.modelTier,
      final_action: trace.finalAction,
      status: finalStatus(trace.finalAction),
      total_ms: Math.max(0, Math.round(trace.totalMs)),
      memory_match_count: Math.max(0, Math.round(trace.memoryMatchCount)),
      guardrail_violations: trace.guardrailViolations,
      tool_calls: trace.toolCalls.slice(0, 50).map((call, sequence) => ({
        sequence,
        name: call.name,
        ms: Math.max(0, Math.round(call.ms)),
        succeeded: call.succeeded,
      })),
      started_at: new Date(trace.startedAt).toISOString(),
      finished_at: new Date(finishedAt).toISOString(),
      updated_at: new Date(finishedAt).toISOString(),
    })
    if (error) console.error('[ai trace] insert failed:', error)
  } catch (error) {
    console.error('[ai trace] insert threw:', error)
  }
}

export interface AgentTraceCollector {
  readonly traceId: string
  setRuntime: (provider: string, model: string) => void
  setIntent: (intent: ConversationIntent, modelTier: AgentModelTier) => void
  setMemoryMatchCount: (count: number) => void
  recordToolCall: (call: AgentTraceToolCall) => void
  recordGuardrailViolations: (violations: GuardrailViolation[]) => void
  recordEvent: (type: string, label: string, metadata?: Record<string, unknown>, status?: Exclude<AgentTraceStepStatus, 'running'>) => void
  startStep: (type: string, label: string, metadata?: Record<string, unknown>) => AgentTraceStepHandle
  finishStep: (handle: AgentTraceStepHandle, status?: Exclude<AgentTraceStepStatus, 'running'>, metadata?: Record<string, unknown>) => void
  finish: (finalAction: AgentFinalAction, status?: AgentRunStatus) => void
}

export function createAgentTraceCollector(args: {
  db: WacrmSupabaseClient
  accountId: string
  agentId: string
  conversationId: string
  turnId?: string
  inboundMessageId?: string | null
  provider?: string | null
  model?: string | null
  now?: () => number
}): AgentTraceCollector {
  const now = args.now ?? Date.now
  const startedAt = now()
  const traceId = crypto.randomUUID()
  const turnId = args.turnId ?? crypto.randomUUID()
  let intent: ConversationIntent | null = null
  let modelTier: AgentModelTier = 'smart'
  let memoryMatchCount = 0
  let finished = false
  let sequence = 0
  const toolCalls: AgentTraceToolCall[] = []
  const guardrailViolations = new Set<GuardrailViolation>()
  let writes: Promise<void> = Promise.resolve()

  const enqueue = (label: string, operation: () => Promise<void>) => {
    writes = writes.then(operation).catch((error) => console.error(`[ai trace] ${label} failed:`, error))
  }

  enqueue('run start', async () => {
    const { error } = await args.db.from('agent_traces').insert({
      id: traceId,
      account_id: args.accountId,
      agent_id: args.agentId,
      conversation_id: args.conversationId,
      turn_id: turnId,
      intent: null,
      model_tier: 'smart',
      final_action: 'no_reply',
      status: 'running',
      provider: args.provider ?? null,
      model: args.model ?? null,
      inbound_message_id: args.inboundMessageId ?? null,
      total_ms: 0,
      memory_match_count: 0,
      guardrail_violations: [],
      tool_calls: [],
      started_at: new Date(startedAt).toISOString(),
      updated_at: new Date(startedAt).toISOString(),
    })
    if (error) throw error
  })

  const startStep: AgentTraceCollector['startStep'] = (type, label, metadata = {}) => {
    if (finished) return { sequence: -1, startedAt: now() }
    const handle = { sequence, startedAt: now() }
    sequence += 1
    const clean = sanitizeTraceMetadata(metadata)
    enqueue(`step ${handle.sequence} start`, async () => {
      const { error } = await args.db.from('agent_trace_steps').insert({
        account_id: args.accountId,
        trace_id: traceId,
        sequence: handle.sequence,
        type: type.slice(0, 80),
        label: label.slice(0, 160),
        status: 'running',
        started_at: new Date(handle.startedAt).toISOString(),
        metadata: clean,
      })
      if (error) throw error
    })
    return handle
  }

  const finishStep: AgentTraceCollector['finishStep'] = (handle, status = 'completed', metadata = {}) => {
    if (handle.sequence < 0) return
    const finishedAt = now()
    const clean = sanitizeTraceMetadata(metadata)
    enqueue(`step ${handle.sequence} finish`, async () => {
      const { error } = await args.db.from('agent_trace_steps').update({
        status,
        finished_at: new Date(finishedAt).toISOString(),
        duration_ms: Math.max(0, Math.round(finishedAt - handle.startedAt)),
        metadata: clean,
        updated_at: new Date(finishedAt).toISOString(),
      }).eq('trace_id', traceId).eq('account_id', args.accountId).eq('sequence', handle.sequence)
      if (error) throw error
    })
  }

  const recordEvent: AgentTraceCollector['recordEvent'] = (type, label, metadata = {}, status = 'completed') => {
    if (finished) return
    const handle = startStep(type, label, metadata)
    finishStep(handle, status, metadata)
  }

  recordEvent('message_received', 'Mensagem entregue ao agente', { inbound_message_id: args.inboundMessageId ?? null })

  const collector: AgentTraceCollector = {
    traceId,
    setRuntime(provider, model) {
      if (finished) return
      enqueue('run runtime metadata', async () => {
        const { error } = await args.db.from('agent_traces').update({
          provider: provider.slice(0, 40),
          model: model.slice(0, 160),
          updated_at: new Date(now()).toISOString(),
        }).eq('id', traceId).eq('account_id', args.accountId)
        if (error) throw error
      })
    },
    setIntent(nextIntent, nextModelTier) {
      intent = nextIntent
      modelTier = nextModelTier
      recordEvent('intent_classified', 'Intenção classificada', { intent: nextIntent, model_tier: nextModelTier })
    },
    setMemoryMatchCount(count) {
      memoryMatchCount = Math.max(0, Math.round(count))
      recordEvent('memory_retrieved', 'Memória consultada', { match_count: memoryMatchCount })
    },
    recordToolCall(call) {
      if (!finished && toolCalls.length < 50) toolCalls.push({ ...call })
    },
    recordGuardrailViolations(violations) {
      if (finished) return
      for (const violation of violations) guardrailViolations.add(violation)
      if (violations.length > 0) recordEvent('guardrail_checked', 'Guardrail bloqueou a resposta', { safe: false, violations }, 'blocked')
    },
    recordEvent,
    startStep,
    finishStep,
    finish(finalAction, requestedStatus) {
      if (finished) return
      if (finalAction === 'reply') recordEvent('response_sent', 'Resposta enviada', { final_action: finalAction })
      else if (finalAction === 'handoff') recordEvent('handoff_triggered', 'Encaminhado para atendimento humano', { final_action: finalAction })
      else recordEvent('no_reply', 'Sem resposta automática', { final_action: finalAction })
      finished = true
      const finishedAt = now()
      const status = requestedStatus ?? finalStatus(finalAction)
      enqueue('run finish', async () => {
        const { error } = await args.db.from('agent_traces').update({
          intent,
          model_tier: modelTier,
          final_action: finalAction,
          status,
          total_ms: Math.max(0, Math.round(finishedAt - startedAt)),
          memory_match_count: memoryMatchCount,
          guardrail_violations: Array.from(guardrailViolations),
          tool_calls: toolCalls.slice(0, 50).map((call, index) => ({ sequence: index, name: call.name, ms: Math.max(0, Math.round(call.ms)), succeeded: call.succeeded })),
          finished_at: new Date(finishedAt).toISOString(),
          updated_at: new Date(finishedAt).toISOString(),
        }).eq('id', traceId).eq('account_id', args.accountId)
        if (error) throw error
      })
    },
  }

  enterAgentTraceContext(collector)
  return collector
}
