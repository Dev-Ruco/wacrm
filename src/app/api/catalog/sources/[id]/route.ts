import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { encrypt } from '@/lib/whatsapp/encryption'

function text(value: unknown, max: number): string | null {
  if (value == null || value === '') return null
  if (typeof value !== 'string') throw new Error('Expected text value.')
  const cleaned = value.trim()
  if (!cleaned) return null
  if (cleaned.length > max) throw new Error('Text value is too long.')
  return cleaned
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
    const input = body as Record<string, unknown>

    const { data: existing, error: existingError } = await supabase
      .from('catalog_sources')
      .select('id, source_type, sync_mode')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (existingError) throw existingError
    if (!existing) return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 })

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in input) {
      const name = text(input.name, 200)
      if (!name) return NextResponse.json({ error: 'name is required.' }, { status: 400 })
      update.name = name
    }
    if ('is_active' in input) update.is_active = input.is_active === true
    if ('base_url' in input) {
      const raw = text(input.base_url, 2000)
      if (!raw) return NextResponse.json({ error: 'base_url is required.' }, { status: 400 })
      const url = new URL(raw)
      if (url.protocol !== 'https:') return NextResponse.json({ error: 'base_url must use HTTPS.' }, { status: 400 })
      update.base_url = url.toString()
    }
    if ('search_path' in input) update.search_path = text(input.search_path, 2000)
    if ('sync_path' in input) update.sync_path = text(input.sync_path, 2000)
    if ('sync_mode' in input) {
      const mode = String(input.sync_mode)
      if (!['live', 'mirror'].includes(mode)) {
        return NextResponse.json({ error: 'sync_mode inválido.' }, { status: 400 })
      }
      if (mode === 'mirror' && existing.source_type !== 'external_supabase') {
        return NextResponse.json(
          { error: 'O modo espelho canónico está disponível actualmente para fontes Supabase externas.' },
          { status: 400 },
        )
      }
      update.sync_mode = mode
    }
    if ('auth_type' in input) {
      const authType = String(input.auth_type)
      if (!['none', 'bearer', 'api_key_header'].includes(authType)) return NextResponse.json({ error: 'Invalid auth_type.' }, { status: 400 })
      update.auth_type = authType
    }
    if ('auth_header' in input) update.auth_header = text(input.auth_header, 200)
    if ('auth_secret' in input) {
      const secret = text(input.auth_secret, 8000)
      update.auth_secret_encrypted = secret ? encrypt(secret) : null
    }
    if ('field_mapping' in input) {
      if (!input.field_mapping || typeof input.field_mapping !== 'object' || Array.isArray(input.field_mapping)) {
        return NextResponse.json({ error: 'field_mapping must be an object.' }, { status: 400 })
      }
      update.field_mapping = input.field_mapping
    }

    const { data, error } = await supabase
      .from('catalog_sources')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select('id, name, source_type, is_active, base_url, search_path, sync_path, sync_mode, last_synced_at, last_sync_status, last_sync_error, auth_type, auth_header, field_mapping, meta_feed_token')
      .single()
    if (error) throw error
    return NextResponse.json({ source: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params

    // Canonical products deliberately keep a restrictive source FK. This avoids
    // silently destroying provenance. A source that has already been mirrored
    // should be deactivated instead of deleted until its canonical products are
    // explicitly reassigned or removed.
    const { count, error: countError } = await supabase
      .from('catalog_source_records')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('source_id', id)
    if (countError) throw countError
    if ((count ?? 0) > 0) {
      return NextResponse.json(
        { error: 'Esta fonte já possui ofertas canónicas. Desactive-a em vez de a apagar.' },
        { status: 409 },
      )
    }

    const { error } = await supabase.from('catalog_sources').delete().eq('id', id).eq('account_id', accountId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
