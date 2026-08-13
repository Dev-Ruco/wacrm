import type { WorkingConversationState } from './working-state'

export function workingStateContextPrompt(
  state: WorkingConversationState,
): string | null {
  const hasState = Boolean(
    state.currentGoal ||
      Object.keys(state.constraints).length ||
      Object.keys(state.preferences).length ||
      Object.keys(state.exclusions).length ||
      state.selectedEntity ||
      state.pendingQuestion ||
      state.status !== 'active',
  )
  if (!hasState) return null

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
