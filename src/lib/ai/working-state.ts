import type { WacrmSupabaseClient } from '@/lib/supabase/types'

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

export const EMPTY_WORKING_CONVERSATION_STATE: WorkingConversationState = {
  currentGoal: null,
  constraints: {},
  preferences: {},
  exclusions: {},
  selectedEntity: null,
  pendingQuestion: null,
  status: 'active',
  revision: 0,
}

function cleanText(value: unknown, max = 240): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function asMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => [cleanText(key, 80), cleanText(raw)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
      .slice(0, 30),
  )
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

function asStatus(value: unknown): WorkingConversationStatus {
  if (value === 'waiting_customer' || value === 'resolved') return value
  return 'active'
}

export function workingConversationStatePrompt(
  state: WorkingConversationState,
): string | null {
  const meaningful = Boolean(
    state.currentGoal ||
      Object.keys(state.constraints).length ||
      Object.keys(state.preferences).length ||
      Object.keys(state.exclusions).length ||
      state.selectedEntity ||
      state.pendingQuestion ||
      state.status !== 'active',
  )
  if (!meaningful) return null

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
    'Working conversation state — server-maintained operational continuity for this live conversation, not long-term customer memory.',
    `Current state: ${JSON.stringify(snapshot)}.`,
    'Use this only to preserve the active task across short or ambiguous follow-ups. The newest real customer message overrides stale values. Never invent a missing fact and never mention this internal state to the customer.',
  ].join('\n')
}

export async function loadWorkingConversationState(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
}): Promise<WorkingConversationState> {
  if (!args.conversationId) return { ...EMPTY_WORKING_CONVERSATION_STATE }
  try {
    const { data, error } = await args.db
      .from('conversation_working_state')
      .select(
        'current_goal, constraints, preferences, exclusions, selected_entity, pending_question, status, revision',
      )
      .eq('account_id', args.accountId)
      .eq('conversation_id', args.conversationId)
      .maybeSingle()

    if (error || !data) return { ...EMPTY_WORKING_CONVERSATION_STATE }

    return {
      currentGoal: cleanText(data.current_goal, 500),
      constraints: asMap(data.constraints),
      preferences: asMap(data.preferences),
      exclusions: asMap(data.exclusions),
      selectedEntity: asSelectedEntity(data.selected_entity),
      pendingQuestion: cleanText(data.pending_question, 500),
      status: asStatus(data.status),
      revision: Number.isFinite(Number(data.revision)) ? Number(data.revision) : 0,
    }
  } catch (error) {
    console.warn('[working state] load failed; continuing without persisted state:', error)
    return { ...EMPTY_WORKING_CONVERSATION_STATE }
  }
}
