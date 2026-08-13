import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { AgentToolCall, AgentToolDefinition, AgentToolExecutor } from './types'

export type WorkingConversationStatus = 'active' | 'waiting_customer' | 'resolved'

export interface WorkingSelectedEntity {
  kind: string | null
  label: string
  key: string | null
}

export interface WorkingConversationState {
  currentGoal: string | null
  constraints: Record<string, string>
  preferences: Record<string, string>
  exclusions: Record<string, string>
  selectedEntity: WorkingSelectedEntity | null
  pendingQuestion: string | null
  status: WorkingConversationStatus
  revision: number
}

const EMPTY_STATE: WorkingConversationState = {
  currentGoal: null,
  constraints: {},
  preferences: {},
  exclusions: {},
  selectedEntity: null,
  pendingQuestion: null,
  status: 'active',
  revision: 0,
}

const MAX_KEY_LENGTH = 80
const MAX_VALUE_LENGTH = 240
const MAX_MAP_KEYS = 30

function cleanText(value: unknown, max = MAX_VALUE_LENGTH): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function asMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([rawKey, rawValue]) => {
      const key = cleanText(rawKey, MAX_KEY_LENGTH)
      const text = cleanText(rawValue)
      return key && text ? ([key, text] as const) : null
    })
    .filter((entry): entry is readonly [string, string] => Boolean(entry))
    .slice(0, MAX_MAP_KEYS)
  return Object.fromEntries(entries)
}

function asSelectedEntity(value: unknown): WorkingSelectedEntity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  const label = cleanText(raw.label, 180)
  if (!label) return null
  return {
    kind: cleanText(raw.kind, 80),
    label,
    key: cleanText(raw.key, 180),
  }
}

function statusFrom(value: unknown): WorkingConversationStatus {
  return value === 'waiting_customer' || value === 'resolved' ? value : 'active'
}

export function workingConversationStatePrompt(state: WorkingConversationState): string {
  const snapshot = {
    current_goal: state.currentGoal,
    constraints: state.constraints,
    preferences: state.preferences,
    exclusions: state.exclusions,
    selected_entity: state.selectedEntity,
    pending_question: state.pendingQuestion,
    status: state.status,
  }

  return [
    'Working conversation state — internal operational continuity for this live conversation, not long-term customer memory.',
    `Current state: ${JSON.stringify(snapshot)}.`,
    'Recent customer messages always override stale state. Never invent a missing fact just to complete the state.',
    'When the current customer message materially changes the active goal, a constraint, a preference, an exclusion, the selected entity, the question you are waiting for, or whether the task is resolved, call update_conversation_state before the final reply.',
    'Do not update state for a simple greeting, thanks or acknowledgement unless it actually resolves a pending question. Do not mention this state or the maintenance tool to the customer.',
  ].join('\n')
}

export async function loadWorkingConversationState(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
}): Promise<WorkingConversationState> {
  if (!args.conversationId) return { ...EMPTY_STATE }
  try {
    const { data, error } = await args.db
      .from('conversation_working_state')
      .select('current_goal, constraints, preferences, exclusions, selected_entity, pending_question, status, revision')
      .eq('account_id', args.accountId)
      .eq('conversation_id', args.conversationId)
      .maybeSingle()

    if (error) {
      console.warn('[working state] load failed; continuing without persisted state:', error.message)
      return { ...EMPTY_STATE }
    }
    if (!data) return { ...EMPTY_STATE }

    return {
      currentGoal: cleanText(data.current_goal, 500),
      constraints: asMap(data.constraints),
      preferences: asMap(data.preferences),
      exclusions: asMap(data.exclusions),
      selectedEntity: asSelectedEntity(data.selected_entity),
      pendingQuestion: cleanText(data.pending_question, 500),
      status: statusFrom(data.status),
      revision: Number.isFinite(Number(data.revision)) ? Number(data.revision) : 0,
    }
  } catch (error) {
    console.warn('[working state] load failed; continuing without persisted state:', error)
    return { ...EMPTY_STATE }
  }
}

interface KeyValueChange {
  key: string
  value: string
}

function parseChanges(value: unknown): KeyValueChange[] {
  if (!Array.isArray(value)) return []
  const result: KeyValueChange[] = []
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const row = candidate as Record<string, unknown>
    const key = cleanText(row.key, MAX_KEY_LENGTH)
    const text = cleanText(row.value)
    if (!key || !text) continue
    result.push({ key, value: text })
    if (result.length >= MAX_MAP_KEYS) break
  }
  return result
}

function parseKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => cleanText(item, MAX_KEY_LENGTH))
        .filter((item): item is string => Boolean(item)),
    ),
  ).slice(0, MAX_MAP_KEYS)
}

function applyMapChanges(
  current: Record<string, string>,
  additions: KeyValueChange[],
  removals: string[],
): Record<string, string> {
  const next = { ...current }
  for (const key of removals) delete next[key]
  for (const change of additions) next[change.key] = change.value
  return Object.fromEntries(Object.entries(next).slice(-MAX_MAP_KEYS))
}

