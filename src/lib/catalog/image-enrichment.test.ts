import { describe, expect, it } from 'vitest'
import {
  buildCatalogImageEnrichmentPrompt,
  parseCatalogImageEnrichment,
} from './image-enrichment'

describe('catalog image enrichment', () => {
  it('asks for commercial enrichment and explicitly forbids price handling', () => {
    const prompt = buildCatalogImageEnrichmentPrompt(['Leggings', 'Viaturas'])
    expect(prompt).toContain('commercial title')
    expect(prompt).toContain('Leggings')
    expect(prompt).toContain('never extract, read, infer, estimate, calculate, suggest, return, replace or correct a price')
    expect(prompt).toContain('vehicles')
    expect(prompt).not.toContain('"price"')
    expect(prompt).not.toContain('"currency"')
  })

  it('parses only editorial fields', () => {
    const parsed = parseCatalogImageEnrichment(
      JSON.stringify({
        name: 'Legging Desportiva de Cintura Alta',
        color: 'Azul-marinho',
        category: 'Leggings',
        description: 'Legging de corte justo e cintura alta. Indicada para treino, caminhada ou uso casual activo.',
      }),
    )
    expect(parsed).toEqual({
      name: 'Legging Desportiva de Cintura Alta',
      color: 'Azul-marinho',
      category: 'Leggings',
      description: 'Legging de corte justo e cintura alta. Indicada para treino, caminhada ou uso casual activo.',
    })
  })

  it('ignores price and currency even if a model tries to return them', () => {
    const parsed = parseCatalogImageEnrichment(
      '{"name":"Frigorífico de Duas Portas","color":"Prata","category":"Frigoríficos","description":"Equipamento doméstico para conservação de alimentos.","price":28000,"currency":"MZN"}',
    )
    expect(parsed).toEqual({
      name: 'Frigorífico de Duas Portas',
      color: 'Prata',
      category: 'Frigoríficos',
      description: 'Equipamento doméstico para conservação de alimentos.',
    })
    expect('price' in parsed).toBe(false)
    expect('currency' in parsed).toBe(false)
  })
})
