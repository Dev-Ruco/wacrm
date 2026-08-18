import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  inboundCreatedAt: '2026-08-18T10:00:00.000Z',
  dispatch: vi.fn(),
}))

vi.mock('./admin-client', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      const state = { table }
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        not: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          if (state.table === 'conversations') {
            return Promise.resolve({
              data: { id: 'conv-1', contact_id: 'contact-1' },
              error: null,
            })
          }
          if (state.table === 'messages') {
            return Promise.resolve({
              data: {
                message_id: 'wamid-1',
                created_at: h.inboundCreatedAt,
              },
              error: null,
            })
          }
          return Promise.resolve({ data: null, error: null })
        },
      }
      return b
    },
  }),
}))

vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: h.dispatch,
}))

import { runAutomationAgentTurn } from './agent-turn'

beforeEach(() => {
  h.inboundCreatedAt = '2026-08-18T10:00:00.000Z'
  h.dispatch.mockReset()
  h.dispatch.mockResolvedValue(undefined)
})

describe('runAutomationAgentTurn', () => {
  it('suppresses a delayed follow-up after a newer customer reply', async () => {
    h.inboundCreatedAt = '2026-08-18T11:00:00.000Z'

    const result = await runAutomationAgentTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      instruction: 'Continue the conversation naturally.',
      onlyIfNoCustomerReplyAfter: '2026-08-18T10:00:00.000Z',
    })

    expect(result).toEqual({ invoked: false, reason: 'customer_replied' })
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('invokes the same account agent when no newer customer reply exists', async () => {
    const result = await runAutomationAgentTurn({
      accountId: 'acct-1',
      userId: 'user-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
      instruction: 'Continue the conversation naturally.',
      onlyIfNoCustomerReplyAfter: '2026-08-18T10:30:00.000Z',
    })

    expect(result).toEqual({ invoked: true, reason: 'invoked' })
    expect(h.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'acct-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        inboundMessageId: 'wamid-1',
        initiatedByAutomation: true,
      }),
    )
  })
})
