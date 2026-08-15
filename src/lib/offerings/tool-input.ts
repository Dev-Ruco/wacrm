import type { OfferingAttributeScalar } from './attributes'

const MAX_ATTRIBUTES = 12
const MAX_KEY_LENGTH = 80
const MAX_STRING_LENGTH = 200

/**
 * Parse the provider-neutral `search_catalog.attributes` payload. The model is
 * allowed to submit only scalar hard constraints; whether a key/value actually
 * exists for this tenant is validated later against offering definitions.
 */
export function parseOfferingAttributeToolInput(
  raw: unknown,
): Record<string, OfferingAttributeScalar> | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new Error('attributes must be an array.')
  if (raw.length > MAX_ATTRIBUTES) throw new Error(`attributes supports at most ${MAX_ATTRIBUTES} items.`)

  const parsed: Record<string, OfferingAttributeScalar> = {}
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Each attributes item must be an object.')
    }
    const row = item as Record<string, unknown>
    const key = typeof row.key === 'string' ? row.key.trim() : ''
    if (!key) throw new Error('attributes[].key is required.')
    if (key.length > MAX_KEY_LENGTH) throw new Error('attributes[].key is too long.')
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      throw new Error(`Duplicate catalogue attribute: ${key}`)
    }

    const value = row.value
    if (typeof value === 'string') {
      const cleaned = value.trim()
      if (!cleaned) throw new Error(`attributes.${key} cannot be empty.`)
      if (cleaned.length > MAX_STRING_LENGTH) throw new Error(`attributes.${key} is too long.`)
      parsed[key] = cleaned
      continue
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`attributes.${key} must be a finite number.`)
      parsed[key] = value
      continue
    }
    if (typeof value === 'boolean') {
      parsed[key] = value
      continue
    }

    throw new Error(`attributes.${key} must be text, number or boolean.`)
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined
}
