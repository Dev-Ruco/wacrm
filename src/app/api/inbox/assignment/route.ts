import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'

interface AssignmentRpcRow {
  applied: boolean
  assigned_agent_id: string | null
  conflict: boolean
}

function nullableUuid(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : undefined
}

/**
 * POST /api/inbox/assignment
 *
 * Compare-and-swap conversation assignment. The client sends the assignee
 * state it observed; if somebody changed the assignment meanwhile, this
 * returns 409 with the actual current assignee instead of overwriting it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('agent')
    const limit = checkRateLimit(`inbox-assignment:${ctx.userId}`, RATE_LIMITS.send)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    if (!body || typeof body.conversation_id !== 'string') {
      return NextResponse.json({ error: 'conversation_id is required' }, { status: 400 })
    }

    const conversationId = nullableUuid(body.conversation_id)
    const expectedAssigneeId = nullableUuid(body.expected_assignee_id)
    const newAssigneeId = nullableUuid(body.assigned_agent_id)

    if (!conversationId || expectedAssigneeId === undefined || newAssigneeId === undefined) {
      return NextResponse.json({ error: 'Invalid assignment payload' }, { status: 400 })
    }

    const { data, error } = await ctx.supabase.rpc('assign_conversation_if_current', {
      p_account_id: ctx.accountId,
      p_conversation_id: conversationId,
      p_expected_assignee_id: expectedAssigneeId,
      p_new_assignee_id: newAssigneeId,
    })

    if (error) {
      console.error('[inbox assignment] RPC failed:', error)
      if (error.code === '23514') {
        return NextResponse.json({ error: 'Assignee is not eligible for this account' }, { status: 400 })
      }
      if (error.code === 'P0002') {
        return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
      }
      if (error.code === '42501') {
        return NextResponse.json({ error: 'Not allowed to assign this conversation' }, { status: 403 })
      }
      return NextResponse.json({ error: 'Failed to update assignment' }, { status: 500 })
    }

    const result = Array.isArray(data)
      ? (data[0] as AssignmentRpcRow | undefined)
      : (data as AssignmentRpcRow | null)

    if (!result) {
      return NextResponse.json({ error: 'Assignment did not return a result' }, { status: 500 })
    }

    if (!result.applied || result.conflict) {
      return NextResponse.json(
        {
          error: 'Assignment changed while you were updating it',
          code: 'assignment_conflict',
          assigned_agent_id: result.assigned_agent_id,
        },
        { status: 409 },
      )
    }

    return NextResponse.json({
      success: true,
      assigned_agent_id: result.assigned_agent_id,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
