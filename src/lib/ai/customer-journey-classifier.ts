import { addContactTagIfAbsent } from '@/lib/contacts/tag-write'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { generateReply } from './generate'
import type { AiConfig, AiUsage, ChatMessage } from './types'
import { chatContentText } from './types'

export const CUSTOMER_JOURNEY_STAGES = [
  'new_contact',
  'in_service',
  'need_identified',
  'solution_identified',
  'interest_confirmed',
  'lead_qualified',
  'price_presented',
  'negotiating',
  'awaiting_decision',
  'payment_pending',
  'sale_completed',
  'lost',
  'post_sale',
  'repeat_purchase',
] as const

export type CustomerJourneyStage = (typeof CUSTOMER_JOURNEY_STAGES)[number]

const STAGE_SET = new Set<string>(CUSTOMER_JOURNEY_STAGES)

const STAGE_GUIDANCE = `
Classifique a ETAPA ACTUAL da jornada comercial desta conversa.
Responda APENAS com uma destas chaves, sem explicação, sem JSON e sem pontuação:
new_contact
in_service
need_identified
solution_identified
interest_confirmed
lead_qualified
price_presented
negotiating
awaiting_decision
payment_pending
sale_completed
lost
post_sale
repeat_purchase

Significado das etapas:
- new_contact: primeiro contacto, ainda sem necessidade identificada.
- in_service: atendimento iniciado, mas a necessidade concreta ainda não está clara.
- need_identified: já está claro o que o cliente procura ou pretende resolver.
- solution_identified: um produto/serviço concreto já foi encontrado ou apresentado como solução.
- interest_confirmed: o cliente mostrou interesse concreto numa solução específica.
- lead_qualified: existem informações suficientes para tratar a conversa como oportunidade comercial real.
- price_presented: preço, orçamento ou condições comerciais já foram apresentados ao cliente.
- negotiating: cliente e empresa estão a discutir preço, desconto, quantidade, prazo, entrega ou outras condições.
- awaiting_decision: o cliente já tem informação suficiente e indicou que vai decidir, confirmar ou responder depois.
- payment_pending: o cliente aceitou avançar e falta concluir/confirmar o pagamento.
- sale_completed: a compra ou pagamento foi efectivamente confirmado/concluído.
- lost: o cliente recusou, cancelou ou a oportunidade foi explicitamente perdida.
- post_sale: a compra já foi concluída e a conversa actual é de acompanhamento, entrega, suporte ou pós-venda.
- repeat_purchase: um cliente que já comprou anteriormente iniciou uma nova intenção de compra.

Regras obrigatórias:
- Use toda a conversa disponível, incluindo a última resposta do agente.
- Não avance uma etapa sem evidência clara.
- Preserve a etapa actual quando a nova mensagem não altera materialmente a jornada.
- Não regrida apenas porque o cliente fez uma pergunta adicional.
- sale_completed exige confirmação real de compra/pagamento; intenção de pagar é payment_pending.
- price_presented só é válido se preço/orçamento/condições já tiverem sido efectivamente apresentados.
- lost exige evidência explícita de perda/cancelamento/recusa.
- repeat_purchase exige uma nova intenção de compra depois de uma compra anterior.
`.trim()

export function parseCustomerJourneyStage(raw: string): CustomerJourneyStage | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:text|json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
    .toLowerCase()

  if (STAGE_SET.has(cleaned)) return cleaned as CustomerJourneyStage

  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const stage = (parsed as { stage?: unknown }).stage
      if (typeof stage === 'string' && STAGE_SET.has(stage.trim().toLowerCase())) {
        return stage.trim().toLowerCase() as CustomerJourneyStage
      }
    }
  } catch {
    // Fall through to conservative single-match parsing.
  }

  const matches = CUSTOMER_JOURNEY_STAGES.filter((stage) =>
    new RegExp(`(^|[^a-z_])${stage}([^a-z_]|$)`, 'i').test(cleaned),
  )
  return matches.length === 1 ? matches[0] : null
}

