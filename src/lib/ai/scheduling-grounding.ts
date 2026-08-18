const DATE_PATTERNS = [
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/i,
  /\b\d{4}-\d{2}-\d{2}\b/i,
  /(?:^|\s)(?:hoje|amanha|amanhã|depois de amanha|depois de amanhã)(?=$|\s|[,.?!;:])/i,
  /(?:^|\s)(?:segunda(?:-feira)?|terca(?:-feira)?|terça(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|sábado|domingo)(?=$|\s|[,.?!;:])/i,
  /\bdia\s+\d{1,2}\b/i,
  /\b\d{1,2}\s+de\s+(?:janeiro|fevereiro|marco|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?=$|\s|[,.?!;:])/i,
]

const TIME_PATTERNS = [
  /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/,
  /\b(?:[01]?\d|2[0-3])h(?:[0-5]\d)?\b/i,
  /(?:^|\s)(?:as|às|pelas?)\s+(?:[01]?\d|2[0-3])(?:[:h](?:[0-5]\d)?)?(?:\s*horas?)?(?=$|\s|[,.?!;:])/i,
]

function hasPattern(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text))
}

export interface SchedulingEvidence {
  hasDate: boolean
  hasTime: boolean
}

/**
 * Scheduling is an irreversible customer-facing action. The model may infer
 * an ISO timestamp for a date/time the customer actually supplied, but it may
 * never invent either component. We inspect only the newest few customer
 * messages so stale dates from unrelated earlier conversation do not qualify.
 */
export function schedulingEvidence(customerMessages: readonly string[]): SchedulingEvidence {
  const newest = customerMessages
    .map((message) => message.trim())
    .filter(Boolean)
    .slice(-3)

  return {
    hasDate: newest.some((message) => hasPattern(message, DATE_PATTERNS)),
    hasTime: newest.some((message) => hasPattern(message, TIME_PATTERNS)),
  }
}

export function schedulingEvidenceIsComplete(customerMessages: readonly string[]): boolean {
  const evidence = schedulingEvidence(customerMessages)
  return evidence.hasDate && evidence.hasTime
}
