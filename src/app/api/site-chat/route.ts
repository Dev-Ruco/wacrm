import { createHash, randomBytes, randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { isWebsiteOriginAllowed } from '@/lib/site-chat/origin'

const MAX_MESSAGE_LENGTH = 4000
const SESSION_MAX_MESSAGES = 200

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
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
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

function makeVisitorPhone(visitorId: string) {
  const digest = createHash('sha256').update(visitorId).digest('hex')
  const numeric = digest
    .split('')
    .map((character) => String(Number.parseInt(character, 16) % 10))
    .join('')
    .slice(0, 12)
    .padEnd(12, '0')
  return `900${numeric}`
}

function safeContext(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const source = input as Record<string, unknown>
  const allowed = [
    'source',
    'page_url',
    'page_path',
    'page_title',
    'product_id',
    'product_name',
    'product_slug',
    'product_price_mt',
    'product_image',
    'order_number',
  ]
  const out: Record<string, unknown> = {}
  for (const key of allowed) {
    const value = source[key]
    if (typeof value === 'string') out[key] = value.slice(0, 1000)
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
  }
  return out
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
    if (!isWebsiteOriginAllowed(origin, channel.allowed_origins)) return null
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
    .select('id, conversation_id, session_token_hash')
    .eq('website_channel_id', channelId)
    .eq('visitor_id', visitorId)
    .eq('session_token_hash', hashToken(sessionToken))
    .maybeSingle()
  return data as { id: string; conversation_id: string; session_token_hash: string } | null
}

async function ensureSession(
  admin: ReturnType<typeof createAdminClient>,
  channel: WebsiteChannelRow,
  visitorId: string,
  origin: string,
  context: Record<string, unknown>,
) {
  const newToken = randomBytes(32).toString('hex')
  const newHash = hashToken(newToken)

  const { data: existing } = await admin
    .from('website_chat_sessions')
    .select('id, conversation_id')
    .eq('website_channel_id', channel.id)
    .eq('visitor_id', visitorId)
    .maybeSingle()

  if (existing) {
    await admin
      .from('website_chat_sessions')
      .update({ session_token_hash: newHash, last_seen_at: new Date().toISOString(), origin })
      .eq('id', existing.id)

    return { conversationId: existing.conversation_id as string, sessionToken: newToken }
  }

  const { data: account, error: accountError } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', channel.account_id)
    .single()

  if (accountError || !account?.owner_user_id) {
    throw new Error('Website channel account is unavailable')
  }

  const phone = makeVisitorPhone(visitorId)
  let contactId: string

  const { data: existingContact } = await admin
    .from('contacts')
    .select('id')
    .eq('account_id', channel.account_id)
    .eq('phone', phone)
    .maybeSingle()

  if (existingContact?.id) {
    contactId = existingContact.id as string
  } else {
    const { data: contact, error: contactError } = await admin
      .from('contacts')
      .insert({
        user_id: account.owner_user_id,
        account_id: channel.account_id,
        phone,
        name: 'Visitante • Site',
      })
      .select('id')
      .single()

    if (contactError || !contact?.id) throw contactError ?? new Error('Failed to create website contact')
    contactId = contact.id as string
  }

  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      user_id: account.owner_user_id,
      account_id: channel.account_id,
      contact_id: contactId,
      status: 'open',
      channel: 'website',
      source_metadata: context,
      unread_count: 0,
    })
    .select('id')
    .single()

  if (conversationError || !conversation?.id) {
    throw conversationError ?? new Error('Failed to create website conversation')
  }

  const { error: sessionError } = await admin.from('website_chat_sessions').insert({
    account_id: channel.account_id,
    website_channel_id: channel.id,
    conversation_id: conversation.id,
    visitor_id: visitorId,
    session_token_hash: newHash,
    origin,
  })

  if (sessionError) throw sessionError
  return { conversationId: conversation.id as string, sessionToken: newToken }
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(requestOrigin(request)) })
}

