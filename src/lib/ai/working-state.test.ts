import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import {
  createWorkingConversationStateRuntime,
  UPDATE_CONVERSATION_STATE_TOOL,
  workingConversationStatePrompt,
} from './working-state'

describe('working conversation state', () => {
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

  it('accepts dynamic tenant keys without a database when the surface is stateless', async () => {
    const runtime = createWorkingConversationStateRuntime({
      db: {} as WacrmSupabaseClient,
      accountId: 'account-test',
      conversationId: '',
    })

    const result = JSON.parse(
      await runtime.executeTool({
        id: 'state-1',
        name: UPDATE_CONVERSATION_STATE_TOOL.name,
        arguments: JSON.stringify({
          current_goal: 'continue with a different option',
          constraints: [{ key: 'location', value: 'central area' }],
          preferences: [{ key: 'timing', value: 'morning' }],
          exclusions: [{ key: 'provider', value: 'previous option' }],
          pending_question: 'Which day?',
          status: 'waiting_customer',
        }),
      }),
    )

    expect(result).toMatchObject({
      ok: true,
      persisted: false,
      state: {
        currentGoal: 'continue with a different option',
        constraints: { location: 'central area' },
        preferences: { timing: 'morning' },
        exclusions: { provider: 'previous option' },
        pendingQuestion: 'Which day?',
        status: 'waiting_customer',
      },
    })
  })
})
