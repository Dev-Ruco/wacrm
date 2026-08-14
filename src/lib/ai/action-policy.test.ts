import { describe, expect, it } from 'vitest'
import { DEFAULT_COMMERCIAL_STRATEGY } from './commercial-strategy'
import {
  customerExplicitlyRequestedPresentation,
  toolsAllowedForTurn,
} from './action-policy'

const tools = [
  { name: 'search_catalog', description: 'search', parameters: { type: 'object' } },
  { name: 'send_product', description: 'present', parameters: { type: 'object' } },
  { name: 'search_knowledge', description: 'knowledge', parameters: { type: 'object' } },
]

describe('customerExplicitlyRequestedPresentation', () => {
  it('detects an explicit visual request without business vocabulary', () => {
    expect(
      customerExplicitlyRequestedPresentation([
        { role: 'user', content: 'Mostra-me essas duas opções.' },
      ]),
    ).toBe(true)
  })

  it('treats a short yes as consent when the assistant just offered to show media', () => {
    expect(
      customerExplicitlyRequestedPresentation([
        { role: 'assistant', content: 'Quer que eu mostre as fotografias?' },
        { role: 'user', content: 'sim' },
      ]),
    ).toBe(true)
  })

  it('does not treat a normal product need as a media request', () => {
    expect(
      customerExplicitlyRequestedPresentation([
        { role: 'user', content: 'Preciso de duas opções para treino.' },
      ]),
    ).toBe(false)
  })
})

describe('toolsAllowedForTurn', () => {
  it('removes only presentation when automatic media is disabled', () => {
    const allowed = toolsAllowedForTurn({
      tools,
      messages: [{ role: 'user', content: 'Preciso de duas opções.' }],
      strategy: { ...DEFAULT_COMMERCIAL_STRATEGY, preferVisual: false },
    })
    expect(allowed?.map((tool) => tool.name)).toEqual([
      'search_catalog',
      'search_knowledge',
    ])
  })

  it('allows presentation on explicit request even in text-first mode', () => {
    const allowed = toolsAllowedForTurn({
      tools,
      messages: [{ role: 'user', content: 'Mostra-me as fotos.' }],
      strategy: { ...DEFAULT_COMMERCIAL_STRATEGY, preferVisual: false },
    })
    expect(allowed?.map((tool) => tool.name)).toContain('send_product')
  })

  it('keeps presentation available for a tenant that enabled automatic media', () => {
    const allowed = toolsAllowedForTurn({
      tools,
      messages: [{ role: 'user', content: 'Preciso de duas opções.' }],
      strategy: { ...DEFAULT_COMMERCIAL_STRATEGY, preferVisual: true },
    })
    expect(allowed?.map((tool) => tool.name)).toContain('send_product')
  })
})
