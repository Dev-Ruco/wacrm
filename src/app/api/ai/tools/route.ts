import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  AGENT_TOOL_KEYS,
  DEFAULT_AGENT_TOOLS,
  type AgentToolKey,
} from '@/lib/ai/tool-permissions'
import {
  isImplementedAgentToolKey,
  loadToolDefinitions,
  type ToolDefinition,
} from '@/lib/ai/tool-registry'

async function resolveAgentId(
  supabase: Awaited<ReturnType<typeof requireRole>>['supabase'],
  accountId: string,
) {
  const { data, error } = await supabase
    .from('ai_configs')
    .select('id')
    .eq('account_id', accountId)
    .maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

function fallbackDefinitions(): ToolDefinition[] {
  return AGENT_TOOL_KEYS.map((key, index) => ({
    key,
    label: key.replaceAll('_', ' '),
    description: null,
    actionClass: 'read',
    reversible: true,
    externalImpact: false,
    defaultEnabled: DEFAULT_AGENT_TOOLS[key],
    inputSchema: {},
    sortOrder: (index + 1) * 10,
  }))
}

function defaultToolsResponse(definitions: readonly ToolDefinition[]) {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.key,
      {
        enabled: definition.defaultEnabled,
        instructions: null,
      },
    ]),
  ) as Record<AgentToolKey, { enabled: boolean; instructions: string | null }>
}

export async function GET() {
  try {
    const { supabase, accountId } = await requireRole('agent')
    const agentId = await resolveAgentId(supabase, accountId)
    const registered = await loadToolDefinitions(supabase)
    const definitions = registered ?? fallbackDefinitions()
    const registeredKeys = new Set(definitions.map((definition) => definition.key))

    if (!agentId) {
      return NextResponse.json({
        configured: false,
        agent_id: null,
        definitions,
        tools: defaultToolsResponse(definitions),
      })
    }

    const [toolRows, recentCalls, skillRows] = await Promise.all([
      supabase
        .from('agent_tools')
        .select('tool_key, enabled, instructions')
        .eq('account_id', accountId)
        .eq('agent_id', agentId),
      // Ordered desc, capped: the first row per tool_key is its most recent call.
      supabase
        .from('agent_tool_calls')
        .select('tool_key, called_at')
        .eq('account_id', accountId)
        .eq('agent_id', agentId)
        .order('called_at', { ascending: false })
        .limit(200),
      supabase
        .from('skills')
        .select('name, tool_keys')
        .eq('account_id', accountId)
        .eq('agent_id', agentId)
        .eq('enabled', true),
    ])
    if (toolRows.error) throw toolRows.error

    const tools = defaultToolsResponse(definitions)
    for (const row of toolRows.data ?? []) {
      const key = row.tool_key as string
      if (isImplementedAgentToolKey(key) && registeredKeys.has(key)) {
        tools[key] = {
          enabled: Boolean(row.enabled),
          instructions: row.instructions ?? null,
        }
      }
    }

    const lastUsedAt: Partial<Record<AgentToolKey, string>> = {}
    if (!recentCalls.error) {
      for (const row of recentCalls.data ?? []) {
        const key = row.tool_key as string
        if (isImplementedAgentToolKey(key) && registeredKeys.has(key) && !lastUsedAt[key]) {
          lastUsedAt[key] = row.called_at
        }
      }
    }

    const usedBySkills = Object.fromEntries(
      definitions.map((definition) => [definition.key, [] as string[]]),
    ) as Record<AgentToolKey, string[]>
    if (!skillRows.error) {
      for (const row of skillRows.data ?? []) {
        for (const rawKey of (row.tool_keys ?? []) as string[]) {
          if (isImplementedAgentToolKey(rawKey) && registeredKeys.has(rawKey)) {
            usedBySkills[rawKey].push(row.name)
          }
        }
      }
    }

    return NextResponse.json({
      configured: true,
      agent_id: agentId,
      definitions,
      tools,
      last_used_at: lastUsedAt,
      used_by_skills: usedBySkills,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireRole('admin')
    const body = await request.json().catch(() => null)
    const rawToolKey = typeof body?.tool_key === 'string' ? body.tool_key : ''
    const enabled = body?.enabled
    const rawInstructions = body?.instructions

    if (!isImplementedAgentToolKey(rawToolKey) || typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'tool_key implementado e enabled (boolean) são obrigatórios.' },
        { status: 400 },
      )
    }
    const toolKey: AgentToolKey = rawToolKey

    if (rawInstructions !== undefined && rawInstructions !== null && typeof rawInstructions !== 'string') {
      return NextResponse.json({ error: 'instructions deve ser texto ou nulo.' }, { status: 400 })
    }

    // null means only that the migration is not readable yet. An empty array is
    // an authoritative registry with no enabled capabilities and must not fall
    // back to the static handler list.
    const registered = await loadToolDefinitions(supabase)
    if (registered !== null && !registered.some((definition) => definition.key === toolKey)) {
      return NextResponse.json({ error: 'Ferramenta não registada ou desactivada.' }, { status: 400 })
    }

    const agentId = await resolveAgentId(supabase, accountId)
    if (!agentId) {
      return NextResponse.json({ error: 'Configure primeiro o agente de IA.' }, { status: 409 })
    }

    // `instructions` is only included in the upsert payload when the caller
    // explicitly sent it — omitting it keeps previously saved account guidance.
    const instructionsProvided = rawInstructions !== undefined
    const instructions =
      typeof rawInstructions === 'string' ? rawInstructions.trim() || null : null

    const upsertPayload: Record<string, unknown> = {
      account_id: accountId,
      agent_id: agentId,
      tool_key: toolKey,
      enabled,
    }
    if (instructionsProvided) upsertPayload.instructions = instructions

    const { error } = await supabase
      .from('agent_tools')
      .upsert(upsertPayload, { onConflict: 'agent_id,tool_key' })
    if (error) throw error

    return NextResponse.json({
      success: true,
      tool_key: toolKey,
      enabled,
      instructions: instructionsProvided ? instructions : undefined,
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
