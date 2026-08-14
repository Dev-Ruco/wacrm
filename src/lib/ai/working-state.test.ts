import { describe, expect, it } from 'vitest'
import {
  EMPTY_WORKING_CONVERSATION_STATE,
  workingConversationStatePrompt,
} from './working-state'

describe('working conversation state', () => {
  it('omits internal context when there is no active working state', () => {
    expect(workingConversationStatePrompt(EMPTY_WORKING_CONVERSATION_STATE)).toBeNull()
  })

  it('renders a business-agnostic operational snapshot', () => {
    const prompt = workingConversationStatePrompt({
      currentGoal: 'resolve current request',
      constraints: { budget: 'maximum agreed value' },
      preferences: { communication: 'short replies' },
      exclusions: { option: 'previously rejected choice' },
      selectedEntity: { kind: 'service', label: 'Selected option', key: 'ref-1' },
      pendingQuestion: 'Which date works?',
      status: 'waiting_customer',
      revision: 2,
    })

    expect(prompt).toContain('resolve current request')
    expect(prompt).toContain('previously rejected choice')
    expect(prompt).not.toMatch(/legging|pantalona|fitness|LC Fitness/i)
  })
})
