import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function optionalText(value: unknown, max = 1000): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text value.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('Text value is too long.')
  return cleaned
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)
    const catalogId = url.searchParams.get('catalog_id')?.trim() || null

    let query = supabase
      .from('catalog_products')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })

    if (catalogId) query = query.eq('catalog_id', catalogId)

    const { data, error } = await query
    if (error) throw error

    const products = data ?? []
    const productIds = products.map((product) => String(product.id))
    const variantsByProduct = new Map<string, Record<string, unknown>[]>()

    if (productIds.length > 0) {
      const { data: variants, error: variantsError } = await supabase
        .from('catalog_product_variants')
        .select('id, product_id, external_id, sku, size, color, price, stock_quantity, image_url, is_active')
        .eq('account_id', accountId)
        .in('product_id', productIds)
        .order('color', { ascending: true, nullsFirst: false })
        .order('size', { ascending: true, nullsFirst: false })

      if (variantsError) throw variantsError

      for (const variant of variants ?? []) {
        const productId = String(variant.product_id)
        const current = variantsByProduct.get(productId) ?? []
        current.push(variant as Record<string, unknown>)
        variantsByProduct.set(productId, current)
      }
    }

    return NextResponse.json({
      products: products.map((product) => ({
        ...product,
        variants: variantsByProduct.get(String(product.id)) ?? [],
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const input = body as Record<string, unknown>
    const name = optionalText(input.name, 200)
    const price = Number(input.price)
    if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'price must be a positive number.' }, { status: 400 })
    }

    const catalogId = optionalText(input.catalog_id, 100)
    if (catalogId) {
      const { data: collection, error: collectionError } = await supabase
        .from('catalog_collections')
        .select('id')
        .eq('id', catalogId)
        .eq('account_id', accountId)
        .maybeSingle()
      if (collectionError) throw collectionError
      if (!collection) {
        return NextResponse.json({ error: 'Catálogo não encontrado.' }, { status: 404 })
      }
    }

    const row = {
      account_id: accountId,
      catalog_id: catalogId,
      name,
      price,
      currency: optionalText(input.currency, 8) ?? 'MZN',
      image_url: optionalText(input.image_url, 2000),
      description: optionalText(input.description, 4000),
      color: optionalText(input.color, 100),
      category: optionalText(input.category, 200),
      product_url: optionalText(input.product_url, 2000),
      stock_quantity:
        input.stock_quantity == null || input.stock_quantity === ''
          ? null
          : Math.max(0, Math.floor(Number(input.stock_quantity))),
      is_active: input.is_active !== false,
    }

    const { data, error } = await supabase
      .from('catalog_products')
      .insert(row)
      .select('*')
      .single()
    if (error) throw error
    return NextResponse.json({ product: { ...data, variants: [] } }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
