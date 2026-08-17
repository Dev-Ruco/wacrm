import { Buffer } from 'node:buffer'
import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { assertPublicHttpsImageUrl } from '@/lib/catalog/media-proxy'
import {
  normalizeCatalogIdentity,
  parseCatalogPackage,
  type CatalogPackageProduct,
} from '@/lib/catalog/package-import'

export const runtime = 'nodejs'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_LOCALIZED_IMAGES = 5_000
const IMAGE_TIMEOUT_MS = 15_000
const IMAGE_CONCURRENCY = 6
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
])

type DbRow = Record<string, unknown>

interface ImageCopyResult {
  source: string
  localUrl: string
  copied: boolean
  error?: string
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function fetchPublicImage(raw: string): Promise<{ bytes: Buffer; contentType: string; extension: string }> {
  let current = assertPublicHttpsImageUrl(raw)

  for (let redirect = 0; redirect < 4; redirect += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': 'WACRM-Catalog-Importer/1.0' },
      })
    } finally {
      clearTimeout(timeout)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('A imagem redireccionou sem indicar destino.')
      current = assertPublicHttpsImageUrl(new URL(location, current).toString())
      continue
    }

    if (!response.ok) throw new Error(`A imagem respondeu HTTP ${response.status}.`)
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? ''
    const extension = IMAGE_TYPES.get(contentType)
    if (!extension) throw new Error(`Formato de imagem não suportado: ${contentType || 'desconhecido'}.`)

    const announcedSize = Number(response.headers.get('content-length') ?? 0)
    if (Number.isFinite(announcedSize) && announcedSize > MAX_IMAGE_BYTES) {
      throw new Error('A imagem excede 5 MB.')
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('A imagem está vazia ou excede 5 MB.')
    }
    return { bytes, contentType, extension }
  }

  throw new Error('A imagem excedeu o limite de redireccionamentos.')
}

async function copyImage(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  source: string,
  remoteUrl: string,
): Promise<ImageCopyResult> {
  try {
    const image = await fetchPublicImage(remoteUrl)
    const safeSource = source.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'package'
    const path = `${accountId}/imports/${safeSource}/${crypto.randomUUID()}.${image.extension}`
    const { error } = await supabase.storage.from('catalog-products').upload(path, image.bytes, {
      contentType: image.contentType,
      upsert: false,
      cacheControl: '31536000',
    })
    if (error) throw error
    const { data } = supabase.storage.from('catalog-products').getPublicUrl(path)
    return { source: remoteUrl, localUrl: data.publicUrl, copied: true }
  } catch (error) {
    return {
      source: remoteUrl,
      localUrl: remoteUrl,
      copied: false,
      error: error instanceof Error ? error.message : 'Falha ao copiar a imagem.',
    }
  }
}

