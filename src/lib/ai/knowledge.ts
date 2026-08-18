import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import type { AiConfig } from './types'
import { chunkText } from './chunk'
import { embedTexts, toVectorLiteral } from './embeddings'
import { retrieveNovyraKnowledge } from './novyra-knowledge'
import { isNovyraEnabledForAgent } from './knowledge-sources'

interface MatchRow {
  id: string
  content: string
}

type BusinessKnowledgeDomain =
  | 'location'
  | 'hours'
  | 'contact'
  | 'payment'
  | 'delivery'
  | 'returns'
  | 'services'

interface BusinessKnowledgeDomainRule {
  query: RegExp
  content: RegExp
  expansion: string
}

const BUSINESS_FACT_RULES: Record<BusinessKnowledgeDomain, BusinessKnowledgeDomainRule> = {
  location: {
    query: /\b(?:onde\s+fica|onde\s+ficam|localiza(?:c|ç)[aã]o|localizacao|morada|endere(?:c|ç)o|address|location|como\s+chegar|chegar\s+(?:a|à)\s+loja)\b/i,
    content: /\b(?:morada|endere(?:c|ç)o|address|localiza(?:c|ç)[aã]o|localizacao|loja|avenida|av\.?|rua|estrada|bairro|maputo|matola)\b/i,
    expansion: 'morada endereço endereco localização localizacao loja como chegar',
  },
  hours: {
    query: /\b(?:hor[aá]rio|horarios|abre|abrem|fecha|fecham|aberto|aberta|funciona|funcionamento|atendimento|que horas|opening hours)\b/i,
    content: /\b(?:hor[aá]rio|funcionamento|aberto|aberta|abre|fecha|segunda|terça|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo|\d{1,2}\s*h)\b/i,
    expansion: 'horário horario funcionamento abertura fecho atendimento dias horas',
  },
  contact: {
    query: /\b(?:contacto|contato|telefone|telem[oó]vel|n[uú]mero|whatsapp|email|e-mail|ligar|contactar|contatar)\b/i,
    content: /\b(?:contacto|contato|telefone|telem[oó]vel|whatsapp|email|e-mail|\+?258\s*\d)\b/i,
    expansion: 'contacto contato telefone telemóvel numero número whatsapp email',
  },
  payment: {
    query: /\b(?:pagamento|pagamentos|pagar|pago|forma de pagamento|m[eé]todo de pagamento|mpesa|m-pesa|emola|e-mola|cart[aã]o|transfer[eê]ncia|cash|dinheiro)\b/i,
    content: /\b(?:pagamento|pagar|m[eé]todo|mpesa|m-pesa|emola|e-mola|cart[aã]o|transfer[eê]ncia|numer[aá]rio|dinheiro)\b/i,
    expansion: 'pagamento pagamentos formas métodos pagar mpesa emola cartão transferência numerário',
  },
  delivery: {
    query: /\b(?:entrega|entregas|entregam|fazem\s+entregas|delivery|levantar|levantamento|recolha|pickup|buscar|vir buscar|receber em casa|envio)\b/i,
    content: /\b(?:entrega|delivery|levantamento|recolha|pickup|envio|taxa de entrega|domic[ií]lio)\b/i,
    expansion: 'entrega delivery levantamento recolha pickup envio condições taxa zonas',
  },
  returns: {
    query: /\b(?:troca|trocar|devolu[cç][aã]o|devolver|reembolso|garantia|pol[ií]tica de troca|return|refund|exchange)\b/i,
    content: /\b(?:troca|devolu[cç][aã]o|reembolso|garantia|prazo|etiqueta|return|refund|exchange)\b/i,
    expansion: 'troca devolução devolucao reembolso garantia política prazo condições',
  },
  services: {
    query: /\b(?:servi[cç]o|servi[cç]os|o que fazem|o que oferece|o que oferecem|atendem|fazem o qu[eê]|service|services)\b/i,
    content: /\b(?:servi[cç]o|servi[cç]os|oferecemos|oferece|atendimento|especialidade|actividade|atividade)\b/i,
    expansion: 'serviço serviços oferece oferecemos atendimento actividade atividade',
  },
}

function businessKnowledgeDomain(query: string): BusinessKnowledgeDomain | null {
  const trimmed = query.trim()
  for (const [domain, rule] of Object.entries(BUSINESS_FACT_RULES) as Array<
    [BusinessKnowledgeDomain, BusinessKnowledgeDomainRule]
  >) {
    if (rule.query.test(trimmed)) return domain
  }
  return null
}

export function isLocationKnowledgeQuery(query: string): boolean {
  return businessKnowledgeDomain(query) === 'location'
}

export function expandKnowledgeQuery(query: string): string {
  const trimmed = query.trim()
  const domain = businessKnowledgeDomain(trimmed)
  if (!domain) return trimmed
  return `${trimmed} ${BUSINESS_FACT_RULES[domain].expansion}`
}

