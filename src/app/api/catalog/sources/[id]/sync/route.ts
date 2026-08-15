import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { syncCanonicalCatalogSource } from '@/lib/catalog/sync'

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
