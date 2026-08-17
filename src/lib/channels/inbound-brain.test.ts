import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runAutomationsForTrigger: vi.fn(),
  dispatchInboundToFlows: vi.fn(),
  registerInboundForAiBuffer: vi.fn(),
  dispatchBufferedInboundToAiReply: vi.fn(),
  dispatchInboundToAiReply: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
  supabaseAdmin: vi.fn(() => ({ kind: 'db' })),
}))

vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}))
vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: mocks.dispatchInboundToFlows,
}))
vi.mock('@/lib/ai/message-buffer', () => ({
  registerInboundForAiBuffer: mocks.registerInboundForAiBuffer,
  dispatchBufferedInboundToAiReply: mocks.dispatchBufferedInboundToAiReply,
}))
vi.mock('@/lib/ai/auto-reply', () => ({
  dispatchInboundToAiReply: mocks.dispatchInboundToAiReply,
}))
vi.mock('@/lib/webhooks/deliver', () => ({
  dispatchWebhookEvent: mocks.dispatchWebhookEvent,
}))
vi.mock('@/lib/ai/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

import { dispatchInboundThroughAccountBrain } from './inbound-brain'

const base = {
  accountId: 'account-1',
  conversationId: 'conversation-1',
  contactId: 'contact-1',
  configOwnerUserId: 'user-1',
  inboundMessageId: 'external-1',
  channel: 'website',
  text: 'Quero esta peça',
  contentType: 'text',
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mocks.dispatchInboundToFlows.mockResolvedValue({ consumed: false })
  mocks.runAutomationsForTrigger.mockResolvedValue(false)
  mocks.registerInboundForAiBuffer.mockResolvedValue(null)
  mocks.dispatchInboundToAiReply.mockResolvedValue(undefined)
  mocks.dispatchBufferedInboundToAiReply.mockResolvedValue(undefined)
  mocks.dispatchWebhookEvent.mockResolvedValue(undefined)
})

describe('dispatchInboundThroughAccountBrain', () => {
  it('routes a Website message through Flow, Automations and the same account AI dispatcher', async () => {
    await dispatchInboundThroughAccountBrain(base)

    expect(mocks.dispatchInboundToFlows).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      message: expect.objectContaining({ text: 'Quero esta peça' }),
    }))

    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      triggerType: 'new_message_received',
      context: expect.objectContaining({
        vars: { channel: 'website' },
      }),
    }))
    expect(mocks.runAutomationsForTrigger).toHaveBeenCalledWith(expect.objectContaining({
      triggerType: 'keyword_match',
    }))

    expect(mocks.dispatchInboundToAiReply).toHaveBeenCalledOnce()
    expect(mocks.dispatchInboundToAiReply).toHaveBeenCalledWith({
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
      inboundMessageId: 'external-1',
    })
    expect(mocks.dispatchWebhookEvent).toHaveBeenCalledWith(
      expect.anything(),
      'account-1',
      'message.received',
      expect.objectContaining({ channel: 'website' }),
    )
  })

  it('does not invoke the AI when a deterministic Flow consumes the turn', async () => {
    mocks.dispatchInboundToFlows.mockResolvedValueOnce({ consumed: true })

    await dispatchInboundThroughAccountBrain(base)

    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(mocks.dispatchBufferedInboundToAiReply).not.toHaveBeenCalled()
    expect(mocks.runAutomationsForTrigger).not.toHaveBeenCalled()
  })

  it('uses the configured message buffer generation without changing the brain', async () => {
    mocks.registerInboundForAiBuffer.mockResolvedValueOnce(7)

    await dispatchInboundThroughAccountBrain({
      ...base,
      channel: 'instagram',
      inboundMessageId: 'ig-1',
    })

    expect(mocks.dispatchInboundToAiReply).not.toHaveBeenCalled()
    expect(mocks.dispatchBufferedInboundToAiReply).toHaveBeenCalledWith({
      accountId: 'account-1',
      conversationId: 'conversation-1',
      contactId: 'contact-1',
      configOwnerUserId: 'user-1',
      inboundMessageId: 'ig-1',
      generation: 7,
    })
  })

  it('still sends image-only turns to the multimodal account agent', async () => {
    await dispatchInboundThroughAccountBrain({
      ...base,
      text: '',
      contentType: 'image',
    })

    expect(mocks.dispatchInboundToAiReply).toHaveBeenCalledOnce()
  })
})
