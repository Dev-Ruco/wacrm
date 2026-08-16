import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

const ALLOWED_STATUSES = ['pending', 'approved', 'rejected', 'superseded'] as const

type SuggestionStatus = (typeof ALLOWED_STATUSES)[number]

function isSuggestionStatus(value: string | null): value is SuggestionStatus {
  return Boolean(value && ALLOWED_STATUSES.includes(value as SuggestionStatus))
}

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? 'pending'
    if (!isSuggestionStatus(status)) {
      return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('catalog_steward_suggestions')
      .select('id, product_id, source_id, issue_type, severity, title, description, proposed_changes, evidence, confidence, status, created_by, reviewed_by, reviewed_at, created_at')
      .eq('account_id', accountId)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error

    return NextResponse.json({ suggestions: data ?? [] })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const id = typeof body?.id === 'string' ? body.id.trim() : ''
    const status = typeof body?.status === 'string' ? body.status : null

    if (!id) {
      return NextResponse.json({ error: 'id é obrigatório.' }, { status: 400 })
    }
    if (status !== 'approved' && status !== 'rejected') {
      return NextResponse.json(
        { error: 'A revisão deve ser approved ou rejected.' },
        { status: 400 },
      )
    }

    const { data, error } = await supabase
      .from('catalog_steward_suggestions')
      .update({
        status,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('id', id)
      .eq('status', 'pending')
      .select('id, status, reviewed_by, reviewed_at')
      .maybeSingle()
    if (error) throw error
    if (!data) {
      return NextResponse.json(
        { error: 'Sugestão não encontrada ou já revista.' },
        { status: 404 },
      )
    }

    return NextResponse.json({ suggestion: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}
