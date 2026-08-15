import { describe, expect, it } from 'vitest'
import { conversationCatalogStatePrompt } from './catalog-state'

describe('conversationCatalogStatePrompt', () => {
  it('returns null for an empty catalogue state', () => {
    expect(
      conversationCatalogStatePrompt({
        lastQuery: null,
        lastFilters: {},
        shownProductKeys: [],
        shownMediaKeys: [],
        rejectedProductKeys: [],
        selectedProductKey: null,
        selectedProductName: null,
      }),
    ).toBeNull()
  })

  it('keeps selected product and structured filters without exposing internal keys', () => {
    const prompt = conversationCatalogStatePrompt({
      lastQuery: 'modelo familiar',
      lastFilters: {
        category: 'SUV',
        color: 'preto',
        size: null,
        attributes: { seats: 7, automatic: true, fuel: 'diesel' },
        mode: 'browse',
      },
      shownProductKeys: ['internal:secret-product-id'],
      shownMediaKeys: ['internal:secret-product-id#1'],
      rejectedProductKeys: [],
      selectedProductKey: 'internal:secret-product-id',
      selectedProductName: 'Modelo Familiar',
    })

    expect(prompt).toContain('Modelo Familiar')
    expect(prompt).toContain('category="SUV"')
    expect(prompt).toContain('color="preto"')
    expect(prompt).toContain('attribute.seats="7"')
    expect(prompt).toContain('attribute.automatic="true"')
    expect(prompt).toContain('attribute.fuel="diesel"')
    expect(prompt).toContain('1 product(s) have already been shown')
    expect(prompt).not.toContain('secret-product-id')
  })
})
