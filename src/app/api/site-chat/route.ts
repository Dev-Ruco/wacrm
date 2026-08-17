import { createHash, randomBytes, randomUUID } from 'crypto'
import { NextResponse, after } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { isWebsiteOriginAllowed } from '@/lib/site-chat/origin'
import { dispatchInboundThroughAccountBrain } from '@/lib/channels/inbound-brain'

const MAX_MESSAGE_LENGTH = 4000
const SESSION_MAX_MESSAGES = 200

type WebsiteChannelRow = {
  id: string
  account_id: string
  name: string
  public_key: string
  allowed_origins: string[] | null
  is_active: boolean
}

type WebsiteLead = {
  name: string
  phone: string
  phoneNormalized: string
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

function parseLead(nameInput: unknown, whatsappInput: unknown): WebsiteLead | null {
  if (typeof nameInput !== 'string' || typeof whatsappInput !== 'string') return null

  const name = nameInput.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 100) return null

  let digits = whatsappInput.replace(/\D/g, '')
  // Mozambique local mobile numbers are commonly entered as 84/85/86/87...
  // without the +258 country code. Canonicalise those to an international
  // number while still accepting already-international numbers.
  if (digits.length === 9 && digits.startsWith('8')) digits = `258${digits}`
  if (digits.length < 8 || digits.length > 15) return null

  return {
    name,
    phone: `+${digits}`,
    phoneNormalized: digits,
  }
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
    .select('id, account_id, name, public_key, allowed_origins, is_active')
    .eq('is_active', true)

  if (publicKey) {
    query = query.eq('public_key', publicKey)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    if (!data) return null
    const channel = data as WebsiteChannelRow
    if (!isWebsiteOriginAllowed(origin, channel.allowed_origins)) return null
    return channel
  }

  if (!origin) return null
  const { data, error } = await query.contains('allowed_origins', [origin]).limit(2)
  if (error) throw error
  if (!data || data.length !== 1) return null
  return data[0] as WebsiteChannelRow
}

async function getSession(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
  visitorId: string,
  sessionToken: string,
) {
  const { data, error } = await admin
    .from('website_chat_sessions')
    .select('id, conversation_id, session_token_hash')
    .eq('website_channel_id', channelId)
    .eq('visitor_id', visitorId)
    .eq('session_token_hash', hashToken(sessionToken))
    .maybeSingle()
  if (error) throw error
  return data as { id: string; conversation_id: string; session_token_hash: string } | null
}

async function getAccountOwner(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('accounts')
    .select('owner_user_id')
    .eq('id', accountId)
    .single()

  if (error || !data?.owner_user_id) {
    throw error ?? new Error('Website channel account is unavailable')
  }
  return data.owner_user_id as string
}