function parseObject(raw: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error('Tool arguments are not valid JSON.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool arguments must be a JSON object.')
  }
  return value as Record<string, unknown>
}

export const UPDATE_CONVERSATION_STATE_TOOL: AgentToolDefinition = {
  name: 'update_conversation_state',
  description:
    'Maintain the current operational state of this live conversation. This is internal continuity, not durable CRM memory and not a customer-visible business action. Call it when the current customer message materially changes the active goal, constraints, preferences, exclusions, selected entity, pending question or task status. Recent customer statements override stale state. Do not call it for a greeting or acknowledgement that changes nothing.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      current_goal: {
        type: 'string',
        description: 'Concise current customer goal. Omit when unchanged.',
      },
      clear_current_goal: { type: 'boolean' },
      constraints: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { key: { type: 'string' }, value: { type: 'string' } },
          required: ['key', 'value'],
        },
        description: 'Known requirements or hard conditions to merge into the current state. Keys are business-defined, not platform-defined.',
      },
      remove_constraints: { type: 'array', items: { type: 'string' } },
      preferences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { key: { type: 'string' }, value: { type: 'string' } },
          required: ['key', 'value'],
        },
        description: 'Soft customer preferences to merge. Use the tenant/customer vocabulary naturally.',
      },
      remove_preferences: { type: 'array', items: { type: 'string' } },
      exclusions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { key: { type: 'string' }, value: { type: 'string' } },
          required: ['key', 'value'],
        },
        description: 'Things the customer explicitly rejected or ruled out. Keep the key meaningful for this business, e.g. a property such as colour, location, date or option type.',
      },
      remove_exclusions: { type: 'array', items: { type: 'string' } },
      selected_entity: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', description: 'Generic entity kind in this tenant, e.g. product, service, booking, vehicle or plan.' },
          label: { type: 'string', description: 'Human-readable entity label.' },
          key: { type: 'string', description: 'Stable identifier when one is actually known.' },
        },
        required: ['label'],
      },
      clear_selected_entity: { type: 'boolean' },
      pending_question: {
        type: 'string',
        description: 'The one concrete question the agent is waiting for the customer to answer. Omit when unchanged.',
      },
      clear_pending_question: { type: 'boolean' },
      status: {
        type: 'string',
        enum: ['active', 'waiting_customer', 'resolved'],
      },
    },
  },
}

export function createWorkingConversationStateRuntime(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
}): {
  tool: AgentToolDefinition
  executeTool: AgentToolExecutor
} {
  const executeTool: AgentToolExecutor = async (call: AgentToolCall) => {
    if (call.name !== UPDATE_CONVERSATION_STATE_TOOL.name) {
      throw new Error(`Unsupported working-state tool: ${call.name}`)
    }

    const input = parseObject(call.arguments)
    const state = await loadWorkingConversationState(args)

    const currentGoal =
      input.clear_current_goal === true
        ? null
        : cleanText(input.current_goal, 500) ?? state.currentGoal
    const pendingQuestion =
      input.clear_pending_question === true
        ? null
        : cleanText(input.pending_question, 500) ?? state.pendingQuestion
    const selectedEntity =
      input.clear_selected_entity === true
        ? null
        : asSelectedEntity(input.selected_entity) ?? state.selectedEntity

    const next: WorkingConversationState = {
      currentGoal,
      constraints: applyMapChanges(
        state.constraints,
        parseChanges(input.constraints),
        parseKeys(input.remove_constraints),
      ),
      preferences: applyMapChanges(
        state.preferences,
        parseChanges(input.preferences),
        parseKeys(input.remove_preferences),
      ),
      exclusions: applyMapChanges(
        state.exclusions,
        parseChanges(input.exclusions),
        parseKeys(input.remove_exclusions),
      ),
      selectedEntity,
      pendingQuestion,
      status: input.status === 'waiting_customer' || input.status === 'resolved'
        ? input.status
        : input.status === 'active'
          ? 'active'
          : state.status,
      revision: state.revision + 1,
    }

    if (!args.conversationId) {
      return JSON.stringify({ ok: true, persisted: false, state: next })
    }

    try {
      const { error } = await args.db.from('conversation_working_state').upsert(
        {
          account_id: args.accountId,
          conversation_id: args.conversationId,
          current_goal: next.currentGoal,
          constraints: next.constraints,
          preferences: next.preferences,
          exclusions: next.exclusions,
          selected_entity: next.selectedEntity,
          pending_question: next.pendingQuestion,
          status: next.status,
          revision: next.revision,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id,conversation_id' },
      )
      if (error) {
        console.warn('[working state] save failed; continuing conversation:', error.message)
        return JSON.stringify({ ok: false, persisted: false, state: next })
      }
    } catch (error) {
      console.warn('[working state] save failed; continuing conversation:', error)
      return JSON.stringify({ ok: false, persisted: false, state: next })
    }

    return JSON.stringify({
      ok: true,
      persisted: true,
      revision: next.revision,
      state: next,
      instruction: 'Continue the customer conversation naturally. Never mention this internal state update.',
    })
  }

  return { tool: UPDATE_CONVERSATION_STATE_TOOL, executeTool }
}
