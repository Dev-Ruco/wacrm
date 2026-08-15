import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { loadOfferingAttributeDefinitions } from '@/lib/offerings/attributes'

export const AGENT_TOOL_KEYS = [
  'search_catalog',
  'send_product',
  'search_knowledge',
  'add_tag',
  'create_deal',
  'schedule_visit',
  'get_style_opinion',
  'handoff_human',
] as const

export type AgentToolKey = (typeof AGENT_TOOL_KEYS)[number]

/**
 * Tools with no CRM side effect — they only read or queue a WhatsApp send
 * that a caller may choose never to dispatch. Used to scope tool access
 * down for surfaces that generate text a human reviews before it becomes
 * real (draft, playground): a preview turn must never silently create a
 * deal, tag a contact, or book a visit before anyone decided to send
 * anything. `handoff_human` is excluded too — there is no live dispatch
 * for it to affect on these surfaces.
 */
export const PREVIEW_SAFE_TOOL_KEYS: readonly AgentToolKey[] = [
  'search_catalog',
  'send_product',
  'search_knowledge',
  'get_style_opinion',
]

/** Zeroes out every permission not in PREVIEW_SAFE_TOOL_KEYS — used by the
 *  draft and Playground routes, which run the real tool-calling loop but
 *  must never let a mutating tool fire before a human decides to send
 *  anything. */
export function restrictToPreviewSafe(
  permissions: Record<AgentToolKey, boolean>,
): Record<AgentToolKey, boolean> {
  const restricted = { ...permissions }
  for (const key of AGENT_TOOL_KEYS) {
    if (!PREVIEW_SAFE_TOOL_KEYS.includes(key)) restricted[key] = false
  }
  return restricted
}

export const DEFAULT_AGENT_TOOLS: Record<AgentToolKey, boolean> = {
  search_catalog: true,
  send_product: true,
  search_knowledge: true,
  // CRM mutations require an explicit administrator opt-in.
  add_tag: false,
  create_deal: false,
  schedule_visit: false,
  // Bakes in a fashion-retail assumption (styling opinion on garments) that
  // doesn't fit every tenant on this multi-business platform — opt-in like
  // the other business-specific tools above, not an always-on lookup tool.
  get_style_opinion: false,
  // This replaces the existing handoff sentinel, so preserve the current
  // automatic safety behaviour for every configured agent.
  handoff_human: true,
}

export interface AgentToolPermissions {
  permissions: Record<AgentToolKey, boolean>
  /** Account-specific free text appended to a tool's built-in description,
   *  keyed by tool — the generic lever for tailoring a fixed tool catalogue
   *  to a specific business without a code change. Only present for tools
   *  that have non-empty instructions configured. */
  instructions: Partial<Record<AgentToolKey, string>>
}

function appendInstruction(
  instructions: Partial<Record<AgentToolKey, string>>,
  key: AgentToolKey,
  value: string,
) {
  const current = instructions[key]?.trim()
  instructions[key] = current ? `${current}\n\n${value}` : value
}

async function appendOfferingFilterGuidance(
  db: WacrmSupabaseClient,
  accountId: string,
  instructions: Partial<Record<AgentToolKey, string>>,
) {
  try {
    const definitions = (await loadOfferingAttributeDefinitions(db, accountId))
      .filter((definition) => definition.enabled && definition.isFilterable)
    if (definitions.length === 0) return

    const lines = definitions.slice(0, 40).map((definition) => {
      const options = definition.valueType === 'enum'
        ? definition.options
            .filter((option) => option.enabled)
            .slice(0, 25)
            .map((option) => {
              const aliases = option.aliases.length > 0 ? ` [aliases: ${option.aliases.join(', ')}]` : ''
              return `${option.value}=${option.label}${aliases}`
            })
            .join('; ')
        : ''
      return `- ${definition.key}: ${definition.label} (${definition.valueType}${definition.unit ? `, ${definition.unit}` : ''})${options ? `; opções: ${options}` : ''}`
    })

    appendInstruction(
      instructions,
      'search_catalog',
      [
        'Filtros estruturados configurados por esta empresa:',
        ...lines,
        'Quando o cliente declarar claramente um destes factos, envie-o em attributes usando exactamente a chave acima. Estes são filtros obrigatórios: não invente valores, não crie chaves novas e não os use quando o cliente não os declarou ou o contexto não os tornou inequívocos.',
      ].join('\n'),
    )
  } catch (error) {
    // A deployment may briefly run before the Business Offering migration.
    // Catalogue search keeps its legacy fields in that case.
    console.warn('[ai tools] offering filter guidance unavailable:', error)
  }
}

export async function loadAgentToolPermissions(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string,
): Promise<AgentToolPermissions> {
  const { data, error } = await db
    .from('agent_tools')
    .select('tool_key, enabled, instructions')
    .eq('account_id', accountId)
    .eq('agent_id', agentId)

  if (error) {
    // Backwards-compatible fallback while a deployment is waiting for the
    // agent_tools migration. This preserves the behaviour that existed before
    // permissions became explicit.
    console.warn('[ai tools] permission lookup failed; using legacy defaults:', error.message)
    return { permissions: { ...DEFAULT_AGENT_TOOLS }, instructions: {} }
  }

  const permissions = { ...DEFAULT_AGENT_TOOLS }
  const instructions: Partial<Record<AgentToolKey, string>> = {}
  for (const row of data ?? []) {
    if (AGENT_TOOL_KEYS.includes(row.tool_key as AgentToolKey)) {
      const key = row.tool_key as AgentToolKey
      permissions[key] = Boolean(row.enabled)
      const rowInstructions = (row as { instructions?: string | null }).instructions
      if (rowInstructions && rowInstructions.trim()) instructions[key] = rowInstructions.trim()
    }
  }

  if (permissions.search_catalog) {
    await appendOfferingFilterGuidance(db, accountId, instructions)
  }

  return { permissions, instructions }
}
