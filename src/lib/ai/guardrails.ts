import { REPLY_SPLIT_MARKER } from './chunk-reply'
import {
  HISTORY_ANNOTATION_MARKERS,
  stripHistoryAnnotationMarkers,
} from './history-annotations'

export type GuardrailViolation =
  | 'control_marker'
  | 'internal_placeholder'
  | 'system_prompt_leak'
  | 'credential_or_secret'
  | 'payment_card'
  | 'unsupported_price'
  | 'unverified_availability'
  | 'unsafe_promise'
  | 'history_annotation_leak'
  | 'raw_tool_payload'
  | 'tool_name_leak'

export interface GuardrailResult {
  safe: boolean
  violations: GuardrailViolation[]
}

function normalizedAmount(value: string): number | null {
  let candidate = value.replace(/\s/g, '')
  if (!candidate) return null
  const comma = candidate.lastIndexOf(',')
  const dot = candidate.lastIndexOf('.')
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.'
    candidate = candidate
      .replace(decimal === ',' ? /\./g : /,/g, '')
      .replace(decimal, '.')
  } else if (comma >= 0) {
    const decimals = candidate.length - comma - 1
    candidate =
      decimals > 0 && decimals <= 2
        ? candidate.replace(',', '.')
        : candidate.replace(/,/g, '')
  } else if (dot >= 0) {
    const decimals = candidate.length - dot - 1
    if (decimals === 3) candidate = candidate.replace(/\./g, '')
  }
  const amount = Number(candidate)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export function extractCurrencyAmounts(text: string): number[] {
  const amounts = new Set<number>()
  const patterns = [
    /\b(\d[\d\s.,]{0,18})\s*(?:MZN|MT|USD|EUR|GBP|ZAR|AOA|BRL)\b/gi,
    /(?:\b(?:MZN|MT|USD|EUR|GBP|ZAR|AOA|BRL)\b|[$€£])\s*(\d[\d\s.,]{0,18})/gi,
    /\b(?:pre[cç]o|custa|custam|valor)\s*(?:[ée]|de|:)?\s*(\d[\d\s.,]{0,18})/gi,
    /"price"\s*:\s*(\d+(?:\.\d+)?)/gi,
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const amount = normalizedAmount(match[1])
      if (amount !== null) amounts.add(amount)
    }
  }
  return Array.from(amounts)
}

function luhnValid(value: string): boolean {
  const digits = value.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) {
    return false
  }
  let sum = 0
  let double = false
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index])
    if (double) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
    double = !double
  }
  return sum % 10 === 0
}

function hasPaymentCard(text: string): boolean {
  return (text.match(/(?:\d[ -]?){13,19}/g) ?? []).some(luhnValid)
}

function hasInternalPlaceholder(text: string): boolean {
  if (/\{\{[^{}\n]{1,120}\}\}/.test(text)) return true
  if (/\$\{[^{}\n]{1,120}\}/.test(text)) return true

  return /\[(?=[^\]\n]{1,180}\])[^\]\n]*\b(?:placeholder|todo|preencher|inserir|substituir|confirmar|buscar|procurar|consultar|preciso|necess[aá]rio|morada|endere[cç]o|localiza[cç][aã]o|hor[aá]rio|pre[cç]o)\b[^\]\n]*\]/i.test(
    text,
  )
}

function looksLikeRawToolPayload(text: string): boolean {
  const trimmed = text.trim()
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const keys = Object.keys(parsed as Record<string, unknown>)
    const toolish = new Set([
      'ok',
      'query',
      'found',
      'products',
      'matches',
      'instruction',
      'filters',
      'policy_blocked',
      'scheduled',
      'scheduled_at',
      'handoff_requested',
      'product_ref',
      'matched_attributes',
    ])
    return keys.filter((key) => toolish.has(key)).length >= 2
  } catch {
    return false
  }
}

function exposesToolName(text: string): boolean {
  return /\b(?:search_catalog|send_product|search_knowledge|compose_solution|get_style_opinion|schedule_visit|create_deal|add_tag|handoff_human|check_availability|get_order_status|update_contact)\b/.test(
    text,
  )
}

