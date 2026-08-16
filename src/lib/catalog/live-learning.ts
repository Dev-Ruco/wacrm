import { supabaseAdmin } from '@/lib/ai/admin-client'

export type CatalogLearningRetrievalKind = 'catalog' | 'composition'
export type CatalogLearningOutcome = 'gap' | 'handoff'

export interface LiveCatalogLearningInput {
  accountId: string
  conversationId: string
  requestText: string
  retrievalKind: CatalogLearningRetrievalKind
  outcome: CatalogLearningOutcome
}

export interface LiveCatalogLearningIssue {
  issueType: string
  severity: 'warning' | 'critical'
  title: string
  description: string
  proposedChanges: Record<string, unknown>
  evidence: Record<string, unknown>
  confidence: number
}

function normalizeFingerprintText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** A tiny deterministic hash keeps issue_type short without storing raw text in a key. */
function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Keep only a short, useful request excerpt for catalogue stewardship.
 * The model-facing catalogue query is not available at this layer, so the
 * latest customer turn is used after removing common direct identifiers.
 */
export function sanitizeCatalogLearningRequest(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removido]')
    .replace(/https?:\/\/\S+/gi, '[link removido]')
    .replace(/(?:\+?\d[\s().-]*){7,}\d/g, '[número removido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
}

export function buildLiveCatalogLearningIssue(
  input: Omit<LiveCatalogLearningInput, 'accountId' | 'conversationId'>,
  nowIso = new Date().toISOString(),
): LiveCatalogLearningIssue | null {
  const requestExcerpt = sanitizeCatalogLearningRequest(input.requestText)
  if (!requestExcerpt) return null

  const fingerprint = stableHash(
    `${input.retrievalKind}|${normalizeFingerprintText(requestExcerpt)}`,
  )
  const issueType = `live_${input.retrievalKind}_gap_${fingerprint}`
  const isHandoff = input.outcome === 'handoff'
  const subject = input.retrievalKind === 'composition' ? 'composição' : 'catálogo'

  return {
    issueType,
    severity: isHandoff ? 'critical' : 'warning',
    title: isHandoff
      ? `Lacuna de ${subject} levou a atendimento humano`
      : `Pedido real sem cobertura suficiente no ${subject}`,
    description: isHandoff
      ? `Numa conversa real, o agente tentou responder a “${requestExcerpt}”, não conseguiu verificar uma solução suficiente no ${subject} e o atendimento acabou encaminhado para uma pessoa.`
      : `Numa conversa real, o agente tentou responder a “${requestExcerpt}”, mas não conseguiu verificar uma solução suficiente no ${subject}.`,
    proposedChanges: {
      action:
        input.retrievalKind === 'composition'
          ? 'review_composition_coverage'
          : 'review_catalog_coverage',
      auto_apply: false,
    },
    evidence: {
      source: 'live_conversation',
      retrieval_kind: input.retrievalKind,
      request_excerpt: requestExcerpt,
      occurrences: 1,
      handoff_count: isHandoff ? 1 : 0,
      first_seen_at: nowIso,
      last_seen_at: nowIso,
    },
    confidence: 1,
  }
}

function numericEvidence(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0
}

/**
 * Best-effort operational learning. It never changes trusted catalogue facts
 * and never throws into the customer-facing agent loop.
 */
export async function recordLiveCatalogLearning(
  input: LiveCatalogLearningInput,
): Promise<void> {
  if (!input.accountId || !input.conversationId) return

  const nowIso = new Date().toISOString()
  const issue = buildLiveCatalogLearningIssue(input, nowIso)
  if (!issue) return

  try {
    const db = supabaseAdmin()
    const { data: existing, error: lookupError } = await db
      .from('catalog_steward_suggestions')
      .select('id, severity, evidence')
      .eq('account_id', input.accountId)
      .eq('status', 'pending')
      .eq('issue_type', issue.issueType)
      .is('product_id', null)
      .is('source_id', null)
      .maybeSingle()

    if (lookupError) {
      console.warn('[catalog learning] lookup failed:', lookupError.message)
      return
    }

    if (existing) {
      const previousEvidence =
        existing.evidence && typeof existing.evidence === 'object' && !Array.isArray(existing.evidence)
          ? (existing.evidence as Record<string, unknown>)
          : {}
      const nextEvidence = {
        ...previousEvidence,
        ...issue.evidence,
        first_seen_at: previousEvidence.first_seen_at ?? issue.evidence.first_seen_at,
        occurrences: numericEvidence(previousEvidence.occurrences) + 1,
        handoff_count:
          numericEvidence(previousEvidence.handoff_count) +
          (input.outcome === 'handoff' ? 1 : 0),
        last_seen_at: nowIso,
      }
      const { error: updateError } = await db
        .from('catalog_steward_suggestions')
        .update({
          severity:
            existing.severity === 'critical' || issue.severity === 'critical'
              ? 'critical'
              : 'warning',
          title: issue.title,
          description: issue.description,
          proposed_changes: issue.proposedChanges,
          evidence: nextEvidence,
          confidence: issue.confidence,
          created_by: 'ai',
        })
        .eq('id', existing.id)
        .eq('account_id', input.accountId)
      if (updateError) {
        console.warn('[catalog learning] update failed:', updateError.message)
      }
      return
    }

    const { error: insertError } = await db.from('catalog_steward_suggestions').insert({
      account_id: input.accountId,
      product_id: null,
      source_id: null,
      issue_type: issue.issueType,
      severity: issue.severity,
      title: issue.title,
      description: issue.description,
      proposed_changes: issue.proposedChanges,
      evidence: issue.evidence,
      confidence: issue.confidence,
      status: 'pending',
      created_by: 'ai',
    })

    // A concurrent request may have inserted the same fingerprint after our
    // lookup. The unique pending-suggestion index intentionally deduplicates
    // it; missing one occurrence counter is preferable to impacting chat.
    if (insertError && insertError.code !== '23505') {
      console.warn('[catalog learning] insert failed:', insertError.message)
    }
  } catch (error) {
    console.warn('[catalog learning] recorder failed:', error)
  }
}
