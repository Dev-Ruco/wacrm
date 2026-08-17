import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  supabaseAdmin: vi.fn(),
  loadAiConfig: vi.fn(),
  loadCatalogTaxonomy: vi.fn(),
  generateReply: vi.fn(),
}))

vi.mock('@/lib/auth/account', () => ({
  requireRole: mocks.requireRole,
  toErrorResponse: vi.fn((error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : 'error' }, { status: 500 }),
  ),
}))
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: mocks.supabaseAdmin }))
vi.mock('@/lib/ai/config', () => ({ loadAiConfig: mocks.loadAiConfig }))
vi.mock('@/lib/ai/generate', () => ({ generateReply: mocks.generateReply }))
vi.mock('@/lib/catalog/taxonomy', () => ({ loadCatalogTaxonomy: mocks.loadCatalogTaxonomy }))

import { buildClassificationSystemPrompt, POST, snapToCanonicalValue } from './route'

const EMPTY_TAXONOMY = { categoryGroups: [], colorGroups: [] }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.supabaseAdmin.mockReturnValue({})
  mocks.loadAiConfig.mockResolvedValue({ provider: 'openai', model: 'test-model' })
  mocks.loadCatalogTaxonomy.mockResolvedValue(EMPTY_TAXONOMY)
  mocks.generateReply.mockResolvedValue({
    text: '{"name":"Produto comercial","color":null,"category":null,"description":"ok"}',
  })
})

describe('buildClassificationSystemPrompt', () => {
  it('remains sector-neutral when the account has no configured taxonomy', () => {
    const prompt = buildClassificationSystemPrompt([])

    expect(prompt).toContain('Work across any sector')
    expect(prompt).toContain('Infer a concise reusable product category')
    expect(prompt).toContain('commercial title')
    expect(prompt).toContain('never extract, read, infer, estimate, calculate, suggest, return, replace or correct a price')
    expect(prompt).not.toContain('"price"')
    expect(prompt).not.toContain('"currency"')
  })

  it("includes the tenant's own configured categories when they exist", () => {
    const prompt = buildClassificationSystemPrompt(['legging', 'camisola', 'pantalona'])

    expect(prompt).toContain('pantalona')
    expect(prompt).toContain('legging')
    expect(prompt).toContain('this business vocabulary')
  })

  it('works for vehicle categories without making them the platform taxonomy', () => {
    const prompt = buildClassificationSystemPrompt(['SUV', 'sedan', 'van'])

    expect(prompt).toContain('SUV')
    expect(prompt).toContain('sedan')
    expect(prompt).toContain('vehicles')
    expect(prompt).toContain('appliances')
  })
})

describe('snapToCanonicalValue', () => {
  const groups = [
    ['pantalona', 'pantalonas', 'wide leg'],
    ['legging', 'leggings', 'colante'],
  ]

  it('snaps a differently-cased alias to the canonical value', () => {
    expect(snapToCanonicalValue('PANTALONA', groups)).toBe('pantalona')
    expect(snapToCanonicalValue('Wide Leg', groups)).toBe('pantalona')
  })

  it('leaves an unmatched value unchanged', () => {
    expect(snapToCanonicalValue('camisola', groups)).toBe('camisola')
  })

  it('passes through null and empty groups without throwing', () => {
    expect(snapToCanonicalValue(null, [])).toBeNull()
    expect(snapToCanonicalValue('SUV', [])).toBe('SUV')
  })
})

describe('POST /api/catalog/classify — tenant-driven commercial enrichment', () => {
  it("passes the tenant's categories into the prompt and snaps category/colour to canonical values", async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'lc-account' })
    mocks.loadCatalogTaxonomy.mockResolvedValue({
      categoryGroups: [['pantalona', 'pantalonas', 'wide leg'], ['legging', 'leggings']],
      colorGroups: [['preto', 'preta']],
    })
    mocks.generateReply.mockResolvedValue({
      text: '{"name":"Pantalona Preta de Corte Amplo","color":"Preta","category":"Pantalona","description":"Peça de corte amplo para coordenados casuais ou formais.","price":9999,"currency":"MZN"}',
    })

    const response = await POST(
      new Request('https://crm.test/api/catalog/classify', {
        method: 'POST',
        body: JSON.stringify({ image_url: 'https://cdn.example.com/photo.jpg' }),
      }),
    )
    const body = await response.json()

    expect(mocks.loadCatalogTaxonomy).toHaveBeenCalledWith(expect.anything(), 'lc-account')
    const [[call]] = mocks.generateReply.mock.calls
    expect(call.systemPrompt).toContain('pantalona')
    expect(body.name).toBe('Pantalona Preta de Corte Amplo')
    expect(body.category).toBe('pantalona')
    expect(body.color).toBe('preto')
    expect(body).not.toHaveProperty('price')
    expect(body).not.toHaveProperty('currency')
  })

  it("uses a car-rental tenant's configured vehicle categories with the same generic route", async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'car-rental-account' })
    mocks.loadCatalogTaxonomy.mockResolvedValue({
      categoryGroups: [['SUV', 'jipe', 'crossover'], ['sedan'], ['van']],
      colorGroups: [],
    })

    await POST(
      new Request('https://crm.test/api/catalog/classify', {
        method: 'POST',
        body: JSON.stringify({ image_url: 'https://cdn.example.com/car.jpg' }),
      }),
    )

    const [[call]] = mocks.generateReply.mock.calls
    expect(call.systemPrompt).toContain('SUV')
    expect(call.systemPrompt).toContain('vehicle class')
  })

  it('ignores price and currency even when the vision model tries to return them', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'retail-account' })
    mocks.generateReply.mockResolvedValue({
      text: '{"name":"Frigorífico de Duas Portas","color":"Prata","category":"Frigoríficos","description":"Frigorífico doméstico para conservação de alimentos.","price":24999,"currency":"MZN"}',
    })

    const response = await POST(
      new Request('https://crm.test/api/catalog/classify', {
        method: 'POST',
        body: JSON.stringify({ image_url: 'https://cdn.example.com/fridge-price.jpg' }),
      }),
    )
    const body = await response.json()

    expect(body.name).toBe('Frigorífico de Duas Portas')
    expect(body.description).toBe('Frigorífico doméstico para conservação de alimentos.')
    expect(body).not.toHaveProperty('price')
    expect(body).not.toHaveProperty('currency')
  })

  it('rejects a request with no image_url before touching the taxonomy or the model', async () => {
    mocks.requireRole.mockResolvedValue({ accountId: 'lc-account' })

    const response = await POST(
      new Request('https://crm.test/api/catalog/classify', { method: 'POST', body: JSON.stringify({}) }),
    )

    expect(response.status).toBe(400)
    expect(mocks.loadCatalogTaxonomy).not.toHaveBeenCalled()
    expect(mocks.generateReply).not.toHaveBeenCalled()
  })
})
