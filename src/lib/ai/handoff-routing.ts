import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { OFFLINE_AFTER_MS } from '@/lib/presence'

export interface HandoffQueueOption {
  id: string
  routingKey: string
  name: string
  description: string | null
  priority: number
}

export interface HandoffRoute {
  queue: HandoffQueueOption | null
  assigneeUserId: string | null
  notifyUserIds: string[]
  reason: 'specialist' | 'fallback' | 'unassigned'
}

export interface HandoffCandidate {
  userId: string
  memberPriority: number
  presenceRank: number
  openCount: number
}

export function rankHandoffCandidates(candidates: HandoffCandidate[]): HandoffCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      a.presenceRank - b.presenceRank ||
      a.openCount - b.openCount ||
      a.memberPriority - b.memberPriority ||
      a.userId.localeCompare(b.userId),
  )
}

export async function loadHandoffQueues(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<HandoffQueueOption[]> {
  const { data, error } = await db
    .from('handoff_queues')
    .select('id, routing_key, name, description, priority')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .order('priority', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.warn('[handoff routing] queue lookup unavailable:', error.message)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    routingKey: row.routing_key,
    name: row.name,
    description: row.description ?? null,
    priority: row.priority ?? 100,
  }))
}

export function handoffRoutingPrompt(queues: HandoffQueueOption[]): string | null {
  if (queues.length === 0) return null
  return [
    'HUMAN HANDOFF ROUTING',
    'When handoff_human is needed, choose routing_key only from the configured specialist queues below when one clearly fits the subject.',
    'Do not invent a routing key. If none clearly fits, omit routing_key and the server will use the safe fallback.',
    ...queues.map((queue) =>
      `- ${queue.routingKey}: ${queue.name}${queue.description ? ` — ${queue.description}` : ''}`,
    ),
  ].join('\n')
}

function presenceRank(status: string | null, lastSeenAt: string | null, now: number): number {
  if (!status || !lastSeenAt) return 2
  const last = new Date(lastSeenAt).getTime()
  if (!Number.isFinite(last) || now - last > OFFLINE_AFTER_MS) return 2
  return status === 'online' ? 0 : 1
}

async function adminRecipients(
  db: WacrmSupabaseClient,
  accountId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from('profiles')
    .select('user_id, account_role')
    .eq('account_id', accountId)
    .in('account_role', ['owner', 'admin'])
  if (error) {
    console.error('[handoff routing] admin recipient lookup failed:', error)
    return []
  }
  return (data ?? []).map((row) => row.user_id)
}

async function validFallback(
  db: WacrmSupabaseClient,
  accountId: string,
  fallbackUserId: string | null | undefined,
): Promise<string | null> {
  if (!fallbackUserId) return null
  const { data, error } = await db
    .from('profiles')
    .select('user_id, account_role')
    .eq('account_id', accountId)
    .eq('user_id', fallbackUserId)
    .in('account_role', ['owner', 'admin', 'agent'])
    .maybeSingle()
  if (error) {
    console.error('[handoff routing] fallback validation failed:', error)
    return null
  }
  return data?.user_id ?? null
}

export async function resolveHandoffRoute(args: {
  db: WacrmSupabaseClient
  accountId: string
  requestedRoutingKey?: string | null
  fallbackUserId?: string | null
}): Promise<HandoffRoute> {
  const { db, accountId } = args
  const queues = await loadHandoffQueues(db, accountId)
  const requestedKey = args.requestedRoutingKey?.trim().toLowerCase() || null
  const queue = requestedKey
    ? queues.find((item) => item.routingKey.toLowerCase() === requestedKey) ?? null
    : null

  if (queue) {
    const { data: membershipRows, error: memberError } = await db
      .from('handoff_queue_members')
      .select('user_id, priority')
      .eq('account_id', accountId)
      .eq('queue_id', queue.id)
      .eq('enabled', true)
      .order('priority', { ascending: true })

    if (memberError) {
      console.error('[handoff routing] queue members lookup failed:', memberError)
    } else if (membershipRows?.length) {
      const requestedIds = membershipRows.map((row) => row.user_id)
      const { data: eligibleProfiles, error: profileError } = await db
        .from('profiles')
        .select('user_id, account_role')
        .eq('account_id', accountId)
        .in('user_id', requestedIds)
        .in('account_role', ['owner', 'admin', 'agent'])

      if (profileError) {
        console.error('[handoff routing] eligible profile lookup failed:', profileError)
      } else {
        const eligibleIds = new Set((eligibleProfiles ?? []).map((row) => row.user_id))
        const ids = requestedIds.filter((id) => eligibleIds.has(id))
        if (ids.length > 0) {
          const [{ data: presenceRows }, { data: openRows }] = await Promise.all([
            db
              .from('member_presence')
              .select('user_id, status, last_seen_at')
              .eq('account_id', accountId)
              .in('user_id', ids),
            db
              .from('conversations')
              .select('assigned_agent_id')
              .eq('account_id', accountId)
              .in('assigned_agent_id', ids)
              .neq('status', 'closed'),
          ])

          const presenceByUser = new Map(
            (presenceRows ?? []).map((row) => [row.user_id, row] as const),
          )
          const load = new Map<string, number>()
          for (const row of openRows ?? []) {
            if (!row.assigned_agent_id) continue
            load.set(row.assigned_agent_id, (load.get(row.assigned_agent_id) ?? 0) + 1)
          }
          const priorityByUser = new Map(
            membershipRows.map((row) => [row.user_id, row.priority ?? 100] as const),
          )
          const now = Date.now()
          const candidates = rankHandoffCandidates(ids.map((userId) => {
            const presence = presenceByUser.get(userId)
            return {
              userId,
              memberPriority: priorityByUser.get(userId) ?? 100,
              presenceRank: presenceRank(presence?.status ?? null, presence?.last_seen_at ?? null, now),
              openCount: load.get(userId) ?? 0,
            }
          }))
          const selected = candidates[0]
          if (selected) {
            return {
              queue,
              assigneeUserId: selected.userId,
              notifyUserIds: [selected.userId],
              reason: 'specialist',
            }
          }
        }
      }
    }
  }

  const fallback = await validFallback(db, accountId, args.fallbackUserId)
  if (fallback) {
    return {
      queue,
      assigneeUserId: fallback,
      notifyUserIds: [fallback],
      reason: 'fallback',
    }
  }

  const admins = await adminRecipients(db, accountId)
  return {
    queue,
    assigneeUserId: null,
    notifyUserIds: admins,
    reason: 'unassigned',
  }
}
