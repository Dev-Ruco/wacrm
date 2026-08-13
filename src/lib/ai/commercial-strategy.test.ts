import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMMERCIAL_STRATEGY,
  normalizeCommercialStrategy,
  serializeCommercialStrategy,
} from './commercial-strategy'

describe('commercial strategy', () => {
  it('defaults new tenants to conversation-first text-first behaviour', () => {
    expect(normalizeCommercialStrategy(null)).toMatchObject({
      initiativeMode: 'conversation_first',
      preferVisual: false,
    })
  })

  it('preserves an existing tenant visual setting', () => {
    expect(normalizeCommercialStrategy({ prefer_visual: true })).toMatchObject({
      preferVisual: true,
    })
  })

  it('round-trips initiative mode in tenant configuration', () => {
    const strategy = {
      ...DEFAULT_COMMERCIAL_STRATEGY,
      initiativeMode: 'balanced' as const,
    }
    const stored = serializeCommercialStrategy(strategy)
    expect(stored).toMatchObject({ initiative_mode: 'balanced' })
    expect(normalizeCommercialStrategy(stored)).toMatchObject({
      initiativeMode: 'balanced',
    })
  })
})
