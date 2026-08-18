import { supabaseAdmin } from './admin-client'
import { dispatchInboundToAiReply, type DispatchArgs } from './auto-reply'
import { loadAiConfig } from './config'
import { engineSendTypingIndicator } from '@/lib/flows/meta-send'

interface BufferedDispatchArgs extends DispatchArgs {
  generation: number
}

const ADAPTIVE_QUIET_WINDOW_MS = 2_500

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

async function adaptiveBufferDelayMs(args: {
  accountId: string
  conversationId: string
  generation: number
  maxWindowSeconds: number
}): Promise<number | null> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('conversations')
    .select('ai_dispatch_generation, ai_dispatch_pending_since, ai_dispatch_burst_started_at')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()

  if (error || !data) {
    if (error) console.warn('[ai message buffer] adaptive state lookup failed:', error)
    return Math.min(args.maxWindowSeconds * 1_000, ADAPTIVE_QUIET_WINDOW_MS)
  }

  if (Number(data.ai_dispatch_generation) !== args.generation) return null

  const now = Date.now()
  const pendingSince = timestampMs(data.ai_dispatch_pending_since) ?? now
  const burstStartedAt =
    timestampMs(data.ai_dispatch_burst_started_at) ?? pendingSince
  const maxWindowMs = Math.max(1_000, args.maxWindowSeconds * 1_000)
  const quietWindowMs = Math.min(maxWindowMs, ADAPTIVE_QUIET_WINDOW_MS)
  const quietRemaining = Math.max(0, quietWindowMs - (now - pendingSince))
  const burstRemaining = Math.max(0, maxWindowMs - (now - burstStartedAt))

  return Math.min(quietRemaining, burstRemaining)
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
 * Adaptive rapid-message buffer.
 *
 * The configured buffer is a maximum grouping window, not a fixed delay for
 * every customer turn. A lone message normally waits only ~2.5 seconds. Each
 * new fragment creates a new generation and resets the short quiet period,
 * while the persisted burst start prevents a long stream from postponing the
 * agent forever. Only the newest generation can claim the dispatch.
 *
 * Presence is shown before the quiet wait. On WhatsApp this also marks the
 * inbound as read, so the customer gets immediate feedback instead of several
 * seconds of apparent silence.
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

    await engineSendTypingIndicator({
      accountId,
      inboundMessageId: args.inboundMessageId,
    }).catch((error) => {
      console.warn('[ai message buffer] early presence failed:', error)
    })

    const delayMs = await adaptiveBufferDelayMs({
      accountId,
      conversationId,
      generation,
      maxWindowSeconds: config.bufferWindowSeconds,
    })
    if (delayMs === null) {
      console.info(
        `[ai message buffer] conversation ${conversationId} generation ${generation} superseded before wait`
      )
      return
    }
    if (delayMs > 0) await wait(delayMs)

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
