import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message'
import { getCustomerServiceWindow } from '@/lib/whatsapp/customer-service-window'

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('agent')

    const limit = checkRateLimit(`send:${userId}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id: conversationIdInput,
      contact_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      interactive_payload,
      reply_to_message_id,
    } = body

    if ((!conversationIdInput && !contact_id) || !message_type) {
      return NextResponse.json(
        {
          error:
            'Either conversation_id or contact_id, plus message_type, are required',
        },
        { status: 400 }
      )
    }

    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        templateName: template_name,
        interactivePayload: interactive_payload,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        )
      }
      throw err
    }

    let conversationId: string | null = null
    let conversationChannel: 'whatsapp' | 'website' = 'whatsapp'

    if (conversationIdInput) {
      const { data, error: convError } = await supabase
        .from('conversations')
        .select('id, channel')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single()

      if (convError || !data) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        )
      }
      conversationId = data.id
      conversationChannel = data.channel === 'website' ? 'website' : 'whatsapp'
    } else {
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle()

      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: 'Contact not found' },
          { status: 404 }
        )
      }

      const resolved = await findOrCreateConversation(
        supabase,
        accountId,
        userId,
        contact_id
      )
      if (!resolved) {
        return NextResponse.json(
          { error: 'Failed to open a conversation for this contact' },
          { status: 500 }
        )
      }
      conversationId = resolved
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    // Website threads use the same Inbox composer, but the reply is persisted
    // directly to Supabase and consumed by the website widget. Meta is never
    // called and WhatsApp's 24-hour customer-service window does not apply.
    if (conversationChannel === 'website') {
      if (message_type !== 'text') {
        return NextResponse.json(
          { error: 'Website chat currently supports text replies only' },
          { status: 400 }
        )
      }

      const text = typeof content_text === 'string' ? content_text.trim() : ''
      if (!text) {
        return NextResponse.json(
          { error: 'content_text is required for website chat' },
          { status: 400 }
        )
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
          reply_to_message_id: reply_to_message_id ?? null,
          created_at: now,
        })
        .select('id')
        .single()

      if (messageError || !message) {
        throw messageError ?? new Error('Failed to persist website chat reply')
      }

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

      return NextResponse.json({
        success: true,
        message_id: message.id,
        channel: 'website',
      })
    }

    // Templates are allowed outside the 24-hour window. All free-form
    // WhatsApp message types require a recent inbound customer message.
    if (message_type !== 'template') {
      try {
        const serviceWindow = await getCustomerServiceWindow(
          supabase,
          conversationId
        )

        if (!serviceWindow.open) {
          return NextResponse.json(
            {
              error:
                'The 24-hour WhatsApp customer-service window is closed. Send an approved template and wait for the customer to reply before sending a free-form message.',
              code: 'customer_service_window_closed',
              requires_template: true,
              window_expires_at: serviceWindow.expiresAt,
            },
            { status: 409 }
          )
        }
      } catch (windowError) {
        console.error('Failed to check WhatsApp service window:', windowError)
        return NextResponse.json(
          { error: 'Failed to verify the WhatsApp service window' },
          { status: 500 }
        )
      }
    }

    try {
      const result = await sendMessageToConversation(supabase, accountId, {
        conversationId,
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        filename,
        templateName: template_name,
        templateLanguage: template_language,
        templateParams: template_params,
        templateMessageParams: template_message_params,
        interactivePayload: interactive_payload,
        replyToMessageId: reply_to_message_id,
      })

      return NextResponse.json({
        success: true,
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.status }
        )
      }
      throw err
    }
  } catch (error) {
    console.error('Error in send POST:', error)
    return toErrorResponse(error)
  }
}

type SendSupabase = Awaited<ReturnType<typeof createClient>>

async function findOrCreateConversation(
  supabase: SendSupabase,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      channel: 'whatsapp',
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating conversation for contact send:', error.message)
    return null
  }

  return created.id
}