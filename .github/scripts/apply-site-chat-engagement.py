from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'pattern not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1))

# ---------------------------------------------------------------------------
# Public site-chat route: OTP gate, activity, presence heartbeat.
# ---------------------------------------------------------------------------
path = 'src/app/api/site-chat/route.ts'
replace_once(
    path,
    "import { dispatchInboundThroughAccountBrain } from '@/lib/channels/inbound-brain'\n",
    "import { dispatchInboundThroughAccountBrain } from '@/lib/channels/inbound-brain'\n"
    "import { freshWebsiteActivity, setWebsiteActivity } from '@/lib/site-chat/activity'\n"
    "import { hashSiteChatToken } from '@/lib/site-chat/public-server'\n",
)
replace_once(
    path,
    "  is_active: boolean\n}\n",
    "  is_active: boolean\n"
    "  require_whatsapp_verification: boolean\n"
    "  otp_template_id: string | null\n"
    "  offline_whatsapp_enabled: boolean\n"
    "  offline_reply_template_id: string | null\n"
    "}\n",
)
replace_once(
    path,
    ".select('id, account_id, name, public_key, allowed_origins, is_active')",
    ".select('id, account_id, name, public_key, allowed_origins, is_active, require_whatsapp_verification, otp_template_id, offline_whatsapp_enabled, offline_reply_template_id')",
)
replace_once(
    path,
    "    const suppliedToken = typeof body?.session_token === 'string' ? body.session_token : ''\n",
    "    const suppliedToken = typeof body?.session_token === 'string' ? body.session_token : ''\n"
    "    const verificationToken = typeof body?.verification_token === 'string' ? body.verification_token : ''\n",
)
replace_once(
    path,
    "    const channel = await resolveChannel(admin, publicKey, origin)\n"
    "    if (!channel) return json({ error: 'Website chat channel not found for this site' }, 404, origin)\n\n"
    "    let conversationId: string\n",
    "    const channel = await resolveChannel(admin, publicKey, origin)\n"
    "    if (!channel) return json({ error: 'Website chat channel not found for this site' }, 404, origin)\n\n"
    "    let verifiedChallengeId: string | null = null\n"
    "    if (!suppliedToken && channel.require_whatsapp_verification) {\n"
    "      if (!lead || !verificationToken) {\n"
    "        return json({ error: 'Verifique o seu número de WhatsApp antes de iniciar o chat.', code: 'whatsapp_verification_required' }, 403, origin)\n"
    "      }\n"
    "      const { data: verified, error: verifiedError } = await admin\n"
    "        .from('website_chat_otp_challenges')\n"
    "        .select('id')\n"
    "        .eq('website_channel_id', channel.id)\n"
    "        .eq('visitor_id', visitorId)\n"
    "        .eq('phone_normalized', lead.phoneNormalized)\n"
    "        .eq('verification_token_hash', hashSiteChatToken(verificationToken))\n"
    "        .not('verified_at', 'is', null)\n"
    "        .gt('verification_expires_at', new Date().toISOString())\n"
    "        .maybeSingle()\n"
    "      if (verifiedError) throw verifiedError\n"
    "      if (!verified?.id) {\n"
    "        return json({ error: 'A verificação do WhatsApp expirou. Verifique o número novamente.', code: 'whatsapp_verification_required' }, 403, origin)\n"
    "      }\n"
    "      verifiedChallengeId = verified.id as string\n"
    "    }\n\n"
    "    let conversationId: string\n",
)
replace_once(
    path,
    "      conversationId = session.conversationId\n"
    "      sessionToken = session.sessionToken\n"
    "    }\n\n"
    "    if (productInquiry) {\n",
    "      conversationId = session.conversationId\n"
    "      sessionToken = session.sessionToken\n"
    "    }\n\n"
    "    if (verifiedChallengeId) {\n"
    "      const { data: verifiedConversation, error: verifiedConversationError } = await admin\n"
    "        .from('conversations')\n"
    "        .select('contact_id')\n"
    "        .eq('id', conversationId)\n"
    "        .eq('account_id', channel.account_id)\n"
    "        .single()\n"
    "      if (verifiedConversationError) throw verifiedConversationError\n"
    "      if (verifiedConversation?.contact_id) {\n"
    "        const { error: verifiedContactError } = await admin\n"
    "          .from('contacts')\n"
    "          .update({ whatsapp_verified_at: new Date().toISOString() })\n"
    "          .eq('id', verifiedConversation.contact_id)\n"
    "          .eq('account_id', channel.account_id)\n"
    "        if (verifiedContactError) throw verifiedContactError\n"
    "      }\n"
    "    }\n\n"
    "    if (productInquiry || message) {\n"
    "      await setWebsiteActivity(admin, conversationId, 'analyzing')\n"
    "    }\n\n"
    "    if (productInquiry) {\n",
)
replace_once(
    path,
    "    const publicKey = url.searchParams.get('channel_key')?.slice(0, 128) ?? null\n\n"
    "    if (!visitorId || !sessionToken) {\n",
    "    const publicKey = url.searchParams.get('channel_key')?.slice(0, 128) ?? null\n"
    "    const visible = url.searchParams.get('visible') !== '0'\n\n"
    "    if (!visitorId || !sessionToken) {\n",
)
replace_once(
    path,
    "    const session = await getSession(admin, channel.id, visitorId, sessionToken)\n"
    "    if (!session) return json({ error: 'Invalid chat session' }, 401, origin)\n\n"
    "    const { data, error } = await admin\n",
    "    const session = await getSession(admin, channel.id, visitorId, sessionToken)\n"
    "    if (!session) return json({ error: 'Invalid chat session' }, 401, origin)\n\n"
    "    const now = new Date().toISOString()\n"
    "    const sessionTouch: Record<string, string> = { last_seen_at: now }\n"
    "    if (visible) sessionTouch.last_visible_at = now\n"
    "    const { error: touchError } = await admin\n"
    "      .from('website_chat_sessions')\n"
    "      .update(sessionTouch)\n"
    "      .eq('id', session.id)\n"
    "    if (touchError) throw touchError\n\n"
    "    const [{ data, error }, { data: activityRow, error: activityError }] = await Promise.all([\n"
    "      admin\n"
    "        .from('messages')\n"
    "        .select('id, sender_type, content_type, content_text, media_url, status, created_at')\n"
    "        .eq('conversation_id', session.conversation_id)\n"
    "        .order('created_at', { ascending: true })\n"
    "        .limit(SESSION_MAX_MESSAGES),\n"
    "      admin\n"
    "        .from('conversations')\n"
    "        .select('website_activity_state, website_activity_updated_at')\n"
    "        .eq('id', session.conversation_id)\n"
    "        .eq('channel', 'website')\n"
    "        .maybeSingle(),\n"
    "    ])\n",
)
# Remove the original message query tail that is now duplicated by Promise.all.
replace_once(
    path,
    "      .from('messages')\n"
    "      .select('id, sender_type, content_type, content_text, media_url, status, created_at')\n"
    "      .eq('conversation_id', session.conversation_id)\n"
    "      .order('created_at', { ascending: true })\n"
    "      .limit(SESSION_MAX_MESSAGES)\n\n"
    "    if (error) throw error\n\n"
    "    return json({ messages: data ?? [] }, 200, origin)\n",
    "\n    if (error) throw error\n"
    "    if (activityError) throw activityError\n\n"
    "    const activity = freshWebsiteActivity({\n"
    "      state: activityRow?.website_activity_state,\n"
    "      updatedAt: activityRow?.website_activity_updated_at,\n"
    "    })\n"
    "    return json({ messages: data ?? [], activity }, 200, origin)\n",
)

# ---------------------------------------------------------------------------
# Customer media ingress also exposes the AI working state.
# ---------------------------------------------------------------------------
path = 'src/app/api/site-chat/media/route.ts'
replace_once(
    path,
    "import { transcribeAudio } from '@/lib/ai/transcription'\n",
    "import { transcribeAudio } from '@/lib/ai/transcription'\n"
    "import { setWebsiteActivity } from '@/lib/site-chat/activity'\n",
)
replace_once(
    path,
    "    if (conversationError) throw conversationError\n\n"
    "    await admin\n",
    "    if (conversationError) throw conversationError\n\n"
    "    await setWebsiteActivity(admin, session.conversation_id, 'analyzing')\n\n"
    "    await admin\n",
)

# ---------------------------------------------------------------------------
# Shared AI/Flow sender: website typing + clear state + offline notification.
# ---------------------------------------------------------------------------
path = 'src/lib/flows/meta-send.ts'
replace_once(
    path,
    "import { supabaseAdmin } from './admin-client'\n",
    "import { supabaseAdmin } from './admin-client'\n"
    "import { setWebsiteActivity } from '@/lib/site-chat/activity'\n"
    "import { notifyWebsiteCustomerIfOffline } from '@/lib/site-chat/offline-notify'\n",
)
replace_once(
    path,
    "async function persistWebsiteBotMessage(args: {\n"
    "  db: EngineDb\n",
    "async function persistWebsiteBotMessage(args: {\n"
    "  db: EngineDb\n"
    "  accountId: string\n",
)
replace_once(
    path,
    "  if (convErr) throw new Error(`website conversation update failed: ${convErr.message}`)\n\n"
    "  // Kept for backwards compatibility",
    "  if (convErr) throw new Error(`website conversation update failed: ${convErr.message}`)\n\n"
    "  await setWebsiteActivity(args.db, args.conversationId, null).catch((error) =>\n"
    "    console.error('[website activity] clear failed:', error),\n"
    "  )\n"
    "  await notifyWebsiteCustomerIfOffline({\n"
    "    db: args.db,\n"
    "    accountId: args.accountId,\n"
    "    conversationId: args.conversationId,\n"
    "    preview: preview || 'Tem uma nova resposta no atendimento.',\n"
    "  }).catch((error) => console.error('[website offline] notify failed:', error))\n\n"
    "  // Kept for backwards compatibility",
)
replace_once(
    path,
    "    return persistWebsiteBotMessage({\n"
    "      db,\n"
    "      conversationId: args.conversationId,\n",
    "    return persistWebsiteBotMessage({\n"
    "      db,\n"
    "      accountId: args.accountId,\n"
    "      conversationId: args.conversationId,\n",
)
# The same call shape appears in engineSendMedia; replace the next remaining occurrence.
replace_once(
    path,
    "    return persistWebsiteBotMessage({\n"
    "      db,\n"
    "      conversationId: args.conversationId,\n",
    "    return persistWebsiteBotMessage({\n"
    "      db,\n"
    "      accountId: args.accountId,\n"
    "      conversationId: args.conversationId,\n",
)
replace_once(
    path,
    "    if (channel !== 'whatsapp') return\n",
    "    if (channel === 'website') {\n"
    "      await setWebsiteActivity(db, inbound.conversation_id, 'writing')\n"
    "      return\n"
    "    }\n"
    "    if (channel !== 'whatsapp') return\n",
)

# ---------------------------------------------------------------------------
# Human website replies clear working state and notify an offline visitor.
# ---------------------------------------------------------------------------
path = 'src/app/api/whatsapp/send/route.ts'
replace_once(
    path,
    "import { getCustomerServiceWindow } from '@/lib/whatsapp/customer-service-window'\n",
    "import { getCustomerServiceWindow } from '@/lib/whatsapp/customer-service-window'\n"
    "import { setWebsiteActivity } from '@/lib/site-chat/activity'\n"
    "import { notifyWebsiteCustomerIfOffline } from '@/lib/site-chat/offline-notify'\n",
)
replace_once(
    path,
    "      if (updateError) throw updateError\n\n"
    "      return NextResponse.json({\n"
    "        success: true,\n"
    "        message_id: message.id,\n"
    "        channel: 'website',\n"
    "      })\n",
    "      if (updateError) throw updateError\n\n"
    "      await setWebsiteActivity(supabase, conversationId, null).catch((activityError) =>\n"
    "        console.error('[website activity] clear failed:', activityError),\n"
    "      )\n"
    "      await notifyWebsiteCustomerIfOffline({\n"
    "        db: supabase,\n"
    "        accountId,\n"
    "        conversationId,\n"
    "        preview: preview || 'Tem uma nova resposta no atendimento.',\n"
    "      }).catch((notifyError) => console.error('[website offline] notify failed:', notifyError))\n\n"
    "      return NextResponse.json({\n"
    "        success: true,\n"
    "        message_id: message.id,\n"
    "        channel: 'website',\n"
    "      })\n",
)

# ---------------------------------------------------------------------------
# AI catalogue tool: expose truthful searching state while the tool runs.
# ---------------------------------------------------------------------------
path = 'src/lib/ai/tools.ts'
replace_once(
    path,
    "import { createAutoReplyTools as createBaseAutoReplyTools } from './operational-tools'\n",
    "import { createAutoReplyTools as createBaseAutoReplyTools } from './operational-tools'\n"
    "import { setWebsiteActivityIfWebsite } from '@/lib/site-chat/activity'\n",
)
replace_once(
    path,
    "  const executeTool = async (call: AgentToolCall): Promise<string> => {\n",
    "  const executeTool = async (call: AgentToolCall): Promise<string> => {\n"
    "    if (call.name === 'search_catalog') {\n"
    "      await setWebsiteActivityIfWebsite(args.db, args.conversationId, 'searching_catalog').catch((error) =>\n"
    "        console.error('[website activity] catalogue state failed:', error),\n"
    "      )\n"
    "    }\n",
)
