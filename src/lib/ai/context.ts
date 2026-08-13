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

/**
 * Fetch the recent conversation in a model-friendly form.
 *
 * A manual AI-context reset is non-destructive: old WhatsApp messages remain
 * visible for audit and for human agents, but messages created before
 * conversations.ai_context_reset_at are excluded from the model context.
 * The same reset marker also invalidates the generic working-state snapshot.
 *
 * Product-image captions are intentionally retained: when a customer
 * uses WhatsApp's Reply action on a product photograph, reply_to_message_id
 * identifies exactly which visual card they selected. The generated user
 * turn then names that parent message explicitly, so the model never has
 * to guess which product "este", "esse" or "quero" refers to.
 */
export async function buildConversationContext(
  db: WacrmSupabaseClient,
  conversationId: string,
  options: {
    limit?: number
    resolveImage?: ResolveAiImage
  } = {},
): Promise<ChatMessage[]> {
  const { limit = aiContextMessageLimit(), resolveImage } = options
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

  const resetAt =
    typeof conversation?.ai_context_reset_at === 'string' && conversation.ai_context_reset_at
      ? conversation.ai_context_reset_at
      : null
  if (resetAt) {
    query = query.gt('created_at', resetAt)
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit)

  if (error) throw error

  const rows = ((data ?? []) as DbMessage[]).reverse()
  const byId = new Map(rows.map((message) => [message.id, message]))

  // A quoted parent can fall outside this query's window: it may be a
  // content_type excluded above (document/audio/video have no caption to
  // read but should still be nameable when quoted), or simply older than
  // `limit`/`ai_context_reset_at`. Without this, "O cliente respondeu a
  // esta mensagem" silently loses its reference and the model has to guess
  // what "isto"/"esse" means.
  const missingParentIds = [
    ...new Set(
      rows
        .filter((message) => message.sender_type === 'customer' && message.reply_to_message_id)
        .map((message) => message.reply_to_message_id as string)
        .filter((id) => !byId.has(id)),
    ),
  ]
  if (missingParentIds.length > 0) {
    const { data: parents } = await db
      .from('messages')
      .select('id, sender_type, content_type, content_text, media_url, reply_to_message_id')
      .in('id', missingParentIds)
    for (const parent of (parents ?? []) as DbMessage[]) {
      byId.set(parent.id, parent)
    }
  }

  const imageIds = new Set(
    rows
      .filter(
        (message) =>
          message.sender_type === 'customer' &&
          message.content_type === 'image' &&
          Boolean(message.media_url),
      )
      .slice(-MAX_CONTEXT_IMAGES)
      .map((message) => message.id),
  )

  const mapped = await Promise.all(
    rows.map(async (message): Promise<ChatMessage | null> => {
      const readableText = readableMessageText(message)
      if (!readableText) return null

      let content: ChatContent = readableText
      if (resolveImage && imageIds.has(message.id) && message.media_url) {
        const image = await resolveImage(message.media_url)
        if (image) {
          // Image-first follows Anthropic's current vision guidance; OpenAI
          // accepts either order. The text placeholder is kept so retrying a
          // text-only model still leaves useful conversational context.
          content = [image, { type: 'text', text: readableText }]
        }
      }

      if (message.sender_type === 'customer' && message.reply_to_message_id) {
        const parent = byId.get(message.reply_to_message_id)
        const parentText = parent ? readableMessageText(parent) : null
        if (parentText) {
          content = prependText(
            content,
            [
              'O cliente respondeu directamente a esta mensagem/produto anterior:',
              parentText,
              '',
              'Resposta actual do cliente:',
            ].join('\n'),
          )
        }
      }

      return {
        role: message.sender_type === 'customer' ? 'user' : 'assistant',
        content,
      }
    }),
  )

  const messages = mapped.filter((message): message is ChatMessage => Boolean(message))
  const accountId =
    typeof conversation?.account_id === 'string' ? conversation.account_id : null
  const latestInboundRow = [...rows]
    .reverse()
    .find((message) => message.sender_type === 'customer')

  if (!accountId || !latestInboundRow || messages.length === 0) return messages

  // Load the last confirmed state immediately. Then start one idempotent
  // extraction for this newest inbound. We wait briefly for the fresh state,
  // but never let state maintenance hold a customer reply for more than the
  // configured budget; if it takes longer, the previous state plus the raw
  // current message is still enough for this turn and the refresh can finish
  // for the next one.
  let stateResult = await loadWorkingStateForContext({
    db,
    accountId,
    conversationId,
    contextResetAt: resetAt,
  }).catch((error) => {
    console.warn('[working state] context load failed:', error)
    return null
  })

  if (!stateResult || stateResult.sourceMessageId !== latestInboundRow.id) {
    const refresh = refreshWorkingConversationState({
      db,
      accountId,
      conversationId,
      contextResetAt: resetAt,
      sourceMessageId: latestInboundRow.id,
      messages,
    }).catch((error) => {
      console.warn('[working state] background refresh failed:', error)
      return null
    })

    const waitMs = workingStateWaitMs()
    if (waitMs > 0) {
      const fresh = await Promise.race([
        refresh,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), waitMs)),
      ])
      if (fresh) {
        stateResult = { state: fresh, sourceMessageId: latestInboundRow.id }
      }
    } else {
      void refresh
    }
  }

  const internalContext = stateResult
    ? workingConversationStatePrompt(stateResult.state)
    : null
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
