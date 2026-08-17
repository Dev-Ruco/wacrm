export const CATALOG_PACKAGE_VERSION = 1
export const MAX_PACKAGE_PRODUCTS = 5_000
export const MAX_PACKAGE_VARIANTS = 50_000

export interface CatalogPackageVariant {
  externalId: string
  sku: string | null
  size: string | null
  color: string | null
  price: number | null
  stockQuantity: number | null
  imageUrl: string | null
  isActive: boolean
}

export interface CatalogPackageProduct {
  externalId: string | null
  name: string
  description: string | null
  price: number
  currency: string
  category: string | null
  color: string | null
  stockQuantity: number | null
  imageUrl: string | null
  images: string[]
  productUrl: string | null
  isActive: boolean
  variants: CatalogPackageVariant[]
}

export interface ParsedCatalogPackage {
  version: 1
  source: string
  exportedAt: string | null
  catalogName: string | null
  products: CatalogPackageProduct[]
  variantCount: number
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, max: number, required = false): string | null {
  if (value == null || value === '') {
    if (required) throw new Error('O pacote contém um campo de texto obrigatório vazio.')
    return null
  }
  if (typeof value !== 'string') throw new Error('O pacote contém um campo de texto inválido.')
  const cleaned = value.trim()
  if (!cleaned) {
    if (required) throw new Error('O pacote contém um campo de texto obrigatório vazio.')
    return null
  }
  if (cleaned.length > max) throw new Error('O pacote contém um campo de texto demasiado longo.')
  return cleaned
}

function nonNegativeNumber(value: unknown, required = false): number | null {
  if (value == null || value === '') {
    if (required) throw new Error('O pacote contém um valor numérico obrigatório vazio.')
    return null
  }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('O pacote contém um valor numérico inválido.')
  return parsed
}

function stock(value: unknown): number | null {
  const parsed = nonNegativeNumber(value)
  return parsed == null ? null : Math.floor(parsed)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function url(value: unknown): string | null {
  const candidate = text(value, 2_000)
  if (!candidate) return null
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error(`URL inválida no pacote: ${candidate.slice(0, 100)}`)
  }
  if (parsed.protocol !== 'https:') throw new Error('As imagens e links do pacote devem usar HTTPS.')
  return parsed.toString()
}

function imageList(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('O campo images deve ser uma lista.')
  const result: string[] = []
  for (const entry of value.slice(0, 30)) {
    const candidate = typeof entry === 'string'
      ? entry
      : record(entry)?.url
    const parsed = url(candidate)
    if (parsed && !result.includes(parsed)) result.push(parsed)
  }
  return result
}

function parseVariant(value: unknown): CatalogPackageVariant {
  const input = record(value)
  if (!input) throw new Error('O pacote contém uma variante inválida.')
  const externalId = text(input.external_id ?? input.id, 240, true)
  if (!externalId) throw new Error('Cada variante precisa de external_id.')
  return {
    externalId,
    sku: text(input.sku, 240),
    size: text(input.size, 160),
    color: text(input.color, 160),
    price: nonNegativeNumber(input.price),
    stockQuantity: stock(input.stock_quantity ?? input.stock),
    imageUrl: url(input.image_url),
    isActive: bool(input.is_active, true),
  }
}

function parseProduct(value: unknown): CatalogPackageProduct {
  const input = record(value)
  if (!input) throw new Error('O pacote contém um produto inválido.')
  const name = text(input.name, 240, true)
  const price = nonNegativeNumber(input.price, true)
  if (!name || price == null) throw new Error('Cada produto precisa de nome e preço.')

  const variantsInput = input.variants == null ? [] : input.variants
  if (!Array.isArray(variantsInput)) throw new Error(`As variantes de “${name}” devem ser uma lista.`)
  const variants = variantsInput.map(parseVariant)
  const images = imageList(input.images)
  const imageUrl = url(input.image_url) ?? images[0] ?? null

  return {
    externalId: text(input.external_id ?? input.id, 240),
    name,
    description: text(input.description, 4_000),
    price,
    currency: text(input.currency, 8) ?? 'MZN',
    category: text(input.category, 240),
    color: text(input.color, 160),
    stockQuantity: stock(input.stock_quantity ?? input.stock),
    imageUrl,
    images,
    productUrl: url(input.product_url),
    isActive: bool(input.is_active, true),
    variants,
  }
}

export function normalizeCatalogIdentity(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function parseCatalogPackage(value: unknown): ParsedCatalogPackage {
  const input = record(value)
  if (!input) throw new Error('O ficheiro não contém um pacote de catálogo válido.')
  if (Number(input.version) !== CATALOG_PACKAGE_VERSION) {
    throw new Error(`Versão do pacote não suportada. Esperada: ${CATALOG_PACKAGE_VERSION}.`)
  }
  if (!Array.isArray(input.products)) throw new Error('O pacote não contém a lista products.')
  if (input.products.length > MAX_PACKAGE_PRODUCTS) {
    throw new Error(`O pacote excede o limite de ${MAX_PACKAGE_PRODUCTS} produtos.`)
  }

  const products = input.products.map(parseProduct)
  const variantCount = products.reduce((total, product) => total + product.variants.length, 0)
  if (variantCount > MAX_PACKAGE_VARIANTS) {
    throw new Error(`O pacote excede o limite de ${MAX_PACKAGE_VARIANTS} variantes.`)
  }

  const catalog = record(input.catalog)
  return {
    version: 1,
    source: text(input.source, 160) ?? 'catalog-package',
    exportedAt: text(input.exported_at, 100),
    catalogName: text(catalog?.name, 160),
    products,
    variantCount,
  }
}