async function resolveContact(
  admin: ReturnType<typeof createAdminClient>,
  channel: WebsiteChannelRow,
  ownerUserId: string,
  visitorId: string,
  lead: WebsiteLead | null,
): Promise<string> {
  if (lead) {
    const { data: existing, error: existingError } = await admin
      .from('contacts')
      .select('id, name')
      .eq('account_id', channel.account_id)
      .eq('phone_normalized', lead.phoneNormalized)
      .maybeSingle()

    if (existingError) throw existingError
    if (existing?.id) {
      const currentName = typeof existing.name === 'string' ? existing.name.trim() : ''
      if (!currentName || currentName.startsWith('Visitante')) {
        const { error: updateError } = await admin
          .from('contacts')
          .update({ name: lead.name, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .eq('account_id', channel.account_id)
        if (updateError) throw updateError
      }
      return existing.id as string
    }

    const { data: contact, error: contactError } = await admin
      .from('contacts')
      .insert({
        user_id: ownerUserId,
        account_id: channel.account_id,
        phone: lead.phone,
        name: lead.name,
      })
      .select('id')
      .single()

    if (contactError || !contact?.id) {
      // Another request may have created the same normalized phone between
      // the lookup and insert. Re-resolve the canonical contact in that case.
      if ((contactError as { code?: string } | null)?.code === '23505') {
        const { data: winner, error: winnerError } = await admin
          .from('contacts')
          .select('id')
          .eq('account_id', channel.account_id)
          .eq('phone_normalized', lead.phoneNormalized)
          .single()
        if (winnerError || !winner?.id) throw winnerError ?? contactError
        return winner.id as string
      }
      throw contactError ?? new Error('Failed to create website contact')
    }
    return contact.id as string
  }

  // Backward-compatible fallback for an older website build while the new
  // pre-chat form rolls out. New LC builds always submit a real lead.
  const phone = makeVisitorPhone(visitorId)
  const { data: existingContact, error: existingError } = await admin
    .from('contacts')
    .select('id')
    .eq('account_id', channel.account_id)
    .eq('phone', phone)
    .maybeSingle()

  if (existingError) throw existingError
  if (existingContact?.id) return existingContact.id as string

  const { data: contact, error: contactError } = await admin
    .from('contacts')
    .insert({
      user_id: ownerUserId,
      account_id: channel.account_id,
      phone,
      name: 'Visitante • Site',
    })
    .select('id')
    .single()

  if (contactError || !contact?.id) throw contactError ?? new Error('Failed to create website contact')
  return contact.id as string
}

async function findWebsiteConversation(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
  contactId: string,
) {
  const { data, error } = await admin
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
    .eq('channel', 'website')
    .maybeSingle()
  if (error) throw error
  return data as { id: string } | null
}

async function resolveWebsiteConversation(
  admin: ReturnType<typeof createAdminClient>,
  channel: WebsiteChannelRow,
  ownerUserId: string,
  contactId: string,
  context: Record<string, unknown>,
  preferredConversationId?: string,
): Promise<string> {
  if (preferredConversationId) {
    const { data: preferred, error: preferredError } = await admin
      .from('conversations')
      .select('id, contact_id, channel')
      .eq('id', preferredConversationId)
      .eq('account_id', channel.account_id)
      .maybeSingle()

    if (preferredError) throw preferredError
    if (preferred?.id && preferred.channel === 'website' && preferred.contact_id === contactId) {
      return preferred.id as string
    }

    const existingTarget = await findWebsiteConversation(admin, channel.account_id, contactId)
    if (existingTarget?.id) return existingTarget.id

    if (preferred?.id && preferred.channel === 'website') {
      const { data: relinked, error: relinkError } = await admin
        .from('conversations')
        .update({ contact_id: contactId, updated_at: new Date().toISOString() })
        .eq('id', preferred.id)
        .eq('account_id', channel.account_id)
        .eq('channel', 'website')
        .select('id')
        .maybeSingle()

      if (!relinkError && relinked?.id) return relinked.id as string
      if ((relinkError as { code?: string } | null)?.code !== '23505') throw relinkError

      const winner = await findWebsiteConversation(admin, channel.account_id, contactId)
      if (winner?.id) return winner.id
    }
  }

  const existing = await findWebsiteConversation(admin, channel.account_id, contactId)
  if (existing?.id) return existing.id

  const { data: conversation, error: conversationError } = await admin
    .from('conversations')
    .insert({
      user_id: ownerUserId,
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
    if ((conversationError as { code?: string } | null)?.code === '23505') {
      const winner = await findWebsiteConversation(admin, channel.account_id, contactId)
      if (winner?.id) return winner.id
    }
    throw conversationError ?? new Error('Failed to create website conversation')
  }
  return conversation.id as string
}

async function mergeConversationMetadata(
  admin: ReturnType<typeof createAdminClient>,
  channel: WebsiteChannelRow,
  conversationId: string,
  context: Record<string, unknown>,
  lead: WebsiteLead | null,
) {
  const additions: Record<string, unknown> = {
    ...context,
    channel_name: channel.name,
    lead_source: 'website',
  }
  if (lead) {
    additions.customer_name = lead.name
    additions.customer_whatsapp = lead.phone
  }

  const { data: current, error: currentError } = await admin
    .from('conversations')
    .select('source_metadata')
    .eq('id', conversationId)
    .eq('account_id', channel.account_id)
    .eq('channel', 'website')
    .single()
  if (currentError) throw currentError

  const existingMetadata =
    current?.source_metadata && typeof current.source_metadata === 'object' && !Array.isArray(current.source_metadata)
      ? (current.source_metadata as Record<string, unknown>)
      : {}

  const { error: updateError } = await admin
    .from('conversations')
    .update({
      source_metadata: { ...existingMetadata, ...additions },
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .eq('account_id', channel.account_id)
    .eq('channel', 'website')
  if (updateError) throw updateError
}

async function ensureSession(
  admin: ReturnType<typeof createAdminClient>,
  channel: WebsiteChannelRow,
  visitorId: string,
  origin: string,
  context: Record<string, unknown>,
  lead: WebsiteLead | null,
) {
  const newToken = randomBytes(32).toString('hex')
  const newHash = hashToken(newToken)
  const ownerUserId = await getAccountOwner(admin, channel.account_id)
  const contactId = await resolveContact(admin, channel, ownerUserId, visitorId, lead)

  const { data: existing, error: existingError } = await admin
    .from('website_chat_sessions')
    .select('id, conversation_id')
    .eq('website_channel_id', channel.id)
    .eq('visitor_id', visitorId)
    .maybeSingle()
  if (existingError) throw existingError

  const conversationId = await resolveWebsiteConversation(
    admin,
    channel,
    ownerUserId,
    contactId,
    context,
    existing?.conversation_id as string | undefined,
  )

  if (existing?.id) {
    const { error: updateError } = await admin
      .from('website_chat_sessions')
      .update({
        conversation_id: conversationId,
        session_token_hash: newHash,
        last_seen_at: new Date().toISOString(),
        origin,
      })
      .eq('id', existing.id)
    if (updateError) throw updateError
  } else {
    const { error: sessionError } = await admin.from('website_chat_sessions').insert({
      account_id: channel.account_id,
      website_channel_id: channel.id,
      conversation_id: conversationId,
      visitor_id: visitorId,
      session_token_hash: newHash,
      origin,
    })
    if (sessionError) throw sessionError
  }

  await mergeConversationMetadata(admin, channel, conversationId, context, lead)
  return { conversationId, sessionToken: newToken }
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
    const leadName = typeof body?.customer_name === 'string' ? body.customer_name : ''
    const leadWhatsapp = typeof body?.customer_whatsapp === 'string' ? body.customer_whatsapp : ''
    const leadWasSupplied = Boolean(leadName.trim() || leadWhatsapp.trim())
    const lead = parseLead(leadName, leadWhatsapp)

    if (!visitorId) return json({ error: 'visitor_id is required' }, 400, origin)
    if (leadWasSupplied && !lead) {
      return json({ error: 'Nome completo e número de WhatsApp válidos são obrigatórios' }, 400, origin)
    }
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
      const { error: touchError } = await admin
        .from('website_chat_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', session.id)
      if (touchError) throw touchError
      await mergeConversationMetadata(admin, channel, conversationId, context, lead)
    } else {
      const session = await ensureSession(admin, channel, visitorId, origin, context, lead)
      conversationId = session.conversationId
      sessionToken = session.sessionToken
    }

    if (message) {
      const now = new Date().toISOString()
      const externalMessageId = `web_${randomUUID()}`
      const [{ data: current, error: currentError }, { count: priorCustomerMessageCount }] =
        await Promise.all([
          admin
            .from('conversations')
            .select('unread_count, contact_id, user_id')
            .eq('id', conversationId)
            .eq('account_id', channel.account_id)
            .eq('channel', 'website')
            .single(),
          admin
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conversationId)
            .eq('sender_type', 'customer'),
        ])
      if (currentError || !current?.contact_id || !current?.user_id) {
        throw currentError ?? new Error('Website conversation routing context is unavailable')
      }

      const { error: messageError } = await admin.from('messages').insert({
        conversation_id: conversationId,
        sender_type: 'customer',
        content_type: 'text',
        content_text: message,
        message_id: externalMessageId,
        status: 'delivered',
        created_at: now,
      })
      if (messageError) throw messageError

      const { error: conversationError } = await admin
        .from('conversations')
        .update({
          last_message_text: message,
          last_message_at: now,
          unread_count: Number(current.unread_count ?? 0) + 1,
          status: 'open',
          updated_at: now,
        })
        .eq('id', conversationId)
      if (conversationError) throw conversationError

      after(async () => {
        await dispatchInboundThroughAccountBrain({
          accountId: channel.account_id,
          conversationId,
          contactId: current.contact_id as string,
          configOwnerUserId: current.user_id as string,
          inboundMessageId: externalMessageId,
          channel: 'website',
          text: message,
          contentType: 'text',
          isFirstInboundMessage: (priorCustomerMessageCount ?? 0) === 0,
        })
      })
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
