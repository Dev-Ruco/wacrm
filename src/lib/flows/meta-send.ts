import { randomUUID } from 'crypto'
import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendMediaMessage,
  sendTextMessage,
  sendTypingIndicator,
  type InteractiveButton,
  type InteractiveListSection,
  type MediaKind,
} from '@/lib/whatsapp/meta-api'
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import { supabaseAdmin } from './admin-client'
import { setWebsiteActivity } from '@/lib/site-chat/activity'
import { notifyWebsiteCustomerIfOffline } from '@/lib/site-chat/offline-notify'

type EngineDb = ReturnType<typeof supabaseAdmin>

async function conversationChannel(
  db: EngineDb,
  accountId: string,
  conversationId: string,
): Promise<string> {
  const { data, error } = await db
    .from('conversations')
    .select('channel')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle()

  if (error || !data) throw new Error('conversation not found for this account')
  return typeof data.channel === 'string' && data.channel.trim()
    ? data.channel.trim()
    : 'whatsapp'
}

async function persistWebsiteBotMessage(args: {
  db: EngineDb
  accountId: string
  conversationId: string
  contentType: 'text' | 'image'
  contentText: string | null
  mediaUrl?: string | null
  aiGenerated?: boolean
}): Promise<{ whatsapp_message_id: string }> {
  const externalId = `web_out_${randomUUID()}`
  const now = new Date().toISOString()
  const preview =
    args.contentText?.trim() ||
    (args.contentType === 'image' ? '📷 Fotografia' : '')

  const { error: msgErr } = await args.db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.contentType,
    content_text: args.contentText,
    media_url: args.mediaUrl ?? null,
    message_id: externalId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
    created_at: now,
  })
  if (msgErr) throw new Error(`website message persistence failed: ${msgErr.message}`)

  const { error: convErr } = await args.db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: now,
      updated_at: now,
    })
    .eq('id', args.conversationId)
  if (convErr) throw new Error(`website conversation update failed: ${convErr.message}`)

  await setWebsiteActivity(args.db, args.conversationId, null).catch((error) =>
    console.error('[website activity] clear failed:', error),
  )
  await notifyWebsiteCustomerIfOffline({
    db: args.db,
    accountId: args.accountId,
    conversationId: args.conversationId,
    preview: preview || 'Tem uma nova resposta no atendimento.',
  }).catch((error) => console.error('[website offline] notify failed:', error))

  // Kept for backwards compatibility with Flow/AI callers. This field now
  // means the external delivery id and is not necessarily a WhatsApp wamid.
  return { whatsapp_message_id: externalId }
}

interface SendTextEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  text: string
  aiGenerated?: boolean
}

/**
 * Channel-aware text sender used by Flows and the account AI brain.
 * Transport changes by conversation channel; the caller does not.
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const channel = await conversationChannel(db, args.accountId, args.conversationId)

  if (channel === 'website') {
    return persistWebsiteBotMessage({
      db,
      accountId: args.accountId,
      conversationId: args.conversationId,
      contentType: 'text',
      contentText: args.text,
      aiGenerated: args.aiGenerated,
    })
  }
  if (channel !== 'whatsapp') {
    throw new Error(`No outbound text adapter configured for channel: ${channel}`)
  }

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)
  const attempt = async (phone: string): Promise<string> => {
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: args.text,
    })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: 'text',
    content_text: args.text,
    message_id: waMessageId,
    status: 'sent',
    ai_generated: args.aiGenerated ?? false,
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: args.text,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

/** Best-effort typing state. Non-WhatsApp channels simply no-op. */
export async function engineSendTypingIndicator(args: {
  accountId: string
  inboundMessageId: string
}): Promise<void> {
  const db = supabaseAdmin()
  const { data: inbound } = await db
    .from('messages')
    .select('conversation_id')
    .eq('message_id', args.inboundMessageId)
    .maybeSingle()

  if (inbound?.conversation_id) {
    const channel = await conversationChannel(db, args.accountId, inbound.conversation_id)
    if (channel === 'website') {
      await setWebsiteActivity(db, inbound.conversation_id, 'writing')
      return
    }
    if (channel !== 'whatsapp') return
  }

  const { data: config, error } = await db
    .from('whatsapp_config')
    .select('phone_number_id, access_token')
    .eq('account_id', args.accountId)
    .single()
  if (error || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  await sendTypingIndicator({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
    messageId: args.inboundMessageId,
  })
}

interface SendMediaEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  kind: MediaKind
  link: string
  caption?: string
  filename?: string
}

