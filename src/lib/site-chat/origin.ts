function normalizeExactOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

function matchesWildcardOrigin(origin: string, pattern: string): boolean {
  const match = pattern
    .trim()
    .replace(/\/$/, '')
    .match(/^(https?):\/\/\*\.([a-z0-9.-]+)(?::(\d+))?$/i)

  if (!match) return false

  try {
    const url = new URL(origin)
    const protocol = `${match[1].toLowerCase()}:`
    const suffix = match[2].toLowerCase()
    const expectedPort = match[3] ?? ''
    const hostname = url.hostname.toLowerCase()

    return (
      url.protocol === protocol &&
      url.port === expectedPort &&
      hostname !== suffix &&
      hostname.endsWith(`.${suffix}`)
    )
  } catch {
    return false
  }
}

/**
 * Website channel origin allow-list matcher.
 *
 * Supported entries:
 * - exact origins, e.g. https://lcfitness.co.mz
 * - controlled subdomain wildcards, e.g. https://*.lovable.app
 *
 * A wildcard never matches the apex domain and never crosses protocols.
 * An empty allow-list preserves the existing public-key behaviour and allows
 * any origin for that channel.
 */
export function isWebsiteOriginAllowed(
  origin: string,
  allowedOrigins: string[] | null | undefined,
): boolean {
  const allowed = allowedOrigins ?? []
  if (allowed.length === 0) return true
  if (!origin) return false

  const normalizedOrigin = normalizeExactOrigin(origin)
  if (!normalizedOrigin) return false

  return allowed.some((pattern) => {
    if (pattern.includes('*')) {
      return matchesWildcardOrigin(normalizedOrigin, pattern)
    }

    const normalizedPattern = normalizeExactOrigin(pattern)
    return normalizedPattern === normalizedOrigin
  })
}
