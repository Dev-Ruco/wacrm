import { describe, expect, it } from 'vitest'
import {
  chooseBetterRelation,
  compositionResultToState,
  type CompositionEvidence,
  type CompositionResult,
} from './composition'
import type { CatalogProduct } from './types'

function evidence(overrides: Partial<CompositionEvidence> = {}): CompositionEvidence {
  return {
    relationKey: 'compatible',
    score: 0.8,
    confidence: 0.7,
    verified: false,
    anchorProductId: 'anchor-1',
    ...overrides,
  }
}

function product(id: string, name: string): CatalogProduct {
  return {
    id,
    name,
    description: null,
    price: 100,
    currency: 'MZN',
    imageUrl: null,
    productUrl: null,
    category: null,
    stockQuantity: 1,
    sourceName: 'Catálogo interno',
    sourceType: 'internal',
  }
}

describe('composition relation ranking', () => {
  it('prefers materially stronger graph evidence', () => {
    const current = evidence({ score: 0.55, verified: true })
    const candidate = evidence({ score: 0.9, verified: false })

    expect(chooseBetterRelation(current, candidate)).toBe(candidate)
  })

  it('uses verification to distinguish otherwise close evidence', () => {
    const current = evidence({ score: 0.8, verified: false })
    const candidate = evidence({ score: 0.8, verified: true })

    expect(chooseBetterRelation(current, candidate)).toBe(candidate)
  })

  it('uses confidence as a deterministic secondary signal', () => {
    const current = evidence({ score: 0.8, confidence: 0.2 })
    const candidate = evidence({ score: 0.8, confidence: 0.9 })

    expect(chooseBetterRelation(current, candidate)).toBe(candidate)
  })
})

describe('composition persisted state', () => {
  it('stores only stable canonical identity and human-readable names per configured slot', () => {
    const result: CompositionResult = {
      template: { id: 'template-1', key: 'solution', label: 'Solução', description: null },
      slots: [
        {
          slot: {
            id: 'slot-a',
            key: 'primary',
            label: 'Principal',
            required: true,
            minItems: 1,
            maxItems: 1,
            offeringTypeIds: ['type-a'],
          },
          selections: [{ product: product('product-1', 'Oferta A'), reason: 'relation', relation: evidence() }],
          complete: true,
        },
        {
          slot: {
            id: 'slot-b',
            key: 'secondary',
            label: 'Complemento',
            required: false,
            minItems: 0,
            maxItems: 1,
            offeringTypeIds: ['type-b'],
          },
          selections: [{ product: product('product-2', 'Oferta B'), reason: 'eligible_fallback', relation: null }],
          complete: true,
        },
      ],
      complete: true,
    }

    expect(compositionResultToState(result)).toEqual({
      slots: {
        primary: [{
          productId: 'product-1',
          productKey: 'catalogo interno:product-1',
          name: 'Oferta A',
        }],
        secondary: [{
          productId: 'product-2',
          productKey: 'catalogo interno:product-2',
          name: 'Oferta B',
        }],
      },
    })
  })
})
