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

function optionalNonNegativeNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Invalid non-negative number.')
  return parsed
}

async function refreshProductStock(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
  productId: string,
) {
  const { data, error } = await supabase
    .from('catalog_product_variants')
    .select('stock_quantity, is_active')
    .eq('account_id', accountId)
    .eq('product_id', productId)

  if (error) throw error

  const active = data ?? []
  const stock = active
    .filter((variant) => variant.is_active !== false)
    .reduce((total, variant) => total + Math.max(0, Number(variant.stock_quantity ?? 0)), 0)

  const { error: productError } = await supabase
    .from('catalog_products')
    .update({ stock_quantity: stock, updated_at: new Date().toISOString() })
    .eq('id', productId)
    .eq('account_id', accountId)

  if (productError) throw productError
  return stock
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const { data: current, error: currentError } = await supabase
      .from('catalog_product_variants')
      .select('id, product_id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (currentError) throw currentError
    if (!current) return NextResponse.json({ error: 'Variante não encontrada.' }, { status: 404 })

    const input = body as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if ('sku' in input) update.sku = optionalText(input.sku, 240)
    if ('size' in input) update.size = optionalText(input.size, 160)
    if ('color' in input) update.color = optionalText(input.color, 160)
    if ('image_url' in input) update.image_url = optionalText(input.image_url, 2000)
    if ('price' in input) update.price = optionalNonNegativeNumber(input.price)
    if ('stock_quantity' in input) {
      const value = optionalNonNegativeNumber(input.stock_quantity)
      update.stock_quantity = value == null ? null : Math.floor(value)
    }
    if ('is_active' in input) update.is_active = input.is_active === true

    const { data: variant, error } = await supabase
      .from('catalog_product_variants')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, product_id, external_id, sku, size, color, price, stock_quantity, image_url, is_active')
      .single()

    if (error) throw error

    const productStock = await refreshProductStock(supabase, accountId, String(current.product_id))

    return NextResponse.json({ variant, product_stock_quantity: productStock })
  } catch (error) {
    return toErrorResponse(error)
  }
}
