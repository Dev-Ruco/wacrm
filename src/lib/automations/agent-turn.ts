import { dispatchInboundToAiReply } from '@/lib/ai/auto-reply'
import { supabaseAdmin } from './admin-client'

export interface AutomationAgentTurnArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  instruction: string
  /**
   * Optional ISO timestamp used by delayed follow-ups. If a newer customer
   * message exists, the automation is stale and the agent is not invoked.
   */
  onlyIfNoCustomerReplyAfter?: string
}

export interface AutomationAgentTurnResult {
  invoked: boolean
  reason: 'invoked' | 'customer_replied' | 'no_customer_message'
}

/**
 * Ask the account's existing AI agent to take a conversational turn.
 *
 * This is intentionally a bridge, not a second automation-specific model.
 * Identity, behaviour, Skills, Knowledge, memory, CRM context, commercial
 * strategy, tools, guardrails and tracing all remain owned by the same
 * dispatchInboundToAiReply runtime used for ordinary inbound messages.
 */
export async function runAutomationAgentTurn(
  args: AutomationAgentTurnArgs,
): Promise<AutomationAgentTurnResult> {
  const instruction = args.instruction.trim()
  if (!instruction) throw new Error('agent message needs an objective/instruction')

  const db = supabaseAdmin()

  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('id, contact_id')
    .eq('id', args.conversationId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (conversationError || !conversation || conversation.contact_id !== args.contactId) {
    throw new Error('agent message conversation/contact mismatch')
  }

  // Meta's native typing indicator is tied to a customer wamid. Use the most
  // recent inbound message in this conversation. Website conversations also
  // reuse this identifier to resolve the conversation and expose "writing".
  const { data: inbound, error: inboundError } = await db
    .from('messages')
    .select('message_id, created_at')
    .eq('conversation_id', args.conversationId)
    .eq('sender_type', 'customer')
    .not('message_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (inboundError) throw new Error(`agent message inbound lookup failed: ${inboundError.message}`)
  if (!inbound?.message_id) {
    return { invoked: false, reason: 'no_customer_message' }
  }

  if (args.onlyIfNoCustomerReplyAfter) {
    const baseline = Date.parse(args.onlyIfNoCustomerReplyAfter)
    const latestInboundAt = Date.parse(inbound.created_at)
    if (Number.isFinite(baseline) && Number.isFinite(latestInboundAt) && latestInboundAt > baseline) {
      console.info('[automations] stale agent follow-up suppressed:', {
        conversationId: args.conversationId,
        baseline: args.onlyIfNoCustomerReplyAfter,
        latestInboundAt: inbound.created_at,
      })
      return { invoked: false, reason: 'customer_replied' }
    }
  }

  await dispatchInboundToAiReply({
    accountId: args.accountId,
    conversationId: args.conversationId,
    contactId: args.contactId,
    inboundMessageId: inbound.message_id,
    configOwnerUserId: args.userId,
    initiatedByAutomation: true,
    automationInstruction: instruction,
  })

  return { invoked: true, reason: 'invoked' }
}
