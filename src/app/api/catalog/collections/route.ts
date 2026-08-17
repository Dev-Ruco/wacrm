import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

function optionalText(value: unknown, max: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text value.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('Text value is too long.')
  return cleaned
}

function catalogSchemaUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''

  return (
    code === 'PGRST205' ||
    code === '42703' ||
    code === '42P01' ||
    message.includes('catalog_collections') ||
    message.includes('catalog_id')
  )
}

function catalogSchemaError() {
  return NextResponse.json(
    {
      error:
        'A estrutura de catálogos ainda não está disponível na base de dados. Aplique a migration 20260816213000_catalog_collections.sql e actualize o schema cache.',
    },
    { status: 503 },
  )
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const [{ data: collections, error }, { data: productRows, error: productError }] =
      await Promise.all([
        supabase
          .from('catalog_collections')
          .select('id, name, description, is_default, is_active, created_at, updated_at')
          .eq('account_id', accountId)
          .order('updated_at', { ascending: false }),
        supabase
          .from('catalog_products')
          .select('catalog_id, is_active')
          .eq('account_id', accountId),
      ])

    if (error) throw error
    if (productError) throw productError

    const counts = new Map<string, { total: number; active: number }>()
    for (const row of productRows ?? []) {
      if (!row.catalog_id) continue
      const current = counts.get(row.catalog_id) ?? { total: 0, active: 0 }
      current.total += 1
      if (row.is_active) current.active += 1
      counts.set(row.catalog_id, current)
    }

    return NextResponse.json({
      collections: (collections ?? []).map((collection) => ({
        ...collection,
        product_count: counts.get(collection.id)?.total ?? 0,
        active_product_count: counts.get(collection.id)?.active ?? 0,
      })),
    })
  } catch (error) {
    if (catalogSchemaUnavailable(error)) return catalogSchemaError()
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
    const name = optionalText(input.name, 160)
    const description = optionalText(input.description, 1200)
    if (!name) {
      return NextResponse.json({ error: 'O nome do catálogo é obrigatório.' }, { status: 400 })
    }

    const { data: existingDefault, error: defaultError } = await supabase
      .from('catalog_collections')
      .select('id')
      .eq('account_id', accountId)
      .eq('is_default', true)
      .maybeSingle()
    if (defaultError) throw defaultError

    const { data, error } = await supabase
      .from('catalog_collections')
      .insert({
        account_id: accountId,
        name,
        description,
        is_default: !existingDefault,
        is_active: input.is_active !== false,
      })
      .select('id, name, description, is_default, is_active, created_at, updated_at')
      .single()
    if (error) throw error

    return NextResponse.json(
      { collection: { ...data, product_count: 0, active_product_count: 0 } },
      { status: 201 },
    )
  } catch (error) {
    if (catalogSchemaUnavailable(error)) return catalogSchemaError()
    return toErrorResponse(error)
  }
}
