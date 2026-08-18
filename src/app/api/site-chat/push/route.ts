import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { websitePushPublicKey } from '@/lib/site-chat/push'
import {
  getWebsiteSession,
  requestOrigin,
  resolveWebsiteChannel,
  siteChatCorsHeaders,
  siteChatJson,
} from '@/lib/site-chat/public-server'

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: siteChatCorsHeaders(requestOrigin(request)),
  })
}

async function resolveRequest(request: Request, body?: Record<string, unknown>) {
  const origin = requestOrigin(request)
  const url = new URL(request.url)
  const visitorId = String(body?.visitor_id ?? url.searchParams.get('visitor_id') ?? '').slice(0, 128)
  const sessionToken = String(body?.session_token ?? url.searchParams.get('session_token') ?? '')
  const publicKeyRaw = body?.channel_key ?? url.searchParams.get('channel_key')
  const publicKey = typeof publicKeyRaw === 'string' ? publicKeyRaw.slice(0, 128) : null

  if (!visitorId || !sessionToken) return { origin, error: 'visitor_id and session_token are required' as const }
  const admin = createAdminClient()
  const channel = await resolveWebsiteChannel(admin, publicKey, origin)
  if (!channel) return { origin, error: 'Website chat channel not found for this site' as const }
  const session = await getWebsiteSession(admin, channel.id, visitorId, sessionToken)
  if (!session) return { origin, error: 'Invalid chat session' as const }
  return { origin, admin, channel, session, visitorId }
}

export async function GET(request: Request) {
  try {
    const resolved = await resolveRequest(request)
    if ('error' in resolved) return siteChatJson({ error: resolved.error }, 401, resolved.origin)
    const publicKey = websitePushPublicKey()
    return siteChatJson({
      enabled: Boolean(publicKey),
      public_key: publicKey,
    }, 200, resolved.origin)
  } catch (error) {
    console.error('[site-chat push] GET failed:', error)
    return siteChatJson({ error: 'Unable to load notification settings' }, 500, requestOrigin(request))
  }
}

export async function POST(request: Request) {
  const origin = requestOrigin(request)
  try {
    const body = await request.json() as Record<string, unknown>
    const resolved = await resolveRequest(request, body)
    if ('error' in resolved) return siteChatJson({ error: resolved.error }, 401, resolved.origin)

    const action = body.action === 'unsubscribe' ? 'unsubscribe' : 'subscribe'
    const subscription = body.subscription
    if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
      return siteChatJson({ error: 'subscription is required' }, 400, origin)
    }
    const raw = subscription as Record<string, unknown>
    const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim().slice(0, 4000) : ''
    const keys = raw.keys && typeof raw.keys === 'object' && !Array.isArray(raw.keys)
      ? raw.keys as Record<string, unknown>
      : {}
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim().slice(0, 1000) : ''
    const auth = typeof keys.auth === 'string' ? keys.auth.trim().slice(0, 1000) : ''
    if (!endpoint || !endpoint.startsWith('https://')) {
      return siteChatJson({ error: 'Invalid push subscription endpoint' }, 400, origin)
    }

    if (action === 'unsubscribe') {
      await resolved.admin
        .from('website_chat_push_subscriptions')
        .delete()
        .eq('website_channel_id', resolved.channel.id)
        .eq('visitor_id', resolved.visitorId)
        .eq('endpoint', endpoint)
      return siteChatJson({ ok: true, subscribed: false }, 200, origin)
    }

    if (!p256dh || !auth || !websitePushPublicKey()) {
      return siteChatJson({ error: 'Push notifications are not configured' }, 503, origin)
    }

    const now = new Date().toISOString()
    const { error } = await resolved.admin
      .from('website_chat_push_subscriptions')
      .upsert({
        account_id: resolved.channel.account_id,
        website_channel_id: resolved.channel.id,
        conversation_id: resolved.session.conversation_id,
        visitor_id: resolved.visitorId,
        endpoint,
        p256dh,
        auth,
        updated_at: now,
        last_seen_at: now,
      }, { onConflict: 'website_channel_id,endpoint' })
    if (error) throw error

    return siteChatJson({ ok: true, subscribed: true }, 200, origin)
  } catch (error) {
    console.error('[site-chat push] POST failed:', error)
    return siteChatJson({ error: 'Unable to save notification settings' }, 500, origin)
  }
}
