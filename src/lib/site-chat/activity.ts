import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type WebsiteActivityState =
  | 'analyzing'
  | 'searching_catalog'
  | 'writing'
  | 'human_typing'

const ACTIVITY_TTL_MS = 45_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validConversationId(value: string): boolean {
  return UUID_RE.test(value.trim())
}

export async function setWebsiteActivity(
  db: WacrmSupabaseClient,
  conversationId: string,
  state: WebsiteActivityState | null,
): Promise<void> {
  // Activity is best-effort telemetry. Some site-chat turns can run before a
  // durable conversation exists; never send an empty/malformed UUID to
  // Postgres just to update a typing indicator.
  if (!validConversationId(conversationId)) return

  const now = new Date().toISOString()
  const { error } = await db
    .from('conversations')
    .update({
      website_activity_state: state,
      website_activity_updated_at: state ? now : null,
      updated_at: now,
    })
    .eq('id', conversationId)
    .eq('channel', 'website')

  if (error) throw new Error(`website activity update failed: ${error.message}`)
}

export async function setWebsiteActivityIfWebsite(
  db: WacrmSupabaseClient,
  conversationId: string,
  state: WebsiteActivityState | null,
): Promise<boolean> {
  if (!validConversationId(conversationId)) return false

  const { data, error } = await db
    .from('conversations')
    .select('channel')
    .eq('id', conversationId)
    .maybeSingle()
  if (error) throw error
  if (data?.channel !== 'website') return false
  await setWebsiteActivity(db, conversationId, state)
  return true
}

export function freshWebsiteActivity(input: {
  state?: string | null
  updatedAt?: string | null
}): WebsiteActivityState | null {
  const state = input.state
  if (
    state !== 'analyzing' &&
    state !== 'searching_catalog' &&
    state !== 'writing' &&
    state !== 'human_typing'
  ) return null

  if (!input.updatedAt) return null
  const updated = new Date(input.updatedAt).getTime()
  if (!Number.isFinite(updated) || Date.now() - updated > ACTIVITY_TTL_MS) return null
  return state
}
