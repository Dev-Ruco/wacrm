import webpush from 'web-push'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'

let configured = false

function vapidConfig() {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT?.trim()
  if (!publicKey || !privateKey || !subject) return null
  return { publicKey, privateKey, subject }
}

function configureWebPush() {
  const config = vapidConfig()
  if (!config) return null
  if (!configured) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey)
    configured = true
  }
  return config
}

export function websitePushPublicKey(): string | null {
  return vapidConfig()?.publicKey ?? null
}

export async function sendWebsitePush(args: {
  db: WacrmSupabaseClient
  conversationId: string
  title: string
  body: string
  url?: string
}): Promise<number> {
  if (!configureWebPush()) return 0

  const { data, error } = await args.db
    .from('website_chat_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('conversation_id', args.conversationId)
  if (error) throw error

  let sent = 0
  for (const subscription of data ?? []) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          title: args.title,
          body: args.body,
          url: args.url || '/',
          conversation_id: args.conversationId,
        }),
        { TTL: 60 * 60 },
      )
      sent += 1
    } catch (error) {
      const statusCode = (error as { statusCode?: number } | null)?.statusCode
      if (statusCode === 404 || statusCode === 410) {
        await args.db.from('website_chat_push_subscriptions').delete().eq('id', subscription.id)
        continue
      }
      console.error('[site-chat push] delivery failed:', error)
    }
  }
  return sent
}
