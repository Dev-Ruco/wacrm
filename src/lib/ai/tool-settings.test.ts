import { describe, expect, it } from 'vitest'
import {
  normalizeSearchCatalogToolSettings,
  parseSearchCatalogToolSettingsInput,
  visualReferenceMeetsMinimumConfidence,
} from './tool-settings'

describe('visual reference tool settings', () => {
  it('keeps backwards-compatible safe defaults', () => {
    expect(normalizeSearchCatalogToolSettings(null)).toEqual({
      visual_reference: {
        enabled: true,
        minimum_confidence: 'medium',
        max_candidates: 5,
        use_variant_images: true,
      },
    })
  })

  it('accepts only bounded structured administrator settings', () => {
    expect(parseSearchCatalogToolSettingsInput({
      visual_reference: {
        enabled: false,
        minimum_confidence: 'high',
        max_candidates: 4,
        use_variant_images: false,
      },
    })).toEqual({
      visual_reference: {
        enabled: false,
        minimum_confidence: 'high',
        max_candidates: 4,
        use_variant_images: false,
      },
    })
    expect(parseSearchCatalogToolSettingsInput({
      visual_reference: {
        enabled: true,
        minimum_confidence: 'low',
        max_candidates: 10,
        use_variant_images: true,
      },
    })).toBeNull()
  })

  it('enforces the configured confidence floor', () => {
    expect(visualReferenceMeetsMinimumConfidence('high', 'high')).toBe(true)
    expect(visualReferenceMeetsMinimumConfidence('medium', 'high')).toBe(false)
    expect(visualReferenceMeetsMinimumConfidence('medium', 'medium')).toBe(true)
    expect(visualReferenceMeetsMinimumConfidence('low', 'medium')).toBe(false)
  })
})
