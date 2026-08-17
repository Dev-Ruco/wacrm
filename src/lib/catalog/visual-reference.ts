export type VisualReferenceConfidence = 'high' | 'medium' | 'low'

export interface VisualReferenceAssessment {
  candidate: string
  score: number
  reason: string
}

function extractJsonObject(text: string): string | null {
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last <= first) return null
  return text.slice(first, last + 1)
}

/**
 * Parse the deliberately tiny JSON contract returned by the visual matcher.
 * Candidate ids are server-generated and only ids that were actually sent to
 * the model are accepted. This prevents a model response from fabricating a
 * product reference or smuggling catalogue facts back into the runtime.
 */
export function parseVisualReferenceAssessments(
  text: string,
  allowedCandidateIds: readonly string[],
): VisualReferenceAssessment[] {
  const json = extractJsonObject(text)
  if (!json) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return []
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const rawMatches = (parsed as { matches?: unknown }).matches
  if (!Array.isArray(rawMatches)) return []

  const allowed = new Set(allowedCandidateIds)
  const bestByCandidate = new Map<string, VisualReferenceAssessment>()

  for (const raw of rawMatches) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const row = raw as Record<string, unknown>
    const candidate = typeof row.candidate === 'string' ? row.candidate.trim() : ''
    if (!candidate || !allowed.has(candidate)) continue

    const numericScore = typeof row.score === 'number'
      ? row.score
      : typeof row.score === 'string'
        ? Number(row.score)
        : Number.NaN
    if (!Number.isFinite(numericScore)) continue

    const score = Math.max(0, Math.min(100, Math.round(numericScore)))
    const reason = typeof row.reason === 'string'
      ? row.reason.trim().replace(/\s+/g, ' ').slice(0, 220)
      : ''
    const assessment = { candidate, score, reason }
    const previous = bestByCandidate.get(candidate)
    if (!previous || assessment.score > previous.score) {
      bestByCandidate.set(candidate, assessment)
    }
  }

  return Array.from(bestByCandidate.values()).sort(
    (a, b) => b.score - a.score || a.candidate.localeCompare(b.candidate),
  )
}

/**
 * A high-confidence visual match requires both a strong absolute score and
 * enough separation from the runner-up. Similar products must remain
 * ambiguous rather than being turned into a false exact-match claim.
 */
export function visualReferenceConfidence(
  topScore: number,
  runnerUpScore: number | null,
): VisualReferenceConfidence {
  const top = Math.max(0, Math.min(100, topScore))
  const runnerUp = runnerUpScore === null
    ? null
    : Math.max(0, Math.min(100, runnerUpScore))

  if (top >= 88 && (runnerUp === null || top - runnerUp >= 8)) return 'high'
  if (top >= 65) return 'medium'
  return 'low'
}
