import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMMERCIAL_STRATEGY,
  normalizeCommercialStrategy,
  serializeCommercialStrategy,
} from './commercial-strategy'

describe('commercial strategy', () => {
  it('defaults initiative to conversation-first while preserving the legacy media fallback', () => {
    expect(normalizeCommercialStrategy(null)).toMatchObject({
      initiativeMode: 'conversation_first',
      preferVisual: true,
    })
  })

  it('preserves an existing tenant visual setting', () => {
    expect(normalizeCommercialStrategy({ prefer_visual: false })).toMatchObject({
      preferVisual: false,
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
