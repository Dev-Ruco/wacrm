import { TOOL_ACTION_CLASS } from './tool-action-class'

const MAX_STRING = 500
const MAX_ARRAY = 20
const MAX_KEYS = 30
const MAX_DEPTH = 4

const SENSITIVE_KEY_RE =
  /(api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|session|encryption[_-]?key|private[_-]?key|card[_-]?number|cvv|cvc|pin)/i
const SENSITIVE_VALUE_RE =
  /(bearer\s+[a-z0-9._~+/=-]{12,}|\bsk-[a-z0-9_-]{12,}|\beyJ[a-z0-9_-]{12,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,})/i

function cleanString(value: string, max = MAX_STRING): string {
  const compact = value.replace(/\s+/g, ' ').trim().slice(0, max)
  return SENSITIVE_VALUE_RE.test(compact) ? '[REDACTED]' : compact
}

export function sanitizeTraceMetadata(
  value: unknown,
  depth = 0,
): Record<string, unknown> {
  const cleaned = sanitizeValue(value, depth)
  return cleaned && typeof cleaned === 'object' && !Array.isArray(cleaned)
    ? (cleaned as Record<string, unknown>)
    : {}
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED]'
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return cleanString(value)
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeValue(item, depth + 1))
  }
  if (!value || typeof value !== 'object') return null

  const entries: Array<[string, unknown]> = []
  for (const [rawKey, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (entries.length >= MAX_KEYS) break
    const key = cleanString(rawKey, 80)
    if (!key) continue
    entries.push([
      key,
      SENSITIVE_KEY_RE.test(key) ? '[REDACTED]' : sanitizeValue(rawValue, depth + 1),
    ])
  }
  return Object.fromEntries(entries)
}

function jsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function text(value: unknown, max = 240): string | null {
  return typeof value === 'string' && value.trim()
    ? cleanString(value, max)
    : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function present<T>(value: T | null): value is T {
  return value !== null
}

function pickToolInput(name: string, input: Record<string, unknown> | null) {
  if (!input) return {}
  switch (name) {
    case 'search_catalog':
      return Object.fromEntries(
        [
          ['query', text(input.query, 300)],
          ['category', text(input.category, 120)],
          ['color', text(input.color, 80)],
          ['size', text(input.size, 40)],
          ['mode', text(input.mode, 20)],
          ['limit', number(input.limit)],
        ].filter((entry) => present(entry[1])),
      )
    case 'search_knowledge':
      return Object.fromEntries(
        [
          ['query', text(input.query, 300)],
          ['limit', number(input.limit)],
        ].filter((entry) => present(entry[1])),
      )
    case 'send_product':
      return Object.fromEntries(
        [
          ['product_ref', text(input.product_ref, 120)],
          ['image_index', number(input.image_index)],
          ['selected', bool(input.selected)],
        ].filter((entry) => present(entry[1])),
      )
    case 'add_tag':
      return { tag_name: text(input.tag_name, 80) }
    case 'create_deal':
      return Object.fromEntries(
        [
          ['title', text(input.title, 120)],
          ['value', number(input.value)],
        ].filter((entry) => present(entry[1])),
      )
    case 'schedule_visit':
      return { scheduled_at: text(input.scheduled_at, 80) }
    case 'get_style_opinion':
      return {
        product_ref_count: Array.isArray(input.product_refs)
          ? Math.min(input.product_refs.length, 5)
          : 0,
      }
    case 'handoff_human':
      return {
        reason: text(input.reason, 240),
        has_summary: Boolean(text(input.summary, 20)),
      }
    default:
      return { input_keys: Object.keys(input).slice(0, 20) }
  }
}

function pickToolOutput(name: string, output: Record<string, unknown> | null) {
  if (!output) return {}
  const common = {
    ok: bool(output.ok),
    has_error: Boolean(text(output.error, 20)),
    error_code: text(output.code, 80),
  }
  switch (name) {
    case 'search_catalog': {
      const products = Array.isArray(output.products) ? output.products : []
      return {
        ...common,
        found: bool(output.found),
        returned_count: products.length,
        products: products.slice(0, 5).map((product) => {
          const row = product && typeof product === 'object'
            ? (product as Record<string, unknown>)
            : {}
          return {
            product_ref: text(row.product_ref, 120),
            name: text(row.name, 160),
            category: text(row.category, 120),
            media_count: number(row.media_count),
          }
        }),
      }
    }
    case 'search_knowledge':
      return {
        ...common,
        found: bool(output.found),
        match_count: Array.isArray(output.matches) ? output.matches.length : 0,
      }
    case 'send_product': {
      const product = output.product && typeof output.product === 'object'
        ? (output.product as Record<string, unknown>)
        : {}
      return {
        ...common,
        queued: bool(output.queued),
        duplicate: bool(output.duplicate),
        no_new_media: bool(output.no_new_media),
        product: {
          product_ref: text(product.product_ref, 120),
          name: text(product.name, 160),
          image_index: number(product.image_index),
          media_count: number(product.media_count),
        },
      }
    }
    case 'add_tag': {
      const tag = output.tag && typeof output.tag === 'object'
        ? (output.tag as Record<string, unknown>)
        : {}
      return { ...common, added: bool(output.added), tag_name: text(tag.name, 80) }
    }
    case 'create_deal': {
      const deal = output.deal && typeof output.deal === 'object'
        ? (output.deal as Record<string, unknown>)
        : {}
      return {
        ...common,
        created: bool(output.created),
        duplicate: bool(output.duplicate),
        deal_title: text(deal.title, 120),
        pipeline: text(output.pipeline, 120),
        stage: text(output.stage, 120),
      }
    }
    case 'schedule_visit':
      return {
        ...common,
        scheduled: bool(output.scheduled),
        scheduled_at: text(output.scheduled_at, 80),
      }
    case 'get_style_opinion':
      return { ...common, opinion_generated: Boolean(text(output.opinion, 20)) }
    case 'handoff_human':
      return { ...common, handoff_requested: bool(output.handoff_requested) }
    default:
      return { ...common, output_keys: Object.keys(output).slice(0, 20) }
  }
}

export function toolTraceStartedMetadata(name: string, rawArguments: string) {
  return sanitizeTraceMetadata({
    action_class: TOOL_ACTION_CLASS[name] ?? null,
    input: pickToolInput(name, jsonObject(rawArguments)),
  })
}

export function toolTraceFinishedMetadata(args: {
  name: string
  rawArguments: string
  rawResult?: string | null
  error?: unknown
}) {
  return sanitizeTraceMetadata({
    action_class: TOOL_ACTION_CLASS[args.name] ?? null,
    input: pickToolInput(args.name, jsonObject(args.rawArguments)),
    output: pickToolOutput(args.name, jsonObject(args.rawResult)),
    execution_error: Boolean(args.error),
    error_name: args.error instanceof Error ? args.error.name.slice(0, 80) : null,
  })
}
