import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'
import type { MessageTemplate } from '@/types'
import { sendWebsitePush } from './push'

const ONLINE_WINDOW_MS = 20_000
const WHATSAPP_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000

function compactPreview(value: string): string {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length <= 180 ? clean : `${clean.slice(0, 177)}...`
}

export async function notifyWebsiteCustomerIfOffline(args: {
  db: WacrmSupabaseClient
  accountId: string
  conversationId: string
  preview: string
}): Promise<void> {
  const { data: sessions, error: sessionsError } = await args.db
    .from('website_chat_sessions')
    .select('id, website_channel_id, last_seen_at, last_offline_whatsapp_notified_at')
    .eq('conversation_id', args.conversationId)
  if (sessionsError) throw sessionsError
  if (!sessions?.length) return

  const now = Date.now()
  const online = sessions.some((session) => {
    const seen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0
    return Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS
  })
  if (online) return

  const latestSession = [...sessions].sort((a, b) => {
    const left = a.last_seen_at ? new Date(a.last_seen_at).getTime() : 0
    const right = b.last_seen_at ? new Date(b.last_seen_at).getTime() : 0
    return right - left
  })[0]

  const [{ data: channel, error: channelError }, { data: conversation, error: conversationError }] =
    await Promise.all([
      args.db
        .from('website_channels')
        .select('name, offline_whatsapp_enabled, offline_reply_template_id')
        .eq('id', latestSession.website_channel_id)
        .eq('account_id', args.accountId)
        .maybeSingle(),
      args.db
        .from('conversations')
        .select('contact_id')
        .eq('id', args.conversationId)
        .eq('account_id', args.accountId)
        .maybeSingle(),
    ])
  if (channelError) throw channelError
  if (conversationError) throw conversationError
  if (!channel || !conversation?.contact_id) return

  const preview = compactPreview(args.preview) || 'Tem uma nova resposta no atendimento.'
  await sendWebsitePush({
    db: args.db,
    conversationId: args.conversationId,
    title: channel.name || 'Nova resposta',
    body: preview,
    url: '/',
  }).catch((error) => console.error('[site-chat offline] push failed:', error))

  if (!channel.offline_whatsapp_enabled || !channel.offline_reply_template_id) return

  const lastRecovery = Math.max(
    ...sessions.map((session) =>
      session.last_offline_whatsapp_notified_at
        ? new Date(session.last_offline_whatsapp_notified_at).getTime()
        : 0,
    ),
  )
  if (lastRecovery && now - lastRecovery < WHATSAPP_RECOVERY_COOLDOWN_MS) return

  const [contactResult, configResult, accountResult] = await Promise.all([
    args.db
      .from('contacts')
      .select('name, phone, whatsapp_verified_at')
      .eq('id', conversation.contact_id)
      .eq('account_id', args.accountId)
      .maybeSingle(),
    args.db
      .from('whatsapp_config')
      .select('phone_number_id, access_token, status')
      .eq('account_id', args.accountId)
      .maybeSingle(),
    args.db.from('accounts').select('owner_user_id').eq('id', args.accountId).maybeSingle(),
  ])
  if (contactResult.error) throw contactResult.error
  if (configResult.error) throw configResult.error
  if (accountResult.error) throw accountResult.error

  const contact = contactResult.data
  const config = configResult.data
  const account = accountResult.data
  if (!contact?.phone || !contact.whatsapp_verified_at) return
  if (!config?.phone_number_id || !config.access_token || config.status !== 'connected') return
  if (!account?.owner_user_id) return

  const { data: templateRow, error: templateError } = await args.db
    .from('message_templates')
    .select('*')
    .eq('id', channel.offline_reply_template_id)
    .eq('user_id', account.owner_user_id)
    .eq('status', 'APPROVED')
    .maybeSingle()
  if (templateError) throw templateError
  if (!templateRow) return

  const template = templateRow as MessageTemplate
  const variableCount = extractVariableIndices(template.body_text ?? '').length
  if (variableCount > 2) {
    console.warn('[site-chat offline] recovery template supports at most two body variables')
    return
  }

  const body = variableCount === 0
    ? undefined
    : variableCount === 1
      ? [preview]
      : [contact.name?.trim() || 'Cliente', preview]

  try {
    await sendTemplateMessage({
      phoneNumberId: config.phone_number_id,
      accessToken: decrypt(config.access_token),
      to: contact.phone.replace(/\D/g, ''),
      templateName: template.name,
      language: template.language || 'pt_PT',
      template,
      messageParams: body ? { body } : {},
    })

    await args.db
      .from('website_chat_sessions')
      .update({ last_offline_whatsapp_notified_at: new Date().toISOString() })
      .eq('conversation_id', args.conversationId)
  } catch (error) {
    console.error('[site-chat offline] WhatsApp recovery failed:', error)
  }
}
