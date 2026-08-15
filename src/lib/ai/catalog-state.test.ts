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
        compositionTemplateId: null,
        compositionState: { slots: {} },
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
      compositionTemplateId: null,
      compositionState: { slots: {} },
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

  it('exposes only human-readable active composition context for partial revisions', () => {
    const prompt = conversationCatalogStatePrompt({
      lastQuery: null,
      lastFilters: {},
      shownProductKeys: [],
      shownMediaKeys: [],
      rejectedProductKeys: [],
      selectedProductKey: null,
      selectedProductName: null,
      compositionTemplateId: 'template-secret-id',
      compositionState: {
        slots: {
          principal: [
            {
              productId: 'product-secret-id',
              productKey: 'catalogo interno:product-secret-id',
              name: 'Oferta Principal',
            },
          ],
          complemento: [
            {
              productId: 'second-secret-id',
              productKey: 'catalogo interno:second-secret-id',
              name: 'Oferta Complementar',
            },
          ],
        },
      },
    })

    expect(prompt).toContain('Active composition has 2 populated slot(s)')
    expect(prompt).toContain('principal: "Oferta Principal"')
    expect(prompt).toContain('complemento: "Oferta Complementar"')
    expect(prompt).toContain('keep one part and change another')
    expect(prompt).not.toContain('product-secret-id')
    expect(prompt).not.toContain('template-secret-id')
  })
})
