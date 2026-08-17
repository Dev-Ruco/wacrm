import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { createAdminClient } from '@/lib/supabase/admin'

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/\/$/, '')
  if (!raw) return null

  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.pathname !== '/' || url.search || url.hash) return null
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const { accountId } = await requireRole('admin')
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('website_channels')
      .select('id, name, public_key, allowed_origins, is_active, created_at, updated_at')
      .eq('account_id', accountId)
      .maybeSingle()

    if (error) throw error
    return NextResponse.json({ channel: data ?? null })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin')
    const body = await request.json()

    const name = typeof body?.name === 'string' && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : 'Website'

    const suppliedOrigins: unknown[] = Array.isArray(body?.allowed_origins)
      ? body.allowed_origins
      : []
    const allowedOrigins = Array.from(
      new Set(
        suppliedOrigins
          .map((origin: unknown) => normalizeOrigin(origin))
          .filter((origin: string | null): origin is string => Boolean(origin)),
      ),
    ).slice(0, 20)

    if (allowedOrigins.length === 0) {
      return NextResponse.json(
        { error: 'At least one valid allowed origin is required' },
        { status: 400 },
      )
    }

    const isActive = body?.is_active !== false
    const admin = createAdminClient()

    const { data, error } = await admin
      .from('website_channels')
      .upsert(
        {
          account_id: accountId,
          name,
          allowed_origins: allowedOrigins,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' },
      )
      .select('id, name, public_key, allowed_origins, is_active, created_at, updated_at')
      .single()

    if (error) throw error

    return NextResponse.json({ channel: data })
  } catch (error) {
    return toErrorResponse(error)
  }
}