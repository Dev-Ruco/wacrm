import { beforeEach, describe, expect, it } from 'vitest'
import type { Message } from '@/types'
import {
  cacheThreadMessages,
  cacheThreadViewport,
  getCachedThread,
  resetThreadMemoryForTests,
} from './thread-memory'

function message(id: string, conversationId = 'conversation-a'): Message {
  return {
    id,
    conversation_id: conversationId,
    sender_type: 'customer',
    content_type: 'text',
    content_text: id,
    status: 'delivered',
    created_at: '2026-08-16T18:00:00.000Z',
  }
}

describe('Inbox thread memory', () => {
  beforeEach(() => resetThreadMemoryForTests())

  it('keeps messages and reading position per conversation', () => {
    cacheThreadMessages('conversation-a', [message('m1')])
    cacheThreadViewport('conversation-a', { scrollTop: 420, atBottom: false })

    expect(getCachedThread('conversation-a')).toEqual({
      messages: [message('m1')],
      viewport: { scrollTop: 420, atBottom: false },
    })
    expect(getCachedThread('conversation-b')).toBeNull()
  })

  it('lets an authoritative empty fetch replace an older cached thread', () => {
    cacheThreadMessages('conversation-a', [message('m1')])
    cacheThreadMessages('conversation-a', [])

    expect(getCachedThread('conversation-a')?.messages).toEqual([])
  })

  it('preserves viewport when fresh server messages replace the snapshot', () => {
    cacheThreadViewport('conversation-a', { scrollTop: 180, atBottom: false })
    cacheThreadMessages('conversation-a', [message('m2')])

    expect(getCachedThread('conversation-a')).toEqual({
      messages: [message('m2')],
      viewport: { scrollTop: 180, atBottom: false },
    })
  })
})
