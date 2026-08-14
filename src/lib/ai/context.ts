import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { ResolveAiImage } from './image-context'
import { type ChatContent, type ChatMessage } from './types'
import { aiContextMessageLimit } from './defaults'
import {
  IMAGE_NO_CAPTION_PLACEHOLDER,
  IMAGE_PLACEHOLDER,
  INTERACTIVE_PLACEHOLDER,
  MEDIA_PLACEHOLDER,
} from './history-annotations'
import { getAgentTraceContext } from './trace-context'
import { workingConversationStatePrompt } from './working-state'
import {
  loadWorkingStateForContext,
  refreshWorkingConversationState,
} from './working-state-refresh'

interface DbMessage {
  id: string
  sender_type: 'customer' | 'agent' | 'bot'
  content_type: string
  content_text: string | null
  media_url: string | null
  reply_to_message_id: string | null
}

type ChatMessageWithInternalContext = ChatMessage & { internalContext?: string }
const MAX_CONTEXT_IMAGES = 3
const DEFAULT_WORKING_STATE_WAIT_MS = 2_000

function workingStateWaitMs(): number {
  const raw = Number(process.env.AI_WORKING_STATE_WAIT_MS)
  if (!Number.isFinite(raw)) return DEFAULT_WORKING_STATE_WAIT_MS
  return Math.min(5_000, Math.max(0, Math.floor(raw)))
}

function readableMessageText(message: DbMessage): string | null {
  const text = message.content_text?.trim()
  if (message.content_type === 'image') {
    return text ? `${IMAGE_PLACEHOLDER}\nLegenda: ${text}` : IMAGE_NO_CAPTION_PLACEHOLDER
  }
  if (message.content_type === 'interactive') {
    if (!text) return null
    return `${INTERACTIVE_PLACEHOLDER}\n${text}`
  }
  const placeholder = MEDIA_PLACEHOLDER[message.content_type]
  if (placeholder) return text || placeholder
  return text || null
}

function prependText(content: ChatContent, text: string): ChatContent {
  if (typeof content === 'string') return `${text}\n${content}`
  return [{ type: 'text', text }, ...content]
}

export async function buildConversationContext(
  db: WacrmSupabaseClient,
  conversationId: string,
  options: { limit?: number; resolveImage?: ResolveAiImage } = {},
): Promise<ChatMessage[]> {
  const { limit = aiContextMessageLimit(), resolveImage } = options
  const trace = getAgentTraceContext()
  const { data: conversation, error: conversationError } = await db
    .from('conversations')
    .select('account_id, ai_context_reset_at')
    .eq('id', conversationId)
    .maybeSingle()
  if (conversationError) throw conversationError

  let query = db
    .from('messages')
    .select('id, sender_type, content_type, content_text, media_url, reply_to_message_id')
    .eq('conversation_id', conversationId)
    .in('content_type', ['text', 'image', 'interactive'])
  const resetAt = typeof conversation?.ai_context_reset_at === 'string' && conversation.ai_context_reset_at
    ? conversation.ai_context_reset_at
    : null
  if (resetAt) query = query.gt('created_at', resetAt)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  const rows = ((data ?? []) as DbMessage[]).reverse()
  const byId = new Map(rows.map((message) => [message.id, message]))
  const missingParentIds = [...new Set(rows
    .filter((message) => message.sender_type === 'customer' && message.reply_to_message_id)
    .map((message) => message.reply_to_message_id as string)
    .filter((id) => !byId.has(id)))]
  if (missingParentIds.length > 0) {
    const { data: parents } = await db
      .from('messages')
      .select('id, sender_type, content_type, content_text, media_url, reply_to_message_id')
      .in('id', missingParentIds)
    for (const parent of (parents ?? []) as DbMessage[]) byId.set(parent.id, parent)
  }

  const imageIds = new Set(rows
    .filter((message) => message.sender_type === 'customer' && message.content_type === 'image' && Boolean(message.media_url))
    .slice(-MAX_CONTEXT_IMAGES)
    .map((message) => message.id))

  const mapped = await Promise.all(rows.map(async (message): Promise<ChatMessage | null> => {
    const readableText = readableMessageText(message)
    if (!readableText) return null
    let content: ChatContent = readableText
    if (resolveImage && imageIds.has(message.id) && message.media_url) {
      const image = await resolveImage(message.media_url)
      if (image) content = [image, { type: 'text', text: readableText }]
    }
    if (message.sender_type === 'customer' && message.reply_to_message_id) {
      const parent = byId.get(message.reply_to_message_id)
      const parentText = parent ? readableMessageText(parent) : null
      if (parentText) {
        content = prependText(content, [
          'O cliente respondeu directamente a esta mensagem/produto anterior:',
          parentText,
          '',
          'Resposta actual do cliente:',
        ].join('\n'))
      }
    }
    return { role: message.sender_type === 'customer' ? 'user' : 'assistant', content }
  }))

  const messages = mapped.filter((message): message is ChatMessage => Boolean(message))
  trace?.recordEvent('context_loaded', 'Contexto da conversa carregado', {
    message_count: messages.length,
    customer_image_count: imageIds.size,
    context_reset_active: Boolean(resetAt),
  })

  const accountId = typeof conversation?.account_id === 'string' ? conversation.account_id : null
  const latestInboundRow = [...rows].reverse().find((message) => message.sender_type === 'customer')
  if (!accountId || !latestInboundRow || messages.length === 0) return messages

  let stateResult = await loadWorkingStateForContext({ db, accountId, conversationId, contextResetAt: resetAt }).catch((loadError) => {
    console.warn('[working state] context load failed:', loadError)
    return null
  })
  const priorSourceMessageId = stateResult?.sourceMessageId ?? null

  if (!stateResult || stateResult.sourceMessageId !== latestInboundRow.id) {
    const refresh = refreshWorkingConversationState({
      db,
      accountId,
      conversationId,
      contextResetAt: resetAt,
      sourceMessageId: latestInboundRow.id,
      messages,
    }).catch((refreshError) => {
      console.warn('[working state] background refresh failed:', refreshError)
      return null
    })
    const waitMs = workingStateWaitMs()
    if (waitMs > 0) {
      const fresh = await Promise.race([
        refresh,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
      ])
      if (fresh) stateResult = { state: fresh, sourceMessageId: latestInboundRow.id }
    } else {
      void refresh
    }
  }

  if (stateResult) {
    const refreshed = stateResult.sourceMessageId === latestInboundRow.id && priorSourceMessageId !== latestInboundRow.id
    trace?.recordEvent(refreshed ? 'working_state_updated' : 'working_state_loaded', refreshed ? 'Estado actual da conversa actualizado' : 'Estado actual da conversa carregado', {
      revision: stateResult.state.revision,
      current_goal: stateResult.state.currentGoal,
      constraints: stateResult.state.constraints,
      preferences: stateResult.state.preferences,
      exclusions: stateResult.state.exclusions,
      selected_entity: stateResult.state.selectedEntity,
      pending_question: stateResult.state.pendingQuestion,
      status: stateResult.state.status,
      fresh_for_current_message: refreshed,
    })
  }

  const internalContext = stateResult ? workingConversationStatePrompt(stateResult.state) : null
  if (!internalContext) return messages
  const lastUserIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === 'user')?.index
  if (lastUserIndex === undefined) return messages
  return messages.map((message, index) =>
    index === lastUserIndex
      ? ({ ...message, internalContext } as ChatMessageWithInternalContext)
      : message,
  )
}
