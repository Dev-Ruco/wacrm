import { describe, expect, it } from 'vitest'
import {
  buildCatalogImageEnrichmentPrompt,
  parseCatalogImageEnrichment,
} from './image-enrichment'

describe('catalog image enrichment', () => {
  it('asks for commercial naming and forbids invented prices', () => {
    const prompt = buildCatalogImageEnrichmentPrompt(['Leggings', 'Viaturas'])
    expect(prompt).toContain('commercial title')
    expect(prompt).toContain('Leggings')
    expect(prompt).toContain('Never estimate, infer, calculate or invent a price')
    expect(prompt).toContain('vehicles')
  })

  it('parses a grounded commercial result', () => {
    const parsed = parseCatalogImageEnrichment(
      JSON.stringify({
        name: 'Legging Desportiva de Cintura Alta',
        color: 'Azul-marinho',
        category: 'Leggings',
        description: 'Legging de corte justo e cintura alta. Indicada para treino, caminhada ou uso casual activo.',
        price: 2800,
        currency: 'MZN',
      }),
    )
    expect(parsed.name).toBe('Legging Desportiva de Cintura Alta')
    expect(parsed.price).toBe(2800)
    expect(parsed.currency).toBe('MZN')
  })

  it('keeps price null when the model provides no visible price', () => {
    const parsed = parseCatalogImageEnrichment(
      '{"name":"Frigorífico de Duas Portas","color":"Prata","category":"Frigoríficos","description":"Equipamento doméstico para conservação de alimentos.","price":null,"currency":null}',
    )
    expect(parsed.price).toBeNull()
    expect(parsed.currency).toBeNull()
  })

  it('normalises conservative numeric price strings', () => {
    expect(parseCatalogImageEnrichment('{"name":null,"color":null,"category":null,"description":"","price":"2 800,00","currency":"mzn"}').price).toBe(2800)
    expect(parseCatalogImageEnrichment('{"name":null,"color":null,"category":null,"description":"","price":"USD 50","currency":"USD"}').price).toBeNull()
  })
})