async function retrieveBusinessFactFallback(
  db: WacrmSupabaseClient,
  accountId: string,
  domain: BusinessKnowledgeDomain,
  limit: number,
): Promise<MatchRow[]> {
  try {
    const { data, error } = await db
      .from('ai_knowledge_chunks')
      .select('id, content')
      .eq('account_id', accountId)
      .limit(Math.max(20, Math.min(100, limit * 20)))
    if (error || !Array.isArray(data)) return []
    const contentPattern = BUSINESS_FACT_RULES[domain].content
    return (data as MatchRow[])
      .filter((row) => typeof row.content === 'string' && contentPattern.test(row.content))
      .slice(0, limit)
  } catch (err) {
    console.error(`[ai knowledge] ${domain} fallback failed:`, err)
    return []
  }
}

export async function ingestDocument(
  db: WacrmSupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'embeddingsApiKey'>,
  documentId: string,
  content: string,
): Promise<void> {
  const chunks = chunkText(content)
  const { error: delErr } = await db.from('ai_knowledge_chunks').delete().eq('document_id', documentId)
  if (delErr) throw delErr
  if (chunks.length === 0) return

  let embeddings: number[][] | null = null
  let embedError: unknown = null
  if (config.embeddingsApiKey) {
    try { embeddings = await embedTexts(config.embeddingsApiKey, chunks) }
    catch (err) { embedError = err }
  }

  const rows = chunks.map((content, i) => ({
    document_id: documentId,
    account_id: accountId,
    chunk_index: i,
    content,
    embedding: embeddings ? toVectorLiteral(embeddings[i]) : null,
  }))
  const { error: insErr } = await db.from('ai_knowledge_chunks').insert(rows)
  if (insErr) throw insErr
  if (embedError) throw embedError
}

export async function retrieveKnowledge(
  db: WacrmSupabaseClient,
  accountId: string,
  config: Pick<AiConfig, 'agentId' | 'embeddingsApiKey'>,
  queryText: string,
  k = 5,
): Promise<string[]> {
  const query = queryText.trim()
  if (!query || k <= 0) return []
  const factDomain = businessKnowledgeDomain(query)

  let externalKnowledge: string[] = []
  if (config.agentId) {
    try {
      const enabled = await isNovyraEnabledForAgent(db, accountId, config.agentId)
      if (enabled) externalKnowledge = await retrieveNovyraKnowledge(query, k)
    } catch (error) {
      console.error('[ai knowledge] NOVYRA policy/retrieval failed; continuing:', error)
    }
  }

  try {
    const { count, error } = await db
      .from('ai_knowledge_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
    if (error || !count) return externalKnowledge.slice(0, k)
  } catch {
    return externalKnowledge.slice(0, k)
  }

  const picked = new Map<string, string>()
  if (config.embeddingsApiKey) {
    try {
      const [queryEmbedding] = await embedTexts(config.embeddingsApiKey, [query])
      if (queryEmbedding) {
        const { data, error } = await db.rpc('match_ai_knowledge_semantic', {
          p_account_id: accountId,
          p_query_embedding: toVectorLiteral(queryEmbedding),
          p_match_count: k,
        })
        if (!error && Array.isArray(data)) {
          for (const row of data as MatchRow[]) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] semantic retrieval failed, falling back to FTS:', err)
    }
  }

  if (picked.size < k) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: query,
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) {
          if (picked.size >= k) break
          if (!picked.has(row.id)) picked.set(row.id, row.content)
        }
      }
    } catch (err) {
      console.error('[ai knowledge] lexical retrieval failed:', err)
    }
  }

  // Business-fact recovery is intentionally a fallback. Normal retrieval stays
  // semantic/model-driven; this only protects terse questions such as “onde
  // fica?”, “que horas abre?”, “aceitam M-Pesa?” or “fazem entregas?” when the
  // lexical form differs from the wording stored in the account knowledge.
  if (factDomain && picked.size === 0) {
    try {
      const { data, error } = await db.rpc('match_ai_knowledge_fts', {
        p_account_id: accountId,
        p_query: expandKnowledgeQuery(query),
        p_match_count: k,
      })
      if (!error && Array.isArray(data)) {
        for (const row of data as MatchRow[]) picked.set(row.id, row.content)
      }
    } catch (err) {
      console.error(`[ai knowledge] expanded ${factDomain} FTS failed:`, err)
    }
  }

  if (factDomain && picked.size === 0) {
    const fallback = await retrieveBusinessFactFallback(db, accountId, factDomain, k)
    for (const row of fallback) picked.set(row.id, row.content)
  }

  return [...externalKnowledge, ...Array.from(picked.values())].slice(0, k)
}
