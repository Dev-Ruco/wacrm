import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { dispatchInboundToFlows } from '@/lib/flows/engine'
import {
  dispatchBufferedInboundToAiReply,
  registerInboundForAiBuffer,
} from '@/lib/ai/message-buffer'
import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { dispatchWebhookEvent } from '@/lib/webhooks/deliver'
import { supabaseAdmin } from '@/lib/ai/admin-client'

export type InboundChannel =
  | 'whatsapp'
  | 'website'
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | string

export interface DispatchInboundBrainArgs {
  accountId: string
  conversationId: string
  contactId: string
  configOwnerUserId: string
  inboundMessageId: string
  channel: InboundChannel
  text: string
  contentType: string
  isFirstInboundMessage?: boolean
  contactWasCreated?: boolean
}

/**
 * Channel-neutral post-persistence inbound dispatcher.
 *
 * Connectors own transport-specific concerns (signature validation, sender
 * identity, media download/upload and idempotency). Once a customer message is
 * persisted, every connector can hand the same canonical identifiers to this
 * function. From here on the account brain is shared: Flow -> Automation -> AI.
 *
 * The AI itself remains one account-level configuration. Human takeover is
 * conversation state (`assigned_agent_id` / `ai_autoreply_disabled`) and is
 * enforced inside the same AI dispatcher regardless of channel.
 */
export async function dispatchInboundThroughAccountBrain(
  args: DispatchInboundBrainArgs,
): Promise<void> {
  const db = supabaseAdmin()
  const text = args.text.trim()

  // Every persisted inbound advances the quiet-window generation before any
  // deterministic mechanism. A Flow-consumed turn therefore also invalidates
  // an older pending AI response.
  const generation = await registerInboundForAiBuffer({
    accountId: args.accountId,
    conversationId: args.conversationId,
  })

  const flowResult = await dispatchInboundToFlows({
    accountId: args.accountId,
    userId: args.configOwnerUserId,
    contactId: args.contactId,
    conversationId: args.conversationId,
    message: {
      kind: 'text',
      text,
      meta_message_id: args.inboundMessageId,
    },
    isFirstInboundMessage: args.isFirstInboundMessage === true,
  }).catch((error) => {
    console.error('[channels inbound] flow dispatch failed:', error)
    return { consumed: false }
  })

  const flowConsumed = flowResult.consumed
  const automationTriggers: (
    | 'new_contact_created'
    | 'first_inbound_message'
    | 'new_message_received'
    | 'keyword_match'
  )[] = []

  if (!flowConsumed) automationTriggers.push('new_message_received', 'keyword_match')
  if (args.contactWasCreated) automationTriggers.unshift('new_contact_created')
  if (args.isFirstInboundMessage) automationTriggers.unshift('first_inbound_message')

  for (const triggerType of automationTriggers) {
    await runAutomationsForTrigger({
      accountId: args.accountId,
      triggerType,
      contactId: args.contactId,
      context: {
        message_text: text,
        conversation_id: args.conversationId,
        channel: args.channel,
      },
    }).catch((error) => {
      console.error('[channels inbound] automation dispatch failed:', error)
      return false
    })
  }

  // Deterministic Flows win. Otherwise the exact same account AI dispatcher
  // handles WhatsApp, Website and future connectors. Empty text is still
  // allowed for image turns: buildConversationContext carries the image.
  if (!flowConsumed && (text || args.contentType === 'image')) {
    const dispatchArgs = {
      accountId: args.accountId,
      conversationId: args.conversationId,
      contactId: args.contactId,
      configOwnerUserId: args.configOwnerUserId,
      inboundMessageId: args.inboundMessageId,
    }

    if (generation === null) {
      await dispatchInboundToAiReply(dispatchArgs)
    } else {
      await dispatchBufferedInboundToAiReply({
        ...dispatchArgs,
        generation,
      })
    }
  }

  await dispatchWebhookEvent(db, args.accountId, 'message.received', {
    conversation_id: args.conversationId,
    contact_id: args.contactId,
    external_message_id: args.inboundMessageId,
    channel: args.channel,
    content_type: args.contentType,
    text: args.text,
  }).catch((error) => {
    console.error('[channels inbound] outbound webhook dispatch failed:', error)
  })
}
