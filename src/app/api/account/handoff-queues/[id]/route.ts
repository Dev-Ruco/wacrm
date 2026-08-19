import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'

function cleanKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 49)
  return /^[a-z0-9][a-z0-9_-]{1,48}$/.test(key) ? key : null
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.replace(/\s+/g, ' ').trim()
  return name.length >= 2 && name.length <= 120 ? name : null
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = await request.json().catch(() => null)
    if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

    const db = supabaseAdmin()
    const { data: existing } = await db
      .from('handoff_queues')
      .select('id')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('name' in body) {
      const name = cleanName(body.name)
      if (!name) return NextResponse.json({ error: 'Invalid team name' }, { status: 400 })
      patch.name = name
    }
    if ('routing_key' in body) {
      const key = cleanKey(body.routing_key)
      if (!key) return NextResponse.json({ error: 'Invalid routing key' }, { status: 400 })
      patch.routing_key = key
    }
    if ('description' in body) {
      patch.description = typeof body.description === 'string'
        ? body.description.trim().slice(0, 500) || null
        : null
    }
    if ('enabled' in body) patch.enabled = body.enabled === true
    if ('priority' in body) {
      const n = Number(body.priority)
      if (!Number.isInteger(n)) return NextResponse.json({ error: 'Invalid priority' }, { status: 400 })
      patch.priority = Math.min(1000, Math.max(1, n))
    }

    if (Object.keys(patch).length > 1) {
      const { error } = await db
        .from('handoff_queues')
        .update(patch)
        .eq('id', id)
        .eq('account_id', ctx.accountId)
      if (error) {
        console.error('[handoff queues] update failed:', error)
        return NextResponse.json(
          { error: error.code === '23505' ? 'A team with this routing key already exists' : 'Failed to update handoff team' },
          { status: error.code === '23505' ? 409 : 500 },
        )
      }
    }

    if (Array.isArray(body.member_user_ids)) {
      const requestedIds = Array.from(new Set(
        body.member_user_ids.filter((idValue: unknown): idValue is string =>
          typeof idValue === 'string' && idValue.length > 0,
        ),
      )).slice(0, 200)

      if (requestedIds.length > 0) {
        const { data: eligible, error: eligibleError } = await db
          .from('profiles')
          .select('user_id, account_role')
          .eq('account_id', ctx.accountId)
          .in('user_id', requestedIds)
          .in('account_role', ['owner', 'admin', 'agent'])
        if (eligibleError) {
          console.error('[handoff queues] member validation failed:', eligibleError)
          return NextResponse.json({ error: 'Could not validate team members' }, { status: 500 })
        }
        const eligibleIds = new Set((eligible ?? []).map((row) => row.user_id))
        if (eligibleIds.size !== requestedIds.length) {
          return NextResponse.json(
            { error: 'Every handoff specialist must belong to this account and have agent access or higher' },
            { status: 400 },
          )
        }
      }

      const { data: current, error: currentError } = await db
        .from('handoff_queue_members')
        .select('user_id')
        .eq('account_id', ctx.accountId)
        .eq('queue_id', id)
      if (currentError) {
        console.error('[handoff queues] current members load failed:', currentError)
        return NextResponse.json({ error: 'Could not update team members' }, { status: 500 })
      }

      const currentIds = new Set((current ?? []).map((row) => row.user_id))
      const requestedSet = new Set(requestedIds)
      const additions = requestedIds.filter((userId) => !currentIds.has(userId))
      const removals = [...currentIds].filter((userId) => !requestedSet.has(userId))

      if (additions.length > 0) {
        const { error: addError } = await db.from('handoff_queue_members').insert(
          additions.map((userId) => ({
            account_id: ctx.accountId,
            queue_id: id,
            user_id: userId,
            enabled: true,
            priority: 100,
          })),
        )
        if (addError) {
          console.error('[handoff queues] member add failed:', addError)
          return NextResponse.json({ error: 'Could not add specialists to team' }, { status: 500 })
        }
      }

      if (removals.length > 0) {
        const { error: removeError } = await db
          .from('handoff_queue_members')
          .delete()
          .eq('account_id', ctx.accountId)
          .eq('queue_id', id)
          .in('user_id', removals)
        if (removeError) {
          console.error('[handoff queues] member removal failed:', removeError)
          return NextResponse.json({ error: 'Could not remove specialists from team' }, { status: 500 })
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const { error, count } = await supabaseAdmin()
      .from('handoff_queues')
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
    if (error) {
      console.error('[handoff queues] delete failed:', error)
      return NextResponse.json({ error: 'Failed to delete handoff team' }, { status: 500 })
    }
    if (!count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}
