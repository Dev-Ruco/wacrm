import { describe, expect, it } from 'vitest'
import {
  canReplaceOfferingAttributeValue,
  normalizeOfferingAttributeConstraints,
  offeringAttributeConstraintSearchTerms,
  productMatchesOfferingAttributeConstraints,
  resolveOfferingAttributeConstraint,
  type OfferingAttributeDefinition,
  type OfferingAttributeValue,
} from './attributes'

const definitions: OfferingAttributeDefinition[] = [
  {
    id: 'global-capacity',
    offeringTypeId: null,
    key: 'capacity',
    label: 'Capacidade',
    valueType: 'number',
    unit: 'pessoas',
    isFilterable: true,
    allowMultiple: false,
    required: false,
    enabled: true,
    sortOrder: 0,
    options: [],
  },
  {
    id: 'vehicle-finish',
    offeringTypeId: 'vehicle',
    key: 'finish',
    label: 'Acabamento',
    valueType: 'enum',
    unit: null,
    isFilterable: true,
    allowMultiple: false,
    required: false,
    enabled: true,
    sortOrder: 1,
    options: [{
      value: 'matte',
      label: 'Fosco',
      aliases: ['mate', 'mat'],
      enabled: true,
      sortOrder: 0,
    }],
  },
  {
    id: 'furniture-finish',
    offeringTypeId: 'furniture',
    key: 'finish',
    label: 'Acabamento',
    valueType: 'enum',
    unit: null,
    isFilterable: true,
    allowMultiple: false,
    required: false,
    enabled: true,
    sortOrder: 2,
    options: [{
      value: 'matte',
      label: 'Fosco',
      aliases: ['mate'],
      enabled: true,
      sortOrder: 0,
    }],
  },
]

describe('Business Offering attributes', () => {
  it('resolves the same tenant key across offering types without picking one arbitrarily', () => {
    const resolved = resolveOfferingAttributeConstraint(definitions, 'Acabamento', 'mate')

    expect(resolved?.key).toBe('finish')
    expect(resolved?.alternatives.map((item) => item.definitionId)).toEqual([
      'vehicle-finish',
      'furniture-finish',
    ])
    expect(offeringAttributeConstraintSearchTerms(resolved ? [resolved] : [])).toEqual(
      expect.arrayContaining(['matte', 'fosco', 'mate']),
    )
  })

  it('treats unknown hard keys or enum values as unresolved instead of ignoring them', () => {
    expect(normalizeOfferingAttributeConstraints(definitions, {
      unknown_field: 'x',
      finish: 'brilhante',
    })).toEqual({
      constraints: [],
      unknownKeys: ['unknown_field', 'finish'],
    })
  })

  it('matches deterministic values for the relevant offering type', () => {
    const normalized = normalizeOfferingAttributeConstraints(definitions, {
      finish: 'Fosco',
      capacity: 5,
    })
    const values: OfferingAttributeValue[] = [
      {
        productId: 'product-1',
        definitionId: 'vehicle-finish',
        valueKey: 'matte',
        value: 'matte',
        source: 'manual',
        confidence: null,
        verified: true,
      },
      {
        productId: 'product-1',
        definitionId: 'global-capacity',
        valueKey: '5',
        value: 5,
        source: 'sync',
        confidence: 1,
        verified: true,
      },
    ]

    expect(productMatchesOfferingAttributeConstraints(
      'product-1',
      'vehicle',
      values,
      normalized.constraints,
    )).toBe(true)
    expect(productMatchesOfferingAttributeConstraints(
      'product-1',
      'furniture',
      values,
      normalized.constraints,
    )).toBe(false)
  })

  it('never lets AI enrichment overwrite a manual or verified fact', () => {
    expect(canReplaceOfferingAttributeValue({ source: 'manual', verified: false }, 'ai')).toBe(false)
    expect(canReplaceOfferingAttributeValue({ source: 'sync', verified: true }, 'ai')).toBe(false)
    expect(canReplaceOfferingAttributeValue({ source: 'ai', verified: false }, 'ai')).toBe(true)
    expect(canReplaceOfferingAttributeValue(null, 'ai')).toBe(true)
  })
})
