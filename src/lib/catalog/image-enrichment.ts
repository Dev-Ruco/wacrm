export interface CatalogImageEnrichment {
  name: string | null
  color: string | null
  category: string | null
  description: string
  price: number | null
  currency: string | null
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned ? cleaned.slice(0, max) : null
}

function cleanPrice(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string') return null

  const raw = value.trim()
  if (!raw || !/^\s*[\d.,\s]+\s*$/.test(raw)) return null
  const compact = raw.replace(/\s+/g, '')
  const lastComma = compact.lastIndexOf(',')
  const lastDot = compact.lastIndexOf('.')
  let normalized = compact

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? ',' : '.'
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
    normalized = compact.split(thousandsSeparator).join('')
    if (decimalSeparator === ',') normalized = normalized.replace(',', '.')
  } else if (lastComma >= 0) {
    const decimals = compact.length - lastComma - 1
    normalized = decimals === 2 ? compact.replace(',', '.') : compact.replace(/,/g, '')
  } else if (lastDot >= 0) {
    const decimals = compact.length - lastDot - 1
    normalized = decimals === 2 ? compact : compact.replace(/\./g, '')
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

/**
 * The classifier is deliberately sector-neutral. It may use ordinary product
 * knowledge to make the copy commercially useful, but factual fields must be
 * grounded in the photograph. Tenant taxonomy is preferred rather than a
 * platform-owned vocabulary.
 */
export function buildCatalogImageEnrichmentPrompt(knownCategories: string[]): string {
  const categoryGuidance =
    knownCategories.length > 0
      ? `Prefer a genuinely matching category from this business vocabulary: ${knownCategories.join(', ')}. If none fits, propose a concise reusable category instead of forcing a mismatch.`
      : 'Infer a concise reusable product category from the photograph.'

  return [
    'You are a senior ecommerce catalogue merchandiser preparing one photographed item so a sales agent can understand, find and present it correctly.',
    'Work across any sector: apparel, vehicles, appliances, electronics, furniture, construction materials, tools, beauty, food packaging and other physical goods. Do not assume a sector before inspecting the image.',
    'Return ONLY one valid JSON object with exactly these keys: {"name": string|null, "color": string|null, "category": string|null, "description": string, "price": number|null, "currency": string|null}.',
    'Write name, category, colour and description in natural commercial Portuguese. Keep brand/model spellings as visibly written when they are clearly legible.',
    'NAME: create a useful commercial title, normally 3-9 words, distinctive enough to separate the item from neighbouring catalogue items. Prefer product type + defining visible style/form/variant. Avoid empty labels such as Produto, Artigo, Item or Foto. For clothing, create a natural retail name based on visibly supported garment type, cut, style and colour. For vehicles, use visible make/model only when clearly legible; otherwise name the visible vehicle class and distinguishing appearance without inventing trim, engine or year. Apply the same principle to appliances and all other goods.',
    `${categoryGuidance} The category should group similar items and must not be made artificially specific just to mirror the full product name.`,
    'DESCRIPTION: write 2-4 concise commercial sentences. Explain what the item is, the most useful visibly supported differentiators, and—when reasonably inferable from the product type—where, how or for whom it is typically useful. Make it sales-ready and searchable in natural language, not a raw list of visual attributes. You may state ordinary intended use (for example a refrigerator preserves food or sports leggings suit training), but never invent technical performance, composition, capacity or certification.',
    'PRICE: extract a numeric price only when a price is explicitly and clearly readable in the photograph (label, sign, overlay or packaging). Never estimate, infer, calculate or invent a price. If no explicit readable price exists, price MUST be null. Currency must be returned only when it is explicitly readable or unambiguous from the printed currency code/symbol; otherwise currency MUST be null.',
    'FACTUAL SAFETY: never invent brand, model, material, size, stock, dimensions, year, mileage, engine, power, capacity, warranty, origin, certification or any other factual specification that is not clearly supported by the image. If a factual field is uncertain, use null or omit that claim from the description.',
    'COLOR: return the dominant commercially useful colour only when it is clear. Use null when colour is irrelevant or uncertain.',
  ].join(' ')
}

export function parseCatalogImageEnrichment(raw: string): CatalogImageEnrichment {
  const fallback: CatalogImageEnrichment = {
    name: null,
    color: null,
    category: null,
    description: '',
    price: null,
    currency: null,
  }
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return { ...fallback, description: raw.trim().slice(0, 1200) }

  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    return {
      name: cleanText(parsed.name, 200),
      color: cleanText(parsed.color, 100),
      category: cleanText(parsed.category, 200),
      description: cleanText(parsed.description, 1200) ?? '',
      price: cleanPrice(parsed.price),
      currency: cleanText(parsed.currency, 8)?.toUpperCase() ?? null,
    }
  } catch {
    return { ...fallback, description: raw.trim().slice(0, 1200) }
  }
}
