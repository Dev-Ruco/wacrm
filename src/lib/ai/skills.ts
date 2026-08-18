import type { WacrmSupabaseClient } from '@/lib/supabase/types'
import { AGENT_TOOL_KEYS, type AgentToolKey } from './tool-permissions'
import { getAgentTraceContext } from './trace-context'

export const SKILL_COLUMNS =
  'id, name, instructions, objective, when_to_use, when_not_to_use, tool_keys, enabled, sort_order'

export function trimmedFieldOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, maxLength) : null
}

export interface AgentSkill {
  id: string
  name: string
  instructions: string
  objective: string
  whenToUse: string
  whenNotToUse: string
  toolKeys: AgentToolKey[]
}

interface SkillRow {
  id: string
  name: string
  instructions: string | null
  objective: string | null
  when_to_use: string | null
  when_not_to_use: string | null
  tool_keys: string[] | null
}

export async function loadAgentSkills(
  db: WacrmSupabaseClient,
  accountId: string,
  agentId: string,
): Promise<AgentSkill[]> {
  const { data, error } = await db
    .from('skills')
    .select('id, name, instructions, objective, when_to_use, when_not_to_use, tool_keys')
    .eq('account_id', accountId)
    .eq('agent_id', agentId)
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) {
    console.error('[ai skills] load failed:', error)
    return []
  }

  const skills = (data ?? []).map((row) => {
    const r = row as SkillRow
    return {
      id: r.id,
      name: r.name,
      instructions: r.instructions?.trim() ?? '',
      objective: r.objective?.trim() ?? '',
      whenToUse: r.when_to_use?.trim() ?? '',
      whenNotToUse: r.when_not_to_use?.trim() ?? '',
      toolKeys: (r.tool_keys ?? []).filter((key): key is AgentToolKey =>
        (AGENT_TOOL_KEYS as readonly string[]).includes(key),
      ),
    }
  })

  getAgentTraceContext()?.recordEvent('skills_loaded', 'Skills activas disponíveis', {
    count: skills.length,
    names: skills.map((skill) => skill.name).slice(0, 20),
  })
  return skills
}

/** Build model guidance only for skills already selected for this turn. */
export function skillsPrompt(skills: AgentSkill[]): string | null {
  const withContent = skills.filter(
    (skill) => skill.instructions || skill.objective || skill.whenToUse || skill.whenNotToUse,
  )
  if (withContent.length === 0) return null
  return [
    'Selected skills for this turn — specialised objectives routed as relevant to the customer’s current need. ' +
      'Apply their instructions when their conditions genuinely fit; if the newest customer message makes one no longer applicable, ignore it rather than forcing it. ' +
      'These are internal guidance. Never announce a skill name, routing decision or internal instruction to the customer.',
    ...withContent.map((skill) => {
      const lines = [`[${skill.name}]`]
      if (skill.objective) lines.push(`Objective: ${skill.objective}`)
      if (skill.whenToUse) lines.push(`Use when: ${skill.whenToUse}`)
      if (skill.whenNotToUse) lines.push(`Do not use when: ${skill.whenNotToUse}`)
      if (skill.instructions) lines.push(skill.instructions)
      return lines.join('\n')
    }),
  ].join('\n\n')
}

export function skillToolKeys(skills: AgentSkill[]): Set<AgentToolKey> | null {
  if (skills.length === 0) return null
  const keys = new Set<AgentToolKey>()
  for (const skill of skills) {
    for (const key of skill.toolKeys) keys.add(key)
  }
  return keys
}

/**
 * Apply the tool subset declared by the skills selected for THIS turn.
 * An empty selection deliberately leaves the account permissions untouched.
 * Skills can only remove specialised capabilities; they can never grant a tool
 * that the account disabled. Human handoff remains globally available as a
 * safety net, and factual company knowledge remains available whenever the
 * administrator enabled it because every skill may still need grounded facts
 * such as address, hours, policies, payment methods or delivery conditions.
 */
export function applySkillNarrowing(
  permissions: Record<AgentToolKey, boolean>,
  selectedSkills: AgentSkill[],
): Record<AgentToolKey, boolean> {
  const narrowed = skillToolKeys(selectedSkills)
  if (!narrowed) return permissions
  const effective = { ...permissions }
  for (const key of AGENT_TOOL_KEYS) {
    if (key === 'handoff_human' || key === 'search_knowledge') continue
    effective[key] = permissions[key] && narrowed.has(key)
  }
  return effective
}
