import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

function cleanKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase().replace(/\s+/g, '_')
  return /^[a-z0-9][a-z0-9_-]{1,48}$/.test(key) ? key : null
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim()
  return name.length >= 2 && name.length <= 120 ? name : null
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const db = supabaseAdmin()
    const [{ data: queues, error }, { data: memberships, error: membershipError }] = await Promise.all([
      db
        .from('handoff_queues')
        .select('id, routing_key, name, description, enabled, priority, created_at, updated_at')
        .eq('account_id', ctx.accountId)
        .order('priority')
        .order('name'),
      db
        .from('handoff_queue_members')
        .select('queue_id, user_id, enabled, priority')
        .eq('account_id', ctx.accountId)
        .eq('enabled', true),
    ])
    if (error || membershipError) {
      console.error('[handoff queues] load failed:', error ?? membershipError)
      return NextResponse.json({ error: 'Failed to load handoff teams' }, { status: 500 })
    }
    const byQueue = new Map<string, string[]>()
    for (const row of memberships ?? []) {
      const ids = byQueue.get(row.queue_id) ?? []
      ids.push(row.user_id)
      byQueue.set(row.queue_id, ids)
    }
    return NextResponse.json({
      queues: (queues ?? []).map((queue) => ({
        ...queue,
        member_user_ids: byQueue.get(queue.id) ?? [],
      })),
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const name = cleanName(body.name)
    const routingKey = cleanKey(body.routing_key ?? body.name)
    if (!name || !routingKey) {
      return NextResponse.json(
        { error: 'Name and a valid routing key are required' },
        { status: 400 },
      )
    }
    const description = typeof body.description === 'string'
      ? body.description.trim().slice(0, 500) || null
      : null
    const priority = Number.isInteger(body.priority)
      ? Math.min(1000, Math.max(1, body.priority))
      : 100

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('handoff_queues')
      .insert({
        account_id: ctx.accountId,
        routing_key: routingKey,
        name,
        description,
        enabled: body.enabled !== false,
        priority,
      })
      .select('id, routing_key, name, description, enabled, priority, created_at, updated_at')
      .single()
    if (error || !data) {
      console.error('[handoff queues] create failed:', error)
      return NextResponse.json(
        { error: error?.code === '23505' ? 'A team with this routing key already exists' : 'Failed to create handoff team' },
        { status: error?.code === '23505' ? 409 : 500 },
      )
    }
    return NextResponse.json({ queue: { ...data, member_user_ids: [] } }, { status: 201 })
  } catch (error) {
    return toErrorResponse(error)
  }
}
