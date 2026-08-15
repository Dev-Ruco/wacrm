import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { AGENT_TOOL_KEYS, type AgentToolKey } from './tool-permissions'

export type ToolActionClass = 'read' | 'communication' | 'mutation' | 'handoff'

export interface ToolDefinition {
  key: AgentToolKey
  label: string
  description: string | null
  actionClass: ToolActionClass
  reversible: boolean
  externalImpact: boolean
  defaultEnabled: boolean
  inputSchema: Record<string, unknown>
  sortOrder: number
}

interface ToolDefinitionRow {
  key: string
  label: string
  description: string | null
  action_class: ToolActionClass
  reversible: boolean
  external_impact: boolean
  default_enabled: boolean
  input_schema: Record<string, unknown> | null
  sort_order: number
}

/**
 * The database registry is the administrative source of capability metadata.
 * Runtime handlers are still code-owned, so only keys with an implemented
 * handler are exposed to an agent. This avoids the unsafe implication that a
 * tenant can create arbitrary executable tools by inserting a database row.
 */
export function isImplementedAgentToolKey(value: string): value is AgentToolKey {
  return AGENT_TOOL_KEYS.includes(value as AgentToolKey)
}

export async function loadToolDefinitions(
  db: WacrmSupabaseClient,
): Promise<ToolDefinition[]> {
  const { data, error } = await db
    .from('tool_definitions')
    .select('key, label, description, action_class, reversible, external_impact, default_enabled, input_schema, sort_order')
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) {
    // Deployments may briefly run application code before the registry migration
    // is applied. Returning an empty list lets callers fall back to the static
    // implemented-handler defaults instead of breaking all AI configuration.
    console.warn('[ai tools] registry lookup failed:', error.message)
    return []
  }

  return ((data ?? []) as ToolDefinitionRow[])
    .filter((row) => isImplementedAgentToolKey(row.key))
    .map((row) => ({
      key: row.key as AgentToolKey,
      label: row.label,
      description: row.description,
      actionClass: row.action_class,
      reversible: Boolean(row.reversible),
      externalImpact: Boolean(row.external_impact),
      defaultEnabled: Boolean(row.default_enabled),
      inputSchema: row.input_schema ?? {},
      sortOrder: row.sort_order,
    }))
}

export async function loadToolDefinition(
  db: WacrmSupabaseClient,
  key: string,
): Promise<ToolDefinition | null> {
  if (!isImplementedAgentToolKey(key)) return null
  const definitions = await loadToolDefinitions(db)
  return definitions.find((definition) => definition.key === key) ?? null
}
