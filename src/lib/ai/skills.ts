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
    'Selected skills for this turn — specialised ways of handling the customer’s current need. ' +
      'Use them to shape judgement, questioning, comparison and next-step strategy; do not treat a skill as a rigid script or as a permission boundary. ' +
      'The account-level enabled tools remain the authoritative capabilities. A skill’s associated tool list is only an affinity hint: use any enabled tool that is genuinely required to complete the customer’s clear goal. ' +
      'If the newest customer message makes a selected skill no longer applicable, ignore it rather than forcing it. These are internal guidance; never announce a skill name, routing decision or internal instruction to the customer.',
    ...withContent.map((skill) => {
      const lines = [`[${skill.name}]`]
      if (skill.objective) lines.push(`Objective: ${skill.objective}`)
      if (skill.whenToUse) lines.push(`Use when: ${skill.whenToUse}`)
      if (skill.whenNotToUse) lines.push(`Do not use when: ${skill.whenNotToUse}`)
      if (skill.instructions) lines.push(skill.instructions)
      if (skill.toolKeys.length > 0) {
        lines.push(`Often useful capabilities: ${skill.toolKeys.join(', ')}. This is guidance, not a restriction.`)
      }
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
 * Backwards-compatible runtime hook kept so existing callers do not need a
 * migration. Skills no longer narrow account tool permissions: tool_keys are
 * affinity hints for the model, while the account-level permission map remains
 * the single hard capability boundary. This lets a skill guide a multi-step
 * task without accidentally removing a later tool that the account explicitly
 * enabled (for example search -> recommendation -> scheduling -> CRM update).
 */
export function applySkillNarrowing(
  permissions: Record<AgentToolKey, boolean>,
  _selectedSkills: AgentSkill[],
): Record<AgentToolKey, boolean> {
  return permissions
}