async function loadCurrentStage(args: {
  db: WacrmSupabaseClient
  accountId: string
  contactId: string
}): Promise<CustomerJourneyStage | null> {
  const { data: stageTags, error: tagsError } = await args.db
    .from('tags')
    .select('id, system_key')
    .eq('account_id', args.accountId)
    .eq('system_group', 'journey_stage')
    .eq('is_system', true)

  if (tagsError) throw new Error(`Journey stage tags could not be loaded: ${tagsError.message}`)
  if (!stageTags?.length) return null

  const { data: links, error: linksError } = await args.db
    .from('contact_tags')
    .select('tag_id')
    .eq('contact_id', args.contactId)
    .in(
      'tag_id',
      stageTags.map((tag) => tag.id),
    )

  if (linksError) throw new Error(`Current journey stage could not be loaded: ${linksError.message}`)

  const currentTagIds = new Set((links ?? []).map((link) => link.tag_id))
  const current = stageTags.find((tag) => currentTagIds.has(tag.id))
  const stageKey = typeof current?.system_key === 'string'
    ? current.system_key.replace(/^journey\./, '')
    : ''

  return STAGE_SET.has(stageKey) ? (stageKey as CustomerJourneyStage) : null
}

function classifierMessages(messages: ChatMessage[], assistantReply: string): ChatMessage[] {
  const projected = messages
    .slice(-12)
    .map((message) => ({
      role: message.role,
      content: chatContentText(message.content),
    }))
    .filter((message) => message.content.trim().length > 0)

  const reply = assistantReply.trim()
  if (reply) projected.push({ role: 'assistant', content: reply })
  return projected
}

export interface CustomerJourneyClassificationResult {
  stage: CustomerJourneyStage
  previousStage: CustomerJourneyStage | null
  changed: boolean
  usage: AiUsage | null
}

export async function classifyAndPersistCustomerJourney(args: {
  db: WacrmSupabaseClient
  accountId: string
  contactId: string
  conversationId: string
  config: Pick<AiConfig, 'provider' | 'model' | 'apiKey'>
  messages: ChatMessage[]
  assistantReply: string
}): Promise<CustomerJourneyClassificationResult | null> {
  const previousStage = await loadCurrentStage(args)
  const messages = classifierMessages(args.messages, args.assistantReply)
  if (messages.length === 0) return null

  const { text, usage } = await generateReply({
    config: {
      provider: args.config.provider,
      model: args.config.model,
      apiKey: args.config.apiKey,
      temperature: 0,
    },
    systemPrompt: [
      'És um classificador interno do CRM. Nunca respondas ao cliente.',
      previousStage ? `Etapa actual registada: ${previousStage}.` : 'Ainda não existe etapa registada.',
      STAGE_GUIDANCE,
    ].join('\n\n'),
    messages,
    observabilityLabel: 'Journey classifier',
  })

  const stage = parseCustomerJourneyStage(text)
  if (!stage) throw new Error(`Journey classifier returned an invalid stage: ${text.slice(0, 120)}`)

  if (stage === previousStage) {
    return { stage, previousStage, changed: false, usage }
  }

  const { data: tag, error: tagError } = await args.db
    .from('tags')
    .select('id, name')
    .eq('account_id', args.accountId)
    .eq('system_key', `journey.${stage}`)
    .eq('is_system', true)
    .maybeSingle()

  if (tagError) throw new Error(`Journey stage tag lookup failed: ${tagError.message}`)
  if (!tag) {
    console.warn('[journey classifier] stage tag missing; migrations may not be applied:', {
      accountId: args.accountId,
      stage,
    })
    return { stage, previousStage, changed: false, usage }
  }

  const added = await addContactTagIfAbsent(args.db, {
    accountId: args.accountId,
    contactId: args.contactId,
    tagId: tag.id,
  })

  console.info('[journey classifier] classified conversation:', {
    conversationId: args.conversationId,
    contactId: args.contactId,
    previousStage,
    stage,
    tag: tag.name,
    changed: added,
  })

  return { stage, previousStage, changed: added, usage }
}