export async function POST(request: Request) {
  const origin = requestOrigin(request)
  try {
    const body = await request.json()
    const visitorId = typeof body?.visitor_id === 'string' ? body.visitor_id.slice(0, 128) : ''
    const publicKey = typeof body?.channel_key === 'string' ? body.channel_key.slice(0, 128) : null
    const suppliedToken = typeof body?.session_token === 'string' ? body.session_token : ''
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    const context = safeContext(body?.context)

    if (!visitorId) return json({ error: 'visitor_id is required' }, 400, origin)
    if (message.length > MAX_MESSAGE_LENGTH) {
      return json({ error: `Message exceeds ${MAX_MESSAGE_LENGTH} characters` }, 400, origin)
    }

    const rate = checkRateLimit(`site-chat:${origin}:${visitorId}`, RATE_LIMITS.publicApi)
    if (!rate.success) return json({ error: 'Too many requests' }, 429, origin)

    const admin = createAdminClient()
    const channel = await resolveChannel(admin, publicKey, origin)
    if (!channel) return json({ error: 'Website chat channel not found for this site' }, 404, origin)

    let conversationId: string
    let sessionToken = suppliedToken

    if (suppliedToken) {
      const session = await getSession(admin, channel.id, visitorId, suppliedToken)
      if (!session) return json({ error: 'Invalid chat session' }, 401, origin)
      conversationId = session.conversation_id
      await admin
        .from('website_chat_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', session.id)
    } else {
      const session = await ensureSession(admin, channel, visitorId, origin, context)
      conversationId = session.conversationId
      sessionToken = session.sessionToken
    }

    if (Object.keys(context).length > 0) {
      await admin
        .from('conversations')
        .update({ source_metadata: context, updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .eq('account_id', channel.account_id)
        .eq('channel', 'website')
    }

    if (message) {
      const now = new Date().toISOString()
      const { data: current } = await admin
        .from('conversations')
        .select('unread_count')
        .eq('id', conversationId)
        .eq('account_id', channel.account_id)
        .eq('channel', 'website')
        .single()

      const { error: messageError } = await admin.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'customer',
        content_type: 'text',
        content_text: message,
        message_id: `web_${randomUUID()}`,
        status: 'delivered',
        created_at: now,
      })
      if (messageError) throw messageError

      await admin
        .from('conversations')
        .update({
          last_message_text: message,
          last_message_at: now,
          unread_count: Number(current?.unread_count ?? 0) + 1,
          status: 'open',
          updated_at: now,
        })
        .eq('id', conversationId)
    }

    return json({ ok: true, session_token: sessionToken, conversation_id: conversationId }, 200, origin)
  } catch (error) {
    console.error('[site-chat] POST failed', error)
    return json({ error: 'Unable to send website chat message' }, 500, origin)
  }
}

export async function GET(request: Request) {
  const origin = requestOrigin(request)
  try {
    const url = new URL(request.url)
    const visitorId = (url.searchParams.get('visitor_id') ?? '').slice(0, 128)
    const sessionToken = url.searchParams.get('session_token') ?? ''
    const publicKey = url.searchParams.get('channel_key')?.slice(0, 128) ?? null

    if (!visitorId || !sessionToken) {
      return json({ error: 'visitor_id and session_token are required' }, 400, origin)
    }

    const rate = checkRateLimit(`site-chat-history:${origin}:${visitorId}`, RATE_LIMITS.publicApi)
    if (!rate.success) return json({ error: 'Too many requests' }, 429, origin)

    const admin = createAdminClient()
    const channel = await resolveChannel(admin, publicKey, origin)
    if (!channel) return json({ error: 'Website chat channel not found for this site' }, 404, origin)

    const session = await getSession(admin, channel.id, visitorId, sessionToken)
    if (!session) return json({ error: 'Invalid chat session' }, 401, origin)

    const { data, error } = await admin
      .from('messages')
      .select('id, sender_type, content_type, content_text, media_url, status, created_at')
      .eq('conversation_id', session.conversation_id)
      .order('created_at', { ascending: true })
      .limit(SESSION_MAX_MESSAGES)

    if (error) throw error

    return json({ messages: data ?? [] }, 200, origin)
  } catch (error) {
    console.error('[site-chat] GET failed', error)
    return json({ error: 'Unable to load website chat messages' }, 500, origin)
  }
}
