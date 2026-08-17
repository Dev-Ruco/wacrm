import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

const MAX_MESSAGE_LENGTH = 4000

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`site-send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json()
    const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : ''
    const text = typeof body?.content_text === 'string' ? body.content_text.trim() : ''
    const replyToMessageId = typeof body?.reply_to_message_id === 'string'
      ? body.reply_to_message_id
      : null

    if (!conversationId || !text) {
      return NextResponse.json({ error: 'conversation_id and content_text are required' }, { status: 400 })
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return NextResponse.json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 })
    }

    const { data: conversation, error: conversationError } = await supabase
      .from('conversations')
      .select('id, channel')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .single()

    if (conversationError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
    }
    if (conversation.channel !== 'website') {
      return NextResponse.json({ error: 'This endpoint only sends website chat messages' }, { status: 400 })
    }

    const now = new Date().toISOString()
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: userId,
        content_type: 'text',
        content_text: text,
        status: 'sent',
        reply_to_message_id: replyToMessageId,
        created_at: now,
      })
      .select('*')
      .single()

    if (messageError) throw messageError

    const { error: updateError } = await supabase
      .from('conversations')
      .update({
        last_message_text: text,
        last_message_at: now,
        updated_at: now,
      })
      .eq('id', conversationId)
      .eq('account_id', accountId)

    if (updateError) throw updateError

    return NextResponse.json({ ok: true, message })
  } catch (error) {
    return toErrorResponse(error)
  }
}
