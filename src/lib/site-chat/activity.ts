import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type WebsiteActivityState =
  | 'analyzing'
  | 'searching_catalog'
  | 'writing'
  | 'human_typing'

const ACTIVITY_TTL_MS = 45_000

export async function setWebsiteActivity(
  db: WacrmSupabaseClient,
  conversationId: string,
  state: WebsiteActivityState | null,
): Promise<void> {
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
