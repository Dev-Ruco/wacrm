import { supabaseAdmin } from './admin-client'
import { dispatchInboundToAiReply, type DispatchArgs } from './auto-reply'
import { loadAiConfig } from './config'

interface BufferedDispatchArgs extends DispatchArgs {
  generation: number
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function automatedReplyAlreadySent(args: {
  accountId: string
  conversationId: string
  inboundMessageId: string
}): Promise<boolean> {
  const db = supabaseAdmin()
  const { data: inbound, error: inboundError } = await db
    .from('messages')
    .select('created_at, conversations!inner(account_id)')
    .eq('conversation_id', args.conversationId)
    .eq('message_id', args.inboundMessageId)
    .eq('conversations.account_id', args.accountId)
    .maybeSingle()

  if (inboundError || !inbound?.created_at) {
    if (inboundError) {
      console.warn('[ai message buffer] inbound reply-check lookup failed:', inboundError)
    }
    return false
  }

  const { data: outbound, error: outboundError } = await db
    .from('messages')
    .select('id')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'bot')
    .gt('created_at', inbound.created_at)
    .limit(1)
    .maybeSingle()

  if (outboundError) {
    console.warn('[ai message buffer] outbound reply-check lookup failed:', outboundError)
    return false
  }
  return Boolean(outbound)
}

/**
 * Atomically marks a newly persisted inbound message as the latest AI input.
 * This is called for every inbound message, including messages consumed by a
 * Flow, so deterministic handling also invalidates an older pending AI reply.
 */
export async function registerInboundForAiBuffer(args: {
  accountId: string
  conversationId: string
}): Promise<number | null> {
  const { data, error } = await supabaseAdmin().rpc('schedule_ai_dispatch', {
    p_account_id: args.accountId,
    p_conversation_id: args.conversationId,
  })

  if (error) {
    console.error('[ai message buffer] schedule_ai_dispatch failed:', error)
    return null
  }

  const generation = Number(data)
  if (!Number.isSafeInteger(generation) || generation < 1) {
    console.error('[ai message buffer] invalid dispatch generation:', data)
    return null
  }

  return generation
}

/**
 * Waits for the account's quiet window, then atomically claims this generation.
 * A newer inbound increments the generation and makes this invocation stale;
 * simultaneous claim attempts are reduced to exactly one winner by the RPC.
 *
 * After the claim, a final outbound check prevents the AI from adding a second
 * reply when a Flow or deterministic automation already answered this same
 * inbound during the quiet window.
 */
export async function dispatchBufferedInboundToAiReply(
  args: BufferedDispatchArgs
): Promise<void> {
  const {
    accountId,
    conversationId,
    contactId,
    configOwnerUserId,
    generation,
  } = args

  try {
    const db = supabaseAdmin()
    const config = await loadAiConfig(db, accountId)
    if (!config?.autoReplyEnabled) return

    await wait(config.bufferWindowSeconds * 1_000)

    const { data: claimed, error } = await db.rpc('claim_ai_dispatch', {
      p_account_id: accountId,
      p_conversation_id: conversationId,
      p_generation: generation,
    })

    if (error) {
      console.error('[ai message buffer] claim_ai_dispatch failed:', error)
      return
    }
    if (claimed !== true) {
      console.info(
        `[ai message buffer] conversation ${conversationId} generation ${generation} superseded`
      )
      return
    }

    if (
      await automatedReplyAlreadySent({
        accountId,
        conversationId,
        inboundMessageId: args.inboundMessageId,
      })
    ) {
      console.info(
        `[ai message buffer] conversation ${conversationId} already answered after inbound; AI dispatch suppressed`
      )
      return
    }

    await dispatchInboundToAiReply({
      accountId,
      conversationId,
      contactId,
      configOwnerUserId,
      inboundMessageId: args.inboundMessageId,
    })
  } catch (error) {
    console.error('[ai message buffer] dispatch failed:', error)
  }
}
