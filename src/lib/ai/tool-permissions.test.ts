import { describe, expect, it } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { AGENT_TOOL_KEYS, DEFAULT_AGENT_TOOLS, loadAgentToolPermissions } from './tool-permissions'

function queryResult<T>(data: T, error: { message: string } | null = null) {
  const result = { data, error }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.order = () => chain
  chain.limit = () => chain
  chain.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)
  return chain
}

function defaultRegistry() {
  return AGENT_TOOL_KEYS.map((key) => ({ key, default_enabled: DEFAULT_AGENT_TOOLS[key] }))
}

function dbReturning(args: {
  registry?: Array<{ key: string; default_enabled: boolean }>
  agentTools?: Array<{ tool_key: string; enabled: boolean; instructions?: string | null }>
  offeringDefinitions?: unknown[]
}) {
  return {
    from: (table: string) => {
      if (table === 'tool_definitions') return queryResult(args.registry ?? defaultRegistry())
      if (table === 'agent_tools') return queryResult(args.agentTools ?? [])
      if (table === 'offering_attribute_definitions') return queryResult(args.offeringDefinitions ?? [])
      throw new Error(`Unexpected table: ${table}`)
    },
  } as unknown as WacrmSupabaseClient
}

describe('DEFAULT_AGENT_TOOLS', () => {
  it('does not enable get_style_opinion by default (fashion-specific, opt-in like other business-specific tools)', () => {
    expect(DEFAULT_AGENT_TOOLS.get_style_opinion).toBe(false)
  })

  it('does not enable compose_solution before a tenant configures composition semantics', () => {
    expect(DEFAULT_AGENT_TOOLS.compose_solution).toBe(false)
  })
})

describe('loadAgentToolPermissions', () => {
  it('uses registry defaults when there are no tenant overrides', async () => {
    const result = await loadAgentToolPermissions(dbReturning({}), 'acct-1', 'agent-1')
    expect(result.permissions).toEqual(DEFAULT_AGENT_TOOLS)
    expect(result.instructions).toEqual({})
  })

  it('applies explicit enabled overrides and collects non-empty instructions per registered tool', async () => {
    const result = await loadAgentToolPermissions(
      dbReturning({
        agentTools: [
          { tool_key: 'get_style_opinion', enabled: true, instructions: null },
          { tool_key: 'compose_solution', enabled: true, instructions: '  Use apenas os templates configurados.  ' },
          { tool_key: 'schedule_visit', enabled: true, instructions: '  Nesta conta, não agendamos aos domingos.  ' },
          { tool_key: 'create_deal', enabled: false, instructions: '' },
        ],
      }),
      'acct-1',
      'agent-1',
    )
    expect(result.permissions.get_style_opinion).toBe(true)
    expect(result.permissions.compose_solution).toBe(true)
    expect(result.permissions.schedule_visit).toBe(true)
    expect(result.permissions.create_deal).toBe(false)
    expect(result.instructions).toEqual({
      compose_solution: 'Use apenas os templates configurados.',
      schedule_visit: 'Nesta conta, não agendamos aos domingos.',
    })
  })

  it('does not let a stale tenant row enable a capability absent from a readable registry', async () => {
    const result = await loadAgentToolPermissions(
      dbReturning({
        registry: [{ key: 'search_knowledge', default_enabled: true }],
        agentTools: [
          { tool_key: 'search_catalog', enabled: true, instructions: 'stale' },
          { tool_key: 'compose_solution', enabled: true, instructions: 'stale composition' },
          { tool_key: 'search_knowledge', enabled: true, instructions: null },
        ],
      }),
      'acct-1',
      'agent-1',
    )

    expect(result.permissions.search_knowledge).toBe(true)
    expect(result.permissions.search_catalog).toBe(false)
    expect(result.permissions.send_product).toBe(false)
    expect(result.permissions.compose_solution).toBe(false)
    expect(result.instructions.search_catalog).toBeUndefined()
    expect(result.instructions.compose_solution).toBeUndefined()
  })

  it('treats a readable empty registry as authoritative instead of restoring static defaults', async () => {
    const result = await loadAgentToolPermissions(
      dbReturning({
        registry: [],
        agentTools: [{ tool_key: 'handoff_human', enabled: true, instructions: null }],
      }),
      'acct-1',
      'agent-1',
    )

    expect(Object.values(result.permissions).every((enabled) => enabled === false)).toBe(true)
  })
})
