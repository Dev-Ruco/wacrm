import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { isWebsiteOriginAllowed } from '@/lib/site-chat/origin'
import { isValidE164 } from '@/lib/whatsapp/phone-utils'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'

export type WebsitePublicChannel = {
  id: string
  account_id: string
  name: string
  public_key: string
  allowed_origins: string[] | null
  is_active: boolean
  require_whatsapp_verification: boolean
  otp_template_id: string | null
  offline_whatsapp_enabled: boolean
  offline_reply_template_id: string | null
}

export type WebsiteLeadInput = {
  name: string
  phone: string
  phoneNormalized: string
}

export function requestOrigin(request: Request): string {
  return request.headers.get('origin')?.replace(/\/$/, '') ?? ''
}

export function siteChatCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

export function siteChatJson(body: unknown, status: number, origin: string) {
  return NextResponse.json(body, { status, headers: siteChatCorsHeaders(origin) })
}

export function hashSiteChatToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function normalizeWebsiteLead(
  nameInput: unknown,
  whatsappInput: unknown,
): WebsiteLeadInput | null {
  if (typeof nameInput !== 'string' || typeof whatsappInput !== 'string') return null

  const name = nameInput.trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 100) return null

  let digits = whatsappInput.replace(/\D/g, '')
  if (digits.length === 9 && digits.startsWith('8')) digits = `258${digits}`
  if (!isValidE164(digits)) return null

  return { name, phone: `+${digits}`, phoneNormalized: digits }
}

export async function resolveWebsiteChannel(
  admin: WacrmSupabaseClient,
  publicKey: string | null,
  origin: string,
): Promise<WebsitePublicChannel | null> {
  let query = admin
    .from('website_channels')
    .select(
      'id, account_id, name, public_key, allowed_origins, is_active, require_whatsapp_verification, otp_template_id, offline_whatsapp_enabled, offline_reply_template_id',
    )
    .eq('is_active', true)

  if (publicKey) {
    query = query.eq('public_key', publicKey)
    const { data, error } = await query.maybeSingle()
    if (error) throw error
    if (!data) return null
    const channel = data as WebsitePublicChannel
    if (!isWebsiteOriginAllowed(origin, channel.allowed_origins)) return null
    return channel
  }

  if (!origin) return null
  const { data, error } = await query.contains('allowed_origins', [origin]).limit(2)
  if (error) throw error
  if (!data || data.length !== 1) return null
  return data[0] as WebsitePublicChannel
}

export async function getWebsiteSession(
  admin: WacrmSupabaseClient,
  channelId: string,
  visitorId: string,
  sessionToken: string,
) {
  const { data, error } = await admin
    .from('website_chat_sessions')
    .select('id, conversation_id, session_token_hash, last_seen_at')
    .eq('website_channel_id', channelId)
    .eq('visitor_id', visitorId)
    .eq('session_token_hash', hashSiteChatToken(sessionToken))
    .maybeSingle()
  if (error) throw error
  return data as {
    id: string
    conversation_id: string
    session_token_hash: string
    last_seen_at: string | null
  } | null
}

function otpSecret(): string {
  const secret = process.env.SITE_CHAT_OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('SITE_CHAT_OTP_SECRET or SUPABASE_SERVICE_ROLE_KEY is required')
  return secret
}

export function hashOtpCode(args: {
  challengeId: string
  channelId: string
  visitorId: string
  phoneNormalized: string
  code: string
}): string {
  return createHmac('sha256', otpSecret())
    .update([
      args.challengeId,
      args.channelId,
      args.visitorId,
      args.phoneNormalized,
      args.code,
    ].join(':'))
    .digest('hex')
}

export function secureHashEquals(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}
