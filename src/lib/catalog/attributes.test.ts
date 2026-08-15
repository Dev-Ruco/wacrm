import { describe, expect, it } from 'vitest'
import {
  canReplaceCatalogAttributeValue,
  normalizeCatalogAttributeConstraints,
  productMatchesCatalogAttributeConstraints,
  resolveCatalogAttributeConstraint,
  type CatalogAttributeDefinition,
  type CatalogProductAttributeValue,
} from './attributes'
import { buildAgentCatalogRetrievalQueries } from './agent-search'

const definitions: CatalogAttributeDefinition[] = [
  {
    id: 'def-colour',
    key: 'finish',
    label: 'Acabamento',
    valueType: 'enum',
    unit: null,
    isFilterable: true,
    allowMultiple: false,
    enabled: true,
    sortOrder: 0,
    options: [
      {
        id: 'opt-matte',
        canonicalValue: 'matte',
        label: 'Fosco',
        aliases: ['mate', 'mat'],
        enabled: true,
        sortOrder: 0,
      },
    ],
  },
  {
    id: 'def-capacity',
    key: 'capacity',
    label: 'Capacidade',
    valueType: 'number',
    unit: 'pessoas',
    isFilterable: true,
    allowMultiple: false,
    enabled: true,
    sortOrder: 1,
    options: [],
  },
]

describe('catalog attributes', () => {
  it('resolves enum labels and aliases to a canonical tenant value', () => {
    const resolved = resolveCatalogAttributeConstraint(definitions, 'Acabamento', 'mate')

    expect(resolved).toMatchObject({
      definitionId: 'def-colour',
      key: 'finish',
      canonicalValue: 'matte',
    })
    expect(resolved?.aliases).toEqual(expect.arrayContaining(['matte', 'fosco', 'mate']))
  })

  it('reports unknown keys or enum values instead of silently dropping hard constraints', () => {
    expect(normalizeCatalogAttributeConstraints(definitions, {
      unknown_field: 'x',
      finish: 'brilhante',
    })).toEqual({
      constraints: [],
      unknownKeys: ['unknown_field', 'finish'],
    })
  })

  it('matches canonical product facts deterministically', () => {
    const normalized = normalizeCatalogAttributeConstraints(definitions, {
      finish: 'Fosco',
      capacity: 5,
    })
    const values: CatalogProductAttributeValue[] = [
      {
        productId: 'product-1',
        definitionId: 'def-colour',
        optionId: 'opt-matte',
        valueKey: 'matte',
        value: 'matte',
        source: 'manual',
        confidence: null,
        verified: true,
      },
      {
        productId: 'product-1',
        definitionId: 'def-capacity',
        optionId: null,
        valueKey: '5',
        value: 5,
        source: 'sync',
        confidence: 1,
        verified: true,
      },
    ]

    expect(productMatchesCatalogAttributeConstraints(
      'product-1',
      values,
      normalized.constraints,
    )).toBe(true)
  })

  it('never allows AI enrichment to overwrite a verified or manual fact', () => {
    expect(canReplaceCatalogAttributeValue({ source: 'manual', verified: false }, 'ai')).toBe(false)
    expect(canReplaceCatalogAttributeValue({ source: 'sync', verified: true }, 'ai')).toBe(false)
    expect(canReplaceCatalogAttributeValue({ source: 'ai', verified: false }, 'ai')).toBe(true)
    expect(canReplaceCatalogAttributeValue(null, 'ai')).toBe(true)
  })
})

describe('agent catalogue retrieval query expansion', () => {
  it('gives category and colour independent alias budgets', () => {
    const queries = buildAgentCatalogRetrievalQueries(
      {
        query: 'saia plissada branca',
        category: 'saia',
        color: 'white',
        mode: 'lookup',
        limit: 8,
      },
      {
        categoryGroups: [['saia', 'saias', 'skirt']],
        colorGroups: [['branco', 'branca', 'white', 'white colour']],
      },
    )

    expect(queries).toEqual(expect.arrayContaining([
      'saia plissada branca',
      'saia',
      'white',
      'branco',
      'branca',
    ]))
  })
})