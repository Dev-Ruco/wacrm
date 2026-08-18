import { randomBytes, randomInt, randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { decrypt } from '@/lib/whatsapp/encryption'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { extractVariableIndices } from '@/lib/whatsapp/template-validators'
import type { MessageTemplate } from '@/types'
import {
  hashOtpCode,
  hashSiteChatToken,
  normalizeWebsiteLead,
  requestOrigin,
  resolveWebsiteChannel,
  secureHashEquals,
  siteChatCorsHeaders,
  siteChatJson,
} from '@/lib/site-chat/public-server'

const OTP_TTL_MS = 10 * 60 * 1000
const VERIFICATION_TTL_MS = 90 * 24 * 60 * 60 * 1000

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: siteChatCorsHeaders(requestOrigin(request)),
  })
}

export async function POST(request: Request) {
  const origin = requestOrigin(request)
  try {
    const body = await request.json()
    const action = body?.action === 'confirm' ? 'confirm' : 'request'
    const visitorId = typeof body?.visitor_id === 'string' ? body.visitor_id.slice(0, 128) : ''
    const publicKey = typeof body?.channel_key === 'string' ? body.channel_key.slice(0, 128) : null

    if (!visitorId) return siteChatJson({ error: 'visitor_id is required' }, 400, origin)

    const admin = createAdminClient()
    const channel = await resolveWebsiteChannel(admin, publicKey, origin)
    if (!channel) {
      return siteChatJson({ error: 'Website chat channel not found for this site' }, 404, origin)
    }

    if (!channel.require_whatsapp_verification) {
      return siteChatJson({ verification_required: false }, 200, origin)
    }

    const visitorRate = checkRateLimit(`site-chat-otp:${channel.id}:${visitorId}`, RATE_LIMITS.publicApi)
    if (!visitorRate.success) return siteChatJson({ error: 'Too many requests' }, 429, origin)

    if (action === 'confirm') {
      const challengeId = typeof body?.challenge_id === 'string' ? body.challenge_id.slice(0, 128) : ''
      const code = typeof body?.code === 'string' ? body.code.replace(/\D/g, '').slice(0, 6) : ''
      if (!challengeId || !/^\d{6}$/.test(code)) {
        return siteChatJson({ error: 'Código de verificação inválido' }, 400, origin)
      }

      const { data: challenge, error: challengeError } = await admin
        .from('website_chat_otp_challenges')
        .select('id, phone_normalized, code_hash, attempts, max_attempts, expires_at, verified_at')
        .eq('id', challengeId)
        .eq('website_channel_id', channel.id)
        .eq('visitor_id', visitorId)
        .maybeSingle()
      if (challengeError) throw challengeError
      if (!challenge) return siteChatJson({ error: 'Código expirado ou inválido' }, 400, origin)
      if (challenge.verified_at) return siteChatJson({ error: 'Este código já foi utilizado' }, 400, origin)
      if (new Date(challenge.expires_at).getTime() < Date.now()) {
        return siteChatJson({ error: 'O código expirou. Peça um novo código.' }, 400, origin)
      }
      if (Number(challenge.attempts ?? 0) >= Number(challenge.max_attempts ?? 5)) {
        return siteChatJson({ error: 'Limite de tentativas atingido. Peça um novo código.' }, 429, origin)
      }

      const candidateHash = hashOtpCode({
        challengeId: challenge.id,
        channelId: channel.id,
        visitorId,
        phoneNormalized: challenge.phone_normalized,
        code,
      })

      if (!secureHashEquals(candidateHash, challenge.code_hash)) {
        await admin
          .from('website_chat_otp_challenges')
          .update({
            attempts: Number(challenge.attempts ?? 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', challenge.id)
        return siteChatJson({ error: 'Código incorrecto' }, 400, origin)
      }

      const verificationToken = randomBytes(32).toString('hex')
      const now = new Date()
      const { error: verifyError } = await admin
        .from('website_chat_otp_challenges')
        .update({
          verification_token_hash: hashSiteChatToken(verificationToken),
          verified_at: now.toISOString(),
          verification_expires_at: new Date(now.getTime() + VERIFICATION_TTL_MS).toISOString(),
          updated_at: now.toISOString(),
        })
        .eq('id', challenge.id)
      if (verifyError) throw verifyError

      return siteChatJson({
        verification_required: true,
        verified: true,
        verification_token: verificationToken,
        phone_normalized: challenge.phone_normalized,
      }, 200, origin)
    }

    const lead = normalizeWebsiteLead(body?.customer_name, body?.customer_whatsapp)
    if (!lead) {
      return siteChatJson({ error: 'Nome completo e número de WhatsApp válidos são obrigatórios' }, 400, origin)
    }
    if (!channel.otp_template_id) {
      return siteChatJson({ error: 'A verificação por WhatsApp ainda não está configurada.' }, 503, origin)
    }

    const phoneRate = checkRateLimit(
      `site-chat-otp-phone:${channel.id}:${lead.phoneNormalized}`,
      RATE_LIMITS.publicApi,
    )
    if (!phoneRate.success) return siteChatJson({ error: 'Too many requests' }, 429, origin)

    const [{ data: account, error: accountError }, { data: waConfig, error: waError }] = await Promise.all([
      admin.from('accounts').select('owner_user_id').eq('id', channel.account_id).single(),
      admin
        .from('whatsapp_config')
        .select('phone_number_id, access_token, status')
        .eq('account_id', channel.account_id)
        .maybeSingle(),
    ])
    if (accountError || !account?.owner_user_id) throw accountError ?? new Error('Account unavailable')
    if (waError || !waConfig?.phone_number_id || !waConfig?.access_token || waConfig.status !== 'connected') {
      return siteChatJson({ error: 'A verificação por WhatsApp está temporariamente indisponível.' }, 503, origin)
    }

    const { data: templateRow, error: templateError } = await admin
      .from('message_templates')
      .select('*')
      .eq('id', channel.otp_template_id)
      .eq('user_id', account.owner_user_id)
      .eq('status', 'APPROVED')
      .maybeSingle()
    if (templateError) throw templateError
    if (!templateRow) {
      return siteChatJson({ error: 'O template de verificação ainda não está aprovado.' }, 503, origin)
    }

    const template = templateRow as MessageTemplate
    const bodyVariables = extractVariableIndices(template.body_text ?? '')
    if (bodyVariables.length !== 1 || bodyVariables[0] !== 1) {
      return siteChatJson({ error: 'O template OTP deve conter exactamente a variável {{1}} para o código.' }, 503, origin)
    }

    const challengeId = randomUUID()
    const code = String(randomInt(100000, 1_000_000))
    const now = new Date()
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS)
    const codeHash = hashOtpCode({
      challengeId,
      channelId: channel.id,
      visitorId,
      phoneNormalized: lead.phoneNormalized,
      code,
    })

    const { error: insertError } = await admin.from('website_chat_otp_challenges').insert({
      id: challengeId,
      account_id: channel.account_id,
      website_channel_id: channel.id,
      visitor_id: visitorId,
      phone_normalized: lead.phoneNormalized,
      code_hash: codeHash,
      expires_at: expiresAt.toISOString(),
    })
    if (insertError) throw insertError

    const copyCodeIndex = (template.buttons ?? []).findIndex((button) => button.type === 'COPY_CODE')
    const buttonParams = copyCodeIndex >= 0 ? { [String(copyCodeIndex)]: code } : undefined

    try {
      const result = await sendTemplateMessage({
        phoneNumberId: waConfig.phone_number_id,
        accessToken: decrypt(waConfig.access_token),
        to: lead.phoneNormalized,
        templateName: template.name,
        language: template.language || 'pt_PT',
        template,
        messageParams: {
          body: [code],
          ...(buttonParams ? { buttonParams } : {}),
        },
      })

      await admin
        .from('website_chat_otp_challenges')
        .update({ delivery_message_id: result.messageId, updated_at: new Date().toISOString() })
        .eq('id', challengeId)
    } catch (sendError) {
      await admin.from('website_chat_otp_challenges').delete().eq('id', challengeId)
      console.error('[site-chat verify] OTP delivery failed:', sendError)
      return siteChatJson({
        error: 'Não foi possível enviar o código para este WhatsApp. Confirme o número e tente novamente.',
      }, 422, origin)
    }

    const masked = `+${lead.phoneNormalized.slice(0, 3)} ••• ••• ${lead.phoneNormalized.slice(-3)}`
    return siteChatJson({
      verification_required: true,
      verified: false,
      challenge_id: challengeId,
      expires_in: Math.floor(OTP_TTL_MS / 1000),
      masked_phone: masked,
    }, 200, origin)
  } catch (error) {
    console.error('[site-chat verify] failed:', error)
    return siteChatJson({ error: 'Não foi possível verificar o WhatsApp agora.' }, 500, origin)
  }
}
