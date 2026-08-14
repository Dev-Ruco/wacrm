import { describe, expect, it } from 'vitest'
import { catalogNameConflictsWithRequestedCategory } from './agent-search'

const fashionTaxonomy = [
  ['top', 'tops'],
  ['camisola', 'camisolas'],
  ['blusão', 'blusao', 'blusões'],
]

describe('catalogNameConflictsWithRequestedCategory', () => {
  it('rejects a product whose own name clearly identifies another tenant category', () => {
    expect(
      catalogNameConflictsWithRequestedCategory('CAMISOLA COM FECHO', 'top', fashionTaxonomy),
    ).toBe(true)
  })

  it('keeps a product whose name confirms the requested category', () => {
    expect(
      catalogNameConflictsWithRequestedCategory('TOP ECLIPSE', 'top', fashionTaxonomy),
    ).toBe(false)
  })

  it('resolves requested aliases through the tenant taxonomy', () => {
    expect(
      catalogNameConflictsWithRequestedCategory('TOP ECLIPSE', 'tops', fashionTaxonomy),
    ).toBe(false)
    expect(
      catalogNameConflictsWithRequestedCategory('CAMISOLA COM FECHO', 'tops', fashionTaxonomy),
    ).toBe(true)
  })

  it('stays conservative when the product name contains no configured category term', () => {
    expect(
      catalogNameConflictsWithRequestedCategory('Modelo Eclipse', 'top', fashionTaxonomy),
    ).toBe(false)
  })

  it('does nothing when the tenant has no configured taxonomy', () => {
    expect(
      catalogNameConflictsWithRequestedCategory('CAMISOLA COM FECHO', 'top', []),
    ).toBe(false)
  })

  it('works for a completely different tenant vocabulary without core hardcoding', () => {
    const vehicleTaxonomy = [
      ['SUV', 'jipe', 'crossover'],
      ['sedan', 'berlina'],
    ]
    expect(
      catalogNameConflictsWithRequestedCategory('Sedan Executive', 'jipe', vehicleTaxonomy),
    ).toBe(true)
    expect(
      catalogNameConflictsWithRequestedCategory('SUV Executive', 'jipe', vehicleTaxonomy),
    ).toBe(false)
  })
})
