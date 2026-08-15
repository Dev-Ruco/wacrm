import { describe, expect, it } from 'vitest'
import {
  externalIdText,
  normalizeCanonicalSourceProduct,
} from './sync'

describe('canonical catalogue source normalization', () => {
  it('accepts stable numeric external identifiers', () => {
    expect(externalIdText(42)).toBe('42')
    expect(externalIdText('  SKU-42 ')).toBe('SKU-42')
    expect(externalIdText(Number.NaN)).toBeNull()
  })

  it('normalizes tenant-mapped source fields without domain vocabulary', () => {
    const product = normalizeCanonicalSourceProduct(
      {
        remote_key: 991,
        title: 'Oferta Premium',
        commercial: {
          amount: '1250.50',
          currency: 'MZN',
        },
        media: [{ href: 'https://cdn.example.com/991.jpg' }],
        classification: { label: 'Categoria A' },
        inventory: { available: '7' },
      },
      {
        id: 'remote_key',
        name: 'title',
        price: 'commercial.amount',
        currency: 'commercial.currency',
        imageUrl: 'media.0.href',
        category: 'classification.label',
        stockQuantity: 'inventory.available',
      },
    )

    expect(product).toMatchObject({
      externalId: '991',
      name: 'Oferta Premium',
      price: 1250.5,
      currency: 'MZN',
      imageUrl: 'https://cdn.example.com/991.jpg',
      category: 'Categoria A',
      stockQuantity: 7,
      variants: [],
    })
  })

  it('rejects incomplete or invalid commercial records', () => {
    expect(normalizeCanonicalSourceProduct(
      { id: '1', name: 'Sem preço' },
      {},
    )).toBeNull()

    expect(normalizeCanonicalSourceProduct(
      { id: '2', name: 'Preço inválido', price: -1 },
      {},
    )).toBeNull()

    expect(normalizeCanonicalSourceProduct(
      { id: '', name: 'Sem identificador', price: 10 },
      {},
    )).toBeNull()
  })
})
