import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'

export async function GET(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const url = new URL(request.url)
    const status = url.searchParams.get('status') ?? 'pending'
    if (!['pending', 'approved', 'rejected', 'superseded'].includes(status)) {
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
