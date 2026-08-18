import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import { applySkillNarrowing, type AgentSkill } from './skills'
import { AGENT_TOOL_KEYS, type AgentToolKey } from './tool-permissions'
import type { AiConfig } from './types'

const h = vi.hoisted(() => ({
  generateReply: vi.fn(),
}))

vi.mock('./generate', () => ({ generateReply: h.generateReply }))
vi.mock('./trace-context', () => ({ getAgentTraceContext: () => null }))

import {
  buildSkillRouterPrompt,
  parseSkillSelection,
  selectSkillsForTurn,
} from './skill-router'

const STYLE: AgentSkill = {
  id: 'skill-style',
  name: 'Consultoria de Estilo',
  instructions: 'Use catálogo real e dê uma opinião de estilo.',
  objective: 'Ajudar o cliente a escolher o que lhe fica melhor.',
  whenToUse: 'Quando o cliente pede uma sugestão ou opinião de estilo.',
  whenNotToUse: 'Quando apenas pergunta preço ou stock.',
  toolKeys: ['search_catalog', 'get_style_opinion'],
}

const SALES: AgentSkill = {
  id: 'skill-sales',
  name: 'Venda de Produtos',
  instructions: 'Ajude o cliente a avançar para uma escolha.',
  objective: 'Apoiar uma intenção comercial sobre produtos.',
  whenToUse: 'Quando existe interesse real num produto.',
  whenNotToUse: 'Quando é apenas uma saudação.',
  toolKeys: ['search_catalog', 'send_product'],
}

function config(): AiConfig {
  return {
    agentId: 'agent-1',
    provider: 'openai',
    model: 'gpt-test',
    apiKey: 'sk-test',
    systemPrompt: null,
    commercialStrategy: DEFAULT_COMMERCIAL_STRATEGY,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    bufferWindowSeconds: 12,
    maxReplyChunks: 3,
    handoffAgentId: null,
    embeddingsApiKey: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseSkillSelection', () => {
  it('accepts only configured ids, removes duplicates and respects the limit', () => {
    const result = parseSkillSelection(
      JSON.stringify({
        skill_ids: ['skill-sales', 'invented', 'skill-sales', 'skill-style'],
      }),
      [STYLE, SALES],
      2,
    )

    expect(result.map((skill) => skill.id)).toEqual(['skill-sales', 'skill-style'])
  })

  it('recovers exact configured ids from malformed provider output without guessing names', () => {
    const result = parseSkillSelection(
      'I would choose id skill-style, but not some-other-id.',
      [STYLE, SALES],
    )

    expect(result.map((skill) => skill.id)).toEqual(['skill-style'])
  })
})

describe('selectSkillsForTurn', () => {
  it('does not call the router when the account has no enabled skills', async () => {
    const result = await selectSkillsForTurn({
      skills: [],
      config: config(),
      messages: [{ role: 'user', content: 'Boa tarde' }],
    })

    expect(result).toEqual({ skills: [], usage: null })
    expect(h.generateReply).not.toHaveBeenCalled()
  })

  it('routes against recent conversation context and returns only the selected subset', async () => {
    h.generateReply.mockResolvedValue({
      text: '{"skill_ids":["skill-style"]}',
      handoff: false,
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    })

    const result = await selectSkillsForTurn({
      skills: [STYLE, SALES],
      config: config(),
      messages: [
        { role: 'user', content: 'Quero um conjunto para treinar.' },
        { role: 'assistant', content: 'Prefere algo discreto ou mais chamativo?' },
        { role: 'user', content: 'Discreto. Qual acha que ficaria melhor em mim?' },
      ],
    })

    expect(result.skills.map((skill) => skill.id)).toEqual(['skill-style'])
    expect(result.usage?.totalTokens).toBe(25)
    expect(h.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ temperature: 0 }),
        observabilityLabel: 'Skill router',
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: 'Discreto. Qual acha que ficaria melhor em mim?',
          }),
        ]),
      }),
    )
  })

  it('keeps enough recent context for an elliptical sales follow-up to be resolved', async () => {
    h.generateReply.mockResolvedValue({
      text: '{"skill_ids":["skill-sales"]}',
      handoff: false,
      usage: null,
    })

    const messages = [
      { role: 'user' as const, content: 'Quero um macacão preto.' },
      { role: 'assistant' as const, content: 'Tenho estas opções.' },
      { role: 'user' as const, content: 'O segundo.' },
      { role: 'assistant' as const, content: 'Esse modelo existe em M e L.' },
      { role: 'user' as const, content: 'M' },
    ]

    const result = await selectSkillsForTurn({
      skills: [STYLE, SALES],
      config: config(),
      messages,
    })

    expect(result.skills.map((skill) => skill.id)).toEqual(['skill-sales'])
    expect(h.generateReply).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('inherit the active customer goal'),
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: 'Quero um macacão preto.' }),
          expect.objectContaining({ role: 'user', content: 'M' }),
        ]),
      }),
    )
  })

  it('fails availability-safe when the routing model errors', async () => {
    h.generateReply.mockRejectedValue(new Error('provider unavailable'))

    const result = await selectSkillsForTurn({
      skills: [STYLE],
      config: config(),
      messages: [{ role: 'user', content: 'Pode ajudar?' }],
    })

    expect(result).toEqual({ skills: [], usage: null })
  })
})

describe('skill permission narrowing', () => {
  it('keeps account permissions untouched when no skill was selected', () => {
    const permissions = Object.fromEntries(
      AGENT_TOOL_KEYS.map((key) => [key, true]),
    ) as Record<AgentToolKey, boolean>

    expect(applySkillNarrowing(permissions, [])).toEqual(permissions)
  })

  it('selected skills can restrict but never grant account tools', () => {
    const permissions = Object.fromEntries(
      AGENT_TOOL_KEYS.map((key) => [key, false]),
    ) as Record<AgentToolKey, boolean>
    permissions.search_catalog = true
    permissions.send_product = true
    permissions.handoff_human = true
    // Even though STYLE asks for get_style_opinion, the account did not
    // enable it globally, so the skill must not grant it.
    const result = applySkillNarrowing(permissions, [STYLE])

    expect(result.search_catalog).toBe(true)
    expect(result.send_product).toBe(false)
    expect(result.get_style_opinion).toBe(false)
    expect(result.handoff_human).toBe(true)
  })
})

describe('buildSkillRouterPrompt', () => {
  it('uses compact routing metadata instead of injecting full skill instructions', () => {
    const prompt = buildSkillRouterPrompt([STYLE, SALES])

    expect(prompt).toContain('Consultoria de Estilo')
    expect(prompt).toContain('Quando o cliente pede uma sugestão')
    expect(prompt).not.toContain('Use catálogo real e dê uma opinião de estilo.')
    expect(prompt).toContain('{"skill_ids"')
  })

  it('explicitly preserves specialised intent across short follow-ups', () => {
    const prompt = buildSkillRouterPrompt([SALES])

    expect(prompt).toContain('inherit the active customer goal')
    expect(prompt).toContain('in-progress specialised task should not become skill-less')
    expect(prompt).toContain('quero esse')
  })
})
