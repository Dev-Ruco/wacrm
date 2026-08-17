export interface CatalogImageEnrichment {
  name: string | null
  color: string | null
  category: string | null
  description: string
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim().replace(/\s+/g, ' ')
  return cleaned ? cleaned.slice(0, max) : null
}

/**
 * The classifier is deliberately sector-neutral. It may use ordinary product
 * knowledge to make the copy commercially useful, but factual fields must be
 * grounded in the photograph. Tenant taxonomy is preferred rather than a
 * platform-owned vocabulary.
 *
 * Price is intentionally outside this contract. AI classification must never
 * create, extract, infer, suggest, replace or correct a catalogue price.
 */
export function buildCatalogImageEnrichmentPrompt(knownCategories: string[]): string {
  const categoryGuidance =
    knownCategories.length > 0
      ? `Prefer a genuinely matching category from this business vocabulary: ${knownCategories.join(', ')}. If none fits, propose a concise reusable category instead of forcing a mismatch.`
      : 'Infer a concise reusable product category from the photograph.'

  return [
    'You are a senior ecommerce catalogue merchandiser preparing one photographed item so a sales agent can understand, find and present it correctly.',
    'Work across any sector: apparel, vehicles, appliances, electronics, furniture, construction materials, tools, beauty, food packaging and other physical goods. Do not assume a sector before inspecting the image.',
    'Return ONLY one valid JSON object with exactly these keys: {"name": string|null, "color": string|null, "category": string|null, "description": string}.',
    'Write name, category, colour and description in natural commercial Portuguese. Keep brand/model spellings as visibly written when they are clearly legible.',
    'NAME: create a useful commercial title, normally 3-9 words, distinctive enough to separate the item from neighbouring catalogue items. Prefer product type + defining visible style/form/variant. Avoid empty labels such as Produto, Artigo, Item or Foto. For clothing, create a natural retail name based on visibly supported garment type, cut, style and colour. For vehicles, use visible make/model only when clearly legible; otherwise name the visible vehicle class and distinguishing appearance without inventing trim, engine or year. Apply the same principle to appliances and all other goods.',
    `${categoryGuidance} The category should group similar items and must not be made artificially specific just to mirror the full product name.`,
    'DESCRIPTION: write 2-4 concise commercial sentences. Explain what the item is, the most useful visibly supported differentiators, and—when reasonably inferable from the product type—where, how or for whom it is typically useful. Make it sales-ready and searchable in natural language, not a raw list of visual attributes. You may state ordinary intended use (for example a refrigerator preserves food or sports leggings suit training), but never invent technical performance, composition, capacity or certification.',
    'PRICE LOCK: never extract, read, infer, estimate, calculate, suggest, return, replace or correct a price or currency, even when a price is clearly visible in the photograph. Price is human/source-owned data and is outside your task.',
    'FACTUAL SAFETY: never invent brand, model, material, size, stock, dimensions, year, mileage, engine, power, capacity, warranty, origin, certification or any other factual specification that is not clearly supported by the image. If a factual field is uncertain, omit that claim from the description.',
    'COLOR: return the dominant commercially useful colour only when it is clear. Use null when colour is irrelevant or uncertain.',
  ].join(' ')
}

export function parseCatalogImageEnrichment(raw: string): CatalogImageEnrichment {
  const fallback: CatalogImageEnrichment = {
    name: null,
    color: null,
    category: null,
    description: '',
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
    }
  } catch {
    return { ...fallback, description: raw.trim().slice(0, 1200) }
  }
}
