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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    const { data, error } = await supabase
      .from('catalog_collections')
      .select('id, name, description, is_default, is_active, created_at, updated_at')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (error) throw error
    if (!data) return NextResponse.json({ error: 'Catálogo não encontrado.' }, { status: 404 })

    const { count, error: countError } = await supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('catalog_id', id)
    if (countError) throw countError

    return NextResponse.json({ collection: { ...data, product_count: count ?? 0 } })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    }

    const input = body as Record<string, unknown>
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in input) {
      const name = optionalText(input.name, 160)
      if (!name) return NextResponse.json({ error: 'O nome do catálogo é obrigatório.' }, { status: 400 })
      update.name = name
    }
    if ('description' in input) update.description = optionalText(input.description, 1200)
    if ('is_active' in input) update.is_active = input.is_active === true

    const { data, error } = await supabase
      .from('catalog_collections')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, name, description, is_default, is_active, created_at, updated_at')
      .single()
    if (error) throw error

    return NextResponse.json({ collection: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params

    const { data: target, error: targetError } = await supabase
      .from('catalog_collections')
      .select('id, name, is_default')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (targetError) throw targetError
    if (!target) return NextResponse.json({ error: 'Catálogo não encontrado.' }, { status: 404 })

    const { data: alternatives, error: alternativesError } = await supabase
      .from('catalog_collections')
      .select('id, name, is_default')
      .eq('account_id', accountId)
      .neq('id', id)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true })
    if (alternativesError) throw alternativesError

    const fallback = alternatives?.[0] ?? null
    const { count, error: countError } = await supabase
      .from('catalog_products')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('catalog_id', id)
    if (countError) throw countError

    if (!fallback && (count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Este é o único catálogo e ainda contém itens. Crie outro catálogo antes de o apagar.' },
        { status: 409 },
      )
    }

    if (fallback) {
      if (target.is_default) {
        const { error: clearDefaultError } = await supabase
          .from('catalog_collections')
          .update({ is_default: false })
          .eq('id', id)
          .eq('account_id', accountId)
        if (clearDefaultError) throw clearDefaultError

        const { error: setDefaultError } = await supabase
          .from('catalog_collections')
          .update({ is_default: true })
          .eq('id', fallback.id)
          .eq('account_id', accountId)
        if (setDefaultError) throw setDefaultError
      }

      if ((count ?? 0) > 0) {
        const { error: moveError } = await supabase
          .from('catalog_products')
          .update({ catalog_id: fallback.id })
          .eq('account_id', accountId)
          .eq('catalog_id', id)
        if (moveError) throw moveError
      }
    }

    const { error } = await supabase
      .from('catalog_collections')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId)
    if (error) throw error

    return NextResponse.json({
      ok: true,
      moved_items: count ?? 0,
      fallback: fallback ? { id: fallback.id, name: fallback.name } : null,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
