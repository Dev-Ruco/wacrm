import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { scanCatalogHealth } from '@/lib/catalog/health'

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const health = await scanCatalogHealth(supabase, accountId)
    return NextResponse.json({ health })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST() {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const health = await scanCatalogHealth(supabase, accountId)
    const now = new Date().toISOString()

    // A deterministic scan replaces only previous deterministic open findings.
    // AI/import proposals remain untouched and still require their own review.
    const { error: supersedeError } = await supabase
      .from('catalog_steward_suggestions')
      .update({ status: 'superseded', reviewed_at: now })
      .eq('account_id', accountId)
      .eq('status', 'pending')
      .eq('created_by', 'system')
    if (supersedeError) throw supersedeError

    if (health.issues.length > 0) {
      const rows = health.issues.map((issue) => ({
        account_id: accountId,
        product_id: issue.productId,
        source_id: issue.sourceId,
        issue_type: issue.issueType,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        proposed_changes: {},
        evidence: issue.evidence,
        confidence: 1,
        status: 'pending',
        created_by: 'system',
      }))
      const { error: insertError } = await supabase
        .from('catalog_steward_suggestions')
        .insert(rows)
      if (insertError) throw insertError
    }

    return NextResponse.json({ health, queued: health.issues.length })
  } catch (error) {
    return toErrorResponse(error)
  }
}