/** Channel-aware media sender. Website currently supports product/images. */
export async function engineSendMedia(
  args: SendMediaEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const channel = await conversationChannel(db, args.accountId, args.conversationId)

  if (channel === 'website') {
    if (args.kind !== 'image') {
      throw new Error(`Website outbound adapter does not support ${args.kind} media yet`)
    }
    return persistWebsiteBotMessage({
      db,
      accountId: args.accountId,
      conversationId: args.conversationId,
      contentType: 'image',
      contentText: args.caption?.trim() || null,
      mediaUrl: args.link,
    })
  }
  if (channel !== 'whatsapp') {
    throw new Error(`No outbound media adapter configured for channel: ${channel}`)
  }

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', args.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)
  const attempt = async (phone: string): Promise<string> => {
    const r = await sendMediaMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      kind: args.kind,
      link: args.link,
      caption: args.caption,
      filename: args.filename,
    })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const preview = args.caption?.trim() || `[${args.kind}]`
  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: args.conversationId,
    sender_type: 'bot',
    content_type: args.kind,
    content_text: args.caption ?? null,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', args.conversationId)

  return { whatsapp_message_id: waMessageId }
}

interface SendInteractiveButtonsEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'buttons' })
}

export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendInteractiveViaMeta({ ...args, kind: 'list' })
}

type SendInput =
  | (SendInteractiveButtonsEngineArgs & { kind: 'buttons' })
  | (SendInteractiveListEngineArgs & { kind: 'list' })

async function sendInteractiveViaMeta(
  input: SendInput,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()
  const channel = await conversationChannel(db, input.accountId, input.conversationId)
  if (channel !== 'whatsapp') {
    throw new Error(`Interactive Flow messages are not supported on channel: ${channel}`)
  }

  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)
  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'buttons') {
      const r = await sendInteractiveButtons({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        bodyText: input.bodyText,
        buttons: input.buttons,
        headerText: input.headerText,
        footerText: input.footerText,
      })
      return r.messageId
    }
    const r = await sendInteractiveList({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      bodyText: input.bodyText,
      buttonLabel: input.buttonLabel,
      sections: input.sections,
      headerText: input.headerText,
      footerText: input.footerText,
    })
    return r.messageId
  }

  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    await db.from('contacts').update({ phone: workingPhone }).eq('id', contact.id)
  }

  const interactivePayload: InteractiveMessagePayload =
    input.kind === 'buttons'
      ? {
          kind: 'buttons',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          buttons: input.buttons,
        }
      : {
          kind: 'list',
          body: input.bodyText,
          header: input.headerText,
          footer: input.footerText,
          button_label: input.buttonLabel,
          sections: input.sections,
        }

  const { error: msgErr } = await db.from('messages').insert({
    conversation_id: input.conversationId,
    sender_type: 'bot',
    content_type: 'interactive',
    content_text: input.bodyText,
    interactive_payload: interactivePayload,
    message_id: waMessageId,
    status: 'sent',
  })
  if (msgErr) {
    throw new Error(`sent to Meta but DB insert failed: ${msgErr.message}`)
  }

  await db
    .from('conversations')
    .update({
      last_message_text: input.bodyText,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.conversationId)

  return { whatsapp_message_id: waMessageId }
}
