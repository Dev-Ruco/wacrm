import { describe, expect, it } from 'vitest'
import { normalizeCatalogIdentity, parseCatalogPackage } from './package-import'

describe('catalog package parser', () => {
  it('normalizes products and LC-style variants', () => {
    const result = parseCatalogPackage({
      version: 1,
      source: 'lc-fitness',
      catalog: { name: 'LC Fitness' },
      products: [
        {
          external_id: 'p-1',
          name: 'Legging Cintura Alta',
          price: 2800,
          currency: 'MZN',
          image_url: 'https://cdn.example.com/p-1.webp',
          images: ['https://cdn.example.com/p-1.webp', { url: 'https://cdn.example.com/p-1-b.webp' }],
          variants: [
            {
              external_id: 'v-1',
              sku: 'LC-001',
              size: 'M',
              color: 'Preto',
              price: 2800,
              stock: 4,
              image_url: 'https://cdn.example.com/v-1.webp',
            },
          ],
        },
      ],
    })

    expect(result.source).toBe('lc-fitness')
    expect(result.catalogName).toBe('LC Fitness')
    expect(result.variantCount).toBe(1)
    expect(result.products[0].images).toHaveLength(2)
    expect(result.products[0].variants[0]).toMatchObject({
      externalId: 'v-1',
      sku: 'LC-001',
      size: 'M',
      color: 'Preto',
      price: 2800,
      stockQuantity: 4,
    })
  })

  it('rejects unsupported versions and non-https media', () => {
    expect(() => parseCatalogPackage({ version: 2, products: [] })).toThrow(/Versão/)
    expect(() => parseCatalogPackage({
      version: 1,
      products: [{ name: 'Produto', price: 10, image_url: 'http://example.com/a.jpg' }],
    })).toThrow(/HTTPS/)
  })

  it('normalizes names for safe merge matching', () => {
    expect(normalizeCatalogIdentity('Legging Cintura-Alta')).toBe('legging cintura alta')
    expect(normalizeCatalogIdentity('  Ténis   Feminino ')).toBe('tenis feminino')
  })
})
