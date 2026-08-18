import { describe, expect, it } from 'vitest'
import { applySkillNarrowing, type AgentSkill } from './skills'
import type { AgentToolKey } from './tool-permissions'

const allOff = (): Record<AgentToolKey, boolean> => ({
  search_catalog: false,
  send_product: false,
  compose_solution: false,
  search_knowledge: false,
  add_tag: false,
  create_deal: false,
  schedule_visit: false,
  get_style_opinion: false,
  handoff_human: false,
  check_availability: false,
  create_order: false,
  get_order_status: false,
  update_contact: false,
})

describe('skill grounding permissions', () => {
  it('keeps administrator-enabled knowledge lookup even when selected skill omits it', () => {
    const permissions = allOff()
    permissions.search_knowledge = true
    permissions.create_order = true
    permissions.handoff_human = true

    const skill: AgentSkill = {
      id: 'sale',
      name: 'Fecho de Venda',
      instructions: '',
      objective: '',
      whenToUse: '',
      whenNotToUse: '',
      toolKeys: ['create_order'],
    }

    const effective = applySkillNarrowing(permissions, [skill])
    expect(effective.search_knowledge).toBe(true)
    expect(effective.create_order).toBe(true)
    expect(effective.handoff_human).toBe(true)
  })
})