async function localizePackageImages(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  source: string,
  products: readonly CatalogPackageProduct[],
): Promise<{ urls: Map<string, string>; copied: number; failed: number; skipped: number; errors: string[] }> {
  const unique = new Set<string>()
  for (const product of products) {
    if (product.imageUrl) unique.add(product.imageUrl)
    for (const image of product.images) unique.add(image)
    for (const variant of product.variants) if (variant.imageUrl) unique.add(variant.imageUrl)
  }

  const all = Array.from(unique)
  const targets = all.slice(0, MAX_LOCALIZED_IMAGES)
  const urls = new Map<string, string>()
  const errors: string[] = []
  let copied = 0
  let failed = 0
  let cursor = 0

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor
      cursor += 1
      const remote = targets[index]
      const result = await copyImage(supabase, accountId, source, remote)
      urls.set(remote, result.localUrl)
      if (result.copied) copied += 1
      else {
        failed += 1
        if (errors.length < 20) errors.push(`${remote}: ${result.error ?? 'falha'}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, targets.length || 1) }, () => worker()))
  for (const remote of all.slice(MAX_LOCALIZED_IMAGES)) urls.set(remote, remote)

  return { urls, copied, failed, skipped: Math.max(0, all.length - targets.length), errors }
}

function localUrl(imageMap: Map<string, string>, value: string | null): string | null {
  return value ? imageMap.get(value) ?? value : null
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const form = await request.formData()
    const file = form.get('file')
    const catalogId = String(form.get('catalog_id') ?? '').trim()
    const copyImages = String(form.get('copy_images') ?? 'true') !== 'false'

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Seleccione um ficheiro JSON de catálogo.' }, { status: 400 })
    }
    if (!catalogId) return NextResponse.json({ error: 'catalog_id é obrigatório.' }, { status: 400 })
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'O ficheiro de catálogo deve ter no máximo 12 MB.' }, { status: 400 })
    }

    const { data: collection, error: collectionError } = await supabase
      .from('catalog_collections')
      .select('id, name')
      .eq('id', catalogId)
      .eq('account_id', accountId)
      .maybeSingle()
    if (collectionError) throw collectionError
    if (!collection) return NextResponse.json({ error: 'Catálogo de destino não encontrado.' }, { status: 404 })

    let json: unknown
    try {
      json = JSON.parse(await file.text())
    } catch {
      return NextResponse.json({ error: 'O ficheiro não contém JSON válido.' }, { status: 400 })
    }
    const pkg = parseCatalogPackage(json)

    const imageResult = copyImages
      ? await localizePackageImages(supabase, accountId, pkg.source, pkg.products)
      : { urls: new Map<string, string>(), copied: 0, failed: 0, skipped: 0, errors: [] as string[] }

    const { data: existingRows, error: existingError } = await supabase
      .from('catalog_products')
      .select('id, external_id, name, metadata')
      .eq('account_id', accountId)
      .eq('catalog_id', catalogId)
    if (existingError) throw existingError

    const byExternalId = new Map<string, DbRow>()
    const byName = new Map<string, DbRow[]>()
    for (const row of (existingRows ?? []) as DbRow[]) {
      if (row.external_id) byExternalId.set(String(row.external_id), row)
      const key = normalizeCatalogIdentity(String(row.name ?? ''))
      if (key) byName.set(key, [...(byName.get(key) ?? []), row])
    }

    let productsCreated = 0
    let productsUpdated = 0
    let variantsCreated = 0
    let variantsUpdated = 0
    let variantsDeactivated = 0

    for (const product of pkg.products) {
      const exactNameMatches = byName.get(normalizeCatalogIdentity(product.name)) ?? []
      const existing = (product.externalId ? byExternalId.get(product.externalId) : undefined)
        ?? (exactNameMatches.length === 1 ? exactNameMatches[0] : undefined)
      const gallery = product.images.map((image) => localUrl(imageResult.urls, image)).filter((image): image is string => Boolean(image))
      const productImage = localUrl(imageResult.urls, product.imageUrl) ?? gallery[0] ?? null
      const productStock = product.stockQuantity ?? (
        product.variants.length > 0
          ? product.variants.filter((variant) => variant.isActive).reduce((sum, variant) => sum + (variant.stockQuantity ?? 0), 0)
          : null
      )
      const currentMetadata = object(existing?.metadata)
      const metadata = {
        ...currentMetadata,
        import_source: pkg.source,
        import_external_id: product.externalId,
        import_exported_at: pkg.exportedAt,
        import_gallery: gallery,
      }
      const row = {
        account_id: accountId,
        catalog_id: catalogId,
        source_id: null,
        external_id: product.externalId,
        name: product.name,
        description: product.description,
        price: product.price,
        currency: product.currency,
        category: product.category,
        color: product.color,
        stock_quantity: productStock,
        image_url: productImage,
        product_url: product.productUrl,
        is_active: product.isActive,
        metadata,
      }

      let productId: string
      if (existing?.id) {
        productId = String(existing.id)
        const { error } = await supabase
          .from('catalog_products')
          .update(row)
          .eq('id', productId)
          .eq('account_id', accountId)
        if (error) throw error
        productsUpdated += 1
      } else {
        const { data: inserted, error } = await supabase
          .from('catalog_products')
          .insert(row)
          .select('id, external_id, name, metadata')
          .single()
        if (error) throw error
        productId = String(inserted.id)
        productsCreated += 1
        if (product.externalId) byExternalId.set(product.externalId, inserted as DbRow)
        const key = normalizeCatalogIdentity(product.name)
        byName.set(key, [...(byName.get(key) ?? []), inserted as DbRow])
      }

      const { data: currentVariants, error: variantsError } = await supabase
        .from('catalog_product_variants')
        .select('id, external_id, sku, metadata')
        .eq('account_id', accountId)
        .eq('product_id', productId)
      if (variantsError) throw variantsError

      const variantByExternal = new Map<string, DbRow>()
      const variantBySku = new Map<string, DbRow>()
      for (const variantRow of (currentVariants ?? []) as DbRow[]) {
        if (variantRow.external_id) variantByExternal.set(String(variantRow.external_id), variantRow)
        if (variantRow.sku) variantBySku.set(String(variantRow.sku), variantRow)
      }
      const seenVariantIds = new Set<string>()

      for (const variant of product.variants) {
        const current = variantByExternal.get(variant.externalId) ?? (variant.sku ? variantBySku.get(variant.sku) : undefined)
        const currentVariantMetadata = object(current?.metadata)
        const variantRow = {
          account_id: accountId,
          product_id: productId,
          source_id: null,
          external_id: variant.externalId,
          sku: variant.sku,
          size: variant.size,
          color: variant.color,
          price: variant.price ?? product.price,
          stock_quantity: variant.stockQuantity,
          image_url: localUrl(imageResult.urls, variant.imageUrl),
          is_active: variant.isActive,
          metadata: {
            ...currentVariantMetadata,
            import_source: pkg.source,
            import_external_id: variant.externalId,
            import_exported_at: pkg.exportedAt,
          },
        }

        if (current?.id) {
          const id = String(current.id)
          const { error } = await supabase
            .from('catalog_product_variants')
            .update(variantRow)
            .eq('id', id)
            .eq('account_id', accountId)
          if (error) throw error
          variantsUpdated += 1
          seenVariantIds.add(id)
        } else {
          const { data: insertedVariant, error } = await supabase
            .from('catalog_product_variants')
            .insert(variantRow)
            .select('id')
            .single()
          if (error) throw error
          variantsCreated += 1
          seenVariantIds.add(String(insertedVariant.id))
        }
      }

      const staleImported = ((currentVariants ?? []) as DbRow[]).filter((variantRow) => {
        if (seenVariantIds.has(String(variantRow.id))) return false
        return object(variantRow.metadata).import_source === pkg.source
      })
      if (staleImported.length > 0) {
        const ids = staleImported.map((variantRow) => String(variantRow.id))
        const { error } = await supabase
          .from('catalog_product_variants')
          .update({ is_active: false })
          .eq('account_id', accountId)
          .in('id', ids)
        if (error) throw error
        variantsDeactivated += ids.length
      }
    }

    return NextResponse.json({
      ok: true,
      catalog: { id: collection.id, name: collection.name },
      package: {
        source: pkg.source,
        catalog_name: pkg.catalogName,
        products: pkg.products.length,
        variants: pkg.variantCount,
      },
      imported: {
        products_created: productsCreated,
        products_updated: productsUpdated,
        variants_created: variantsCreated,
        variants_updated: variantsUpdated,
        variants_deactivated: variantsDeactivated,
      },
      images: {
        copied: imageResult.copied,
        failed: imageResult.failed,
        skipped: imageResult.skipped,
        errors: imageResult.errors,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
