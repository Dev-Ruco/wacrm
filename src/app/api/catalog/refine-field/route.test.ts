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

import { buildFieldRefinementPrompt, parseFieldRefinement, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireRole.mockResolvedValue({ accountId: 'account-1' })
  mocks.supabaseAdmin.mockReturnValue({})
  mocks.loadAiConfig.mockResolvedValue({ provider: 'openai', model: 'test-model' })
  mocks.loadCatalogTaxonomy.mockResolvedValue({
    categoryGroups: [['legging'], ['camisola']],
    colorGroups: [['marrom'], ['preto']],
  })
  mocks.generateReply.mockResolvedValue({
    text: '{"value":"Legging Castanha de Cintura Alta"}',
  })
})

describe('catalog per-field AI refinement', () => {
  it('builds a description prompt that treats the current edited name as authoritative', () => {
    const prompt = buildFieldRefinementPrompt('description', ['legging'], ['marrom'])
    expect(prompt).toContain('CURRENT NAME')
    expect(prompt).toContain('Rewrite ONLY the commercial description')
    expect(prompt).toContain('ABSOLUTE PRICE LOCK')
  })

  it('parses the requested value and ignores extra model wrapping', () => {
    expect(parseFieldRefinement('```json\n{"value":"Descrição melhorada."}\n```')).toBe('Descrição melhorada.')
  })

  it('sends only editorial context and never sends price, currency or stock to the model', async () => {
    const response = await POST(
      new Request('https://crm.test/api/catalog/refine-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'description',
          name: 'Legging marrom cintura alta',
          category: 'legging',
          color: 'marrom',
          description: 'Descrição antiga.',
          image_url: 'https://cdn.example.com/legging.jpg',
          price: 999999,
          currency: 'USD',
          stock_quantity: 700,
        }),
      }),
    )

    expect(response.status).toBe(200)
    const [[call]] = mocks.generateReply.mock.calls
    const textPart = call.messages[0].content.find((part: { type: string }) => part.type === 'text')
    expect(textPart.text).toContain('Legging marrom cintura alta')
    expect(textPart.text).toContain('Descrição antiga.')
    expect(textPart.text).not.toContain('999999')
    expect(textPart.text).not.toContain('USD')
    expect(textPart.text).not.toContain('700')
    expect(call.systemPrompt).toContain('Never infer, suggest, calculate, mention, correct or return them')
  })

  it('returns only the selected field suggestion', async () => {
    mocks.generateReply.mockResolvedValue({
      text: '{"value":"Descrição comercial revista com base no nome actual."}',
    })

    const response = await POST(
      new Request('https://crm.test/api/catalog/refine-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          field: 'description',
          name: 'Legging Desportiva de Cintura Alta',
          category: 'legging',
          color: 'marrom',
          description: 'Texto antigo.',
        }),
      }),
    )
    const body = await response.json()

    expect(body).toEqual({
      field: 'description',
      value: 'Descrição comercial revista com base no nome actual.',
    })
  })

  it('rejects operational fields such as price', async () => {
    const response = await POST(
      new Request('https://crm.test/api/catalog/refine-field', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field: 'price', name: 'Legging' }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.generateReply).not.toHaveBeenCalled()
  })
})
