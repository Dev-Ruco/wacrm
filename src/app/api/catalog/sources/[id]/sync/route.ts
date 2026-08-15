import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { syncCanonicalCatalogSource } from '@/lib/catalog/sync'

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const { id } = await context.params
    if (!id || id.length > 80) {
      return NextResponse.json({ error: 'Fonte inválida.' }, { status: 400 })
    }

    const { data: source, error: sourceError } = await supabase
      .from('catalog_sources')
      .select('id, name, sync_mode, last_synced_at, last_sync_status, last_sync_error')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle()
    if (sourceError) throw sourceError
    if (!source) return NextResponse.json({ error: 'Fonte não encontrada.' }, { status: 404 })

    const { data: runs, error: runsError } = await supabase
      .from('catalog_sync_runs')
      .select('id, status, trigger_type, fetched_count, created_count, updated_count, unchanged_count, missing_count, error_message, started_at, finished_at')
      .eq('account_id', accountId)
      .eq('source_id', id)
      .order('started_at', { ascending: false })
      .limit(20)
    if (runsError) throw runsError

    return NextResponse.json({ source, runs: runs ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const { id } = await context.params
    if (!id || id.length > 80) {
      return NextResponse.json({ error: 'Fonte inválida.' }, { status: 400 })
    }

    const result = await syncCanonicalCatalogSource(supabase, accountId, id)
    return NextResponse.json({ ok: true, sync: result })
  } catch (error) {
    return toErrorResponse(error)
  }
}
