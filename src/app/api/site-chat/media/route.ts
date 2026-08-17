import { createHash, randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'

const CHAT_MEDIA_BUCKET = 'chat-media'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_AUDIO_BYTES = 16 * 1024 * 1024
const MAX_CAPTION_LENGTH = 1024

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/aac',
  'audio/mp4',
  'audio/amr',
])

type MediaKind = 'image' | 'audio'

type WebsiteChannelRow = {
  id: string
  account_id: string
  public_key: string
  allowed_origins: string[] | null
  is_active: boolean
}

function requestOrigin(request: Request): string {
  return request.headers.get('origin')?.replace(/\/$/, '') ?? ''
}

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, origin: string) {
  return NextResponse.json(body, { status, headers: corsHeaders(origin) })
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function normaliseMimeType(value: string) {
  return value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function extensionForMimeType(mimeType: string) {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/aac': 'aac',
    'audio/mp4': 'm4a',
    'audio/amr': 'amr',
  }
  return extensions[mimeType] ?? 'bin'
}

async function resolveChannel(
  admin: ReturnType<typeof createAdminClient>,
  publicKey: string | null,
  origin: string,
): Promise<WebsiteChannelRow | null> {
  let query = admin
    .from('website_channels')
    .select('id, account_id, public_key, allowed_origins, is_active')
    .eq('is_active', true)

  if (publicKey) {
    query = query.eq('public_key', publicKey)
    const { data } = await query.maybeSingle()
    if (!data) return null

    const channel = data as WebsiteChannelRow
    const allowed = channel.allowed_origins ?? []
    if (allowed.length > 0 && (!origin || !allowed.includes(origin))) return null
    return channel
  }

  if (!origin) return null
  const { data } = await query.contains('allowed_origins', [origin]).limit(2)
  if (!data || data.length !== 1) return null
  return data[0] as WebsiteChannelRow
}

async function getSession(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  visitorId: string,
  sessionToken: string,
) {
  const { data } = await admin
    .from('website_chat_sessions')
    .select('id, conversation_id')
    .eq('website_channel_id', channelId)
    .eq('visitor_id', visitorId)
    .eq('session_token_hash', hashToken(sessionToken))
    .maybeSingle()

  return data as { id: string; conversation_id: string } | null
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(requestOrigin(request)) })
}

export async function POST(request: Request) {
  const origin = requestOrigin(request)

  try {
    const form = await request.formData()
    const visitorId = String(form.get('visitor_id') ?? '').trim().slice(0, 128)
    const sessionToken = String(form.get('session_token') ?? '').trim()
    const publicKeyRaw = String(form.get('channel_key') ?? '').trim()
    const publicKey = publicKeyRaw ? publicKeyRaw.slice(0, 128) : null
    const kind = String(form.get('kind') ?? '').trim() as MediaKind
    const caption = String(form.get('caption') ?? '').trim()
    const fileValue = form.get('file')

    if (!visitorId || !sessionToken) {
      return json({ error: 'visitor_id and session_token are required' }, 400, origin)
    }
    if (kind !== 'image' && kind !== 'audio') {
      return json({ error: 'kind must be image or audio' }, 400, origin)
    }
    if (!(fileValue instanceof File)) {
      return json({ error: 'file is required' }, 400, origin)
    }
    if (caption.length > MAX_CAPTION_LENGTH) {
      return json({ error: `Caption exceeds ${MAX_CAPTION_LENGTH} characters` }, 400, origin)
    }

    const mimeType = normaliseMimeType(fileValue.type)
    const allowedMimeTypes = kind === 'image' ? IMAGE_MIME_TYPES : AUDIO_MIME_TYPES
    if (!allowedMimeTypes.has(mimeType)) {
      return json({ error: `Unsupported ${kind} format` }, 415, origin)
    }

    const sizeLimit = kind === 'image' ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES
    if (fileValue.size <= 0 || fileValue.size > sizeLimit) {
      const limitMb = Math.floor(sizeLimit / 1024 / 1024)
      return json({ error: `${kind} must be no larger than ${limitMb} MB` }, 413, origin)
    }

    const rate = checkRateLimit(`site-chat-media:${origin}:${visitorId}`, RATE_LIMITS.publicApi)
    if (!rate.success) return json({ error: 'Too many requests' }, 429, origin)

    const admin = createAdminClient()
    const channel = await resolveChannel(admin, publicKey, origin)
    if (!channel) return json({ error: 'Website chat channel not found for this site' }, 404, origin)

    const session = await getSession(admin, channel.id, visitorId, sessionToken)
    if (!session) return json({ error: 'Invalid chat session' }, 401, origin)

    const now = new Date().toISOString()
    const extension = extensionForMimeType(mimeType)
    const path = `account-${channel.account_id}/website/${channel.id}/${randomUUID()}.${extension}`
    const bytes = Buffer.from(await fileValue.arrayBuffer())

    const { error: uploadError } = await admin.storage
      .from(CHAT_MEDIA_BUCKET)
      .upload(path, bytes, {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: false,
      })

    if (uploadError) throw uploadError

    const {
      data: { publicUrl },
    } = admin.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path)

    const { data: current, error: currentError } = await admin
      .from('conversations')
      .select('unread_count')
      .eq('id', session.conversation_id)
      .eq('account_id', channel.account_id)
      .eq('channel', 'website')
      .single()

    if (currentError) {
      await admin.storage.from(CHAT_MEDIA_BUCKET).remove([path]).catch(() => {})
      throw currentError
    }

    const { data: message, error: messageError } = await admin
      .from('messages')
      .insert({
        conversation_id: session.conversation_id,
        sender_type: 'customer',
        content_type: kind,
        content_text: caption || null,
        media_url: publicUrl,
        message_id: `web_${randomUUID()}`,
        status: 'delivered',
        created_at: now,
      })
      .select('id, sender_type, content_type, content_text, media_url, status, created_at')
      .single()

    if (messageError || !message) {
      await admin.storage.from(CHAT_MEDIA_BUCKET).remove([path]).catch(() => {})
      throw messageError ?? new Error('Failed to persist website media message')
    }

    const preview = caption || (kind === 'image' ? '📷 Fotografia' : '🎤 Áudio')
    const { error: conversationError } = await admin
      .from('conversations')
      .update({
        last_message_text: preview,
        last_message_at: now,
        unread_count: Number(current?.unread_count ?? 0) + 1,
        status: 'open',
        updated_at: now,
      })
      .eq('id', session.conversation_id)
      .eq('account_id', channel.account_id)
      .eq('channel', 'website')

    if (conversationError) throw conversationError

    await admin
      .from('website_chat_sessions')
      .update({ last_seen_at: now })
      .eq('id', session.id)

    return json({ ok: true, message }, 200, origin)
  } catch (error) {
    console.error('[site-chat/media] POST failed', error)
    return json({ error: 'Unable to send website chat media' }, 500, origin)
  }
}