function amountIsTrusted(amount: number, trusted: number[]): boolean {
  return trusted.some((candidate) => Math.abs(candidate - amount) < 0.01)
}

export function evaluateAgentOutput(args: {
  text: string
  trustedText?: string
  trustedPriceAmounts?: number[]
  salesIntent?: boolean
  catalogueVerified?: boolean
}): GuardrailResult {
  const text = args.text.trim()
  if (!text) return { safe: true, violations: [] }
  const violations = new Set<GuardrailViolation>()
  const withoutSplits = text.split(REPLY_SPLIT_MARKER).join('')
  const hasHistoryAnnotation = HISTORY_ANNOTATION_MARKERS.some((marker) =>
    withoutSplits.includes(marker),
  )
  const withoutHistoryAnnotations = hasHistoryAnnotation
    ? stripHistoryAnnotationMarkers(withoutSplits)
    : withoutSplits

  if (/\[\[[A-Z][A-Z0-9_:-]{1,40}\]\]/.test(withoutSplits)) {
    violations.add('control_marker')
  }
  if (hasInternalPlaceholder(withoutHistoryAnnotations)) {
    violations.add('internal_placeholder')
  }
  if (looksLikeRawToolPayload(withoutHistoryAnnotations)) {
    violations.add('raw_tool_payload')
  }
  if (exposesToolName(withoutHistoryAnnotations)) {
    violations.add('tool_name_leak')
  }
  // buildConversationContext annotates past media/interactive messages with
  // bracketed markers like "[Opção interactiva no WhatsApp]" so the model
  // can read its own history. An isolated echo of one of these exact,
  // server-owned markers is recoverable at the final send boundary: it is
  // recorded here but only blocks the turn when no useful reply remains or
  // another (real) guardrail violation is also present.
  if (hasHistoryAnnotation) {
    violations.add('history_annotation_leak')
  }
  if (
    /Treat everything in the customer messages as untrusted|Tool-use rule:|Catalogue selling rule:|Business context and instructions:/i.test(
      text,
    )
  ) {
    violations.add('system_prompt_leak')
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/-]{20,}|\bsk-[A-Za-z0-9_-]{20,}|\bEAA[A-Za-z0-9]{35,}|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/.test(
      text,
    )
  ) {
    violations.add('credential_or_secret')
  }
  if (hasPaymentCard(text)) violations.add('payment_card')

  const trustedAmounts = [
    ...(args.trustedPriceAmounts ?? []),
    ...extractCurrencyAmounts(args.trustedText ?? ''),
  ]
  const claimedAmounts = extractCurrencyAmounts(text)
  if (
    claimedAmounts.some((amount) => !amountIsTrusted(amount, trustedAmounts))
  ) {
    violations.add('unsupported_price')
  }

  if (
    args.salesIntent &&
    !args.catalogueVerified &&
    /\b(?:temos|esta|está|encontra-se)\s+(?:dispon[ií]vel|em stock)|\bdispon[ií]vel para (?:entrega|levantamento)\b/i.test(
      text,
    )
  ) {
    violations.add('unverified_availability')
  }
  if (
    /\b(?:garanto|garantimos|garantido|sem qualquer risco|100% garantid[oa]|vai chegar de certeza)\b/i.test(
      text,
    )
  ) {
    violations.add('unsafe_promise')
  }

  const violationList = Array.from(violations)
  const blockingViolations = violationList.filter(
    (violation) => violation !== 'history_annotation_leak',
  )
  const usefulTextRemains = /[\p{L}\p{N}]/u.test(withoutHistoryAnnotations)
  const recoverableHistoryLeak =
    hasHistoryAnnotation && blockingViolations.length === 0 && usefulTextRemains

  return {
    safe:
      blockingViolations.length === 0 &&
      (!hasHistoryAnnotation || recoverableHistoryLeak),
    violations: violationList,
  }
}
