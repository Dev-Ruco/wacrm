import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WacrmSupabaseClient } from '@/lib/supabase/types'

const h = vi.hoisted(() => ({ embedTexts: vi.fn() }))
vi.mock('./embeddings', () => ({
  embedTexts: h.embedTexts,
  toVectorLiteral: (v: number[]) => `[${v.join(',')}]`,
}))

import { retrieveKnowledge, ingestDocument, expandKnowledgeQuery, isLocationKnowledgeQuery } from './knowledge'

interface FakeState {
  semantic: { id: string; content: string }[]
  fts: { id: string; content: string }[]
  expandedFts: { id: string; content: string }[]
  chunks: { id: string; content: string }[]
  chunkCount: number
  rpcCalls: string[]
  rpcQueries: string[]
  inserted: Record<string, unknown>[] | null
  deletedFor: string | null
}

function makeDb() {
  const state: FakeState = {
    semantic: [],
    fts: [],
    expandedFts: [],
    chunks: [],
    chunkCount: 5,
    rpcCalls: [],
    rpcQueries: [],
    inserted: null,
    deletedFor: null,
  }
  const db = {
    rpc: (name: string, args?: Record<string, unknown>) => {
      state.rpcCalls.push(name)
      if (name === 'match_ai_knowledge_semantic')
        return Promise.resolve({ data: state.semantic, error: null })
      if (name === 'match_ai_knowledge_fts') {
        const query = typeof args?.p_query === 'string' ? args.p_query : ''
        state.rpcQueries.push(query)
        const data = state.rpcQueries.length > 1 ? state.expandedFts : state.fts
        return Promise.resolve({ data, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    },
    from: () => ({
      select: (columns?: string) => {
        if (columns === 'id, content') {
          return {
            eq: () => ({
              limit: () => Promise.resolve({ data: state.chunks, error: null }),
            }),
          }
        }
        return {
          eq: () => Promise.resolve({ count: state.chunkCount, error: null }),
        }
      },
      delete: () => ({
        eq: (_col: string, val: string) => {
          state.deletedFor = val
          return Promise.resolve({ error: null })
        },
      }),
      insert: (rows: Record<string, unknown>[]) => {
        state.inserted = rows
        return Promise.resolve({ error: null })
      },
    }),
  }
  return { db: db as unknown as WacrmSupabaseClient, state }
}

beforeEach(() => {
  h.embedTexts.mockReset()
  h.embedTexts.mockImplementation(async (_key: string, inputs: string[]) =>
    inputs.map((_, i) => [i, i]),
  )
})

describe('retrieveKnowledge', () => {
  it('returns [] for an empty query without touching the DB', async () => {
    const { db, state } = makeDb()
    expect(await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, '  ')).toEqual([])
    expect(state.rpcCalls).toEqual([])
  })

  it('short-circuits (no embed, no RPC) when the KB is empty', async () => {
    const { db, state } = makeDb()
    state.chunkCount = 0
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q')
    expect(out).toEqual([])
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.rpcCalls).toEqual([])
  })

  it('uses lexical FTS only when there is no embeddings key', async () => {
    const { db, state } = makeDb()
    state.fts = [{ id: 'f1', content: 'F1' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'q')
    expect(out).toEqual(['F1'])
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_fts'])
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('uses semantic search when an embeddings key is present', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
      { id: 's3', content: 'S3' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'S3'])
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    expect(state.rpcCalls).toEqual(['match_ai_knowledge_semantic'])
  })

  it('tops up with FTS and dedupes when semantic is short', async () => {
    const { db, state } = makeDb()
    state.semantic = [
      { id: 's1', content: 'S1' },
      { id: 's2', content: 'S2' },
    ]
    state.fts = [
      { id: 's2', content: 'S2-dup' },
      { id: 'f1', content: 'F1' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'q', 3)
    expect(out).toEqual(['S1', 'S2', 'F1'])
    expect(state.rpcCalls).toEqual([
      'match_ai_knowledge_semantic',
      'match_ai_knowledge_fts',
    ])
  })

  it('tries the original query before lexical expansion for a short location query', async () => {
    const { db, state } = makeDb()
    state.expandedFts = [{ id: 'f1', content: 'Morada: Avenida 24 de Julho, Maputo' }]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'onde fica', 3)
    expect(out).toEqual(['Morada: Avenida 24 de Julho, Maputo'])
    expect(state.rpcQueries[0]).toBe('onde fica')
    expect(state.rpcQueries[1]).toContain('morada')
  })

  it('falls back to account chunks only after normal and expanded location search miss', async () => {
    const { db, state } = makeDb()
    state.chunks = [
      { id: 'c1', content: 'Política de troca disponível na loja.' },
      { id: 'c2', content: 'Morada da loja: Av. Eduardo Mondlane, Maputo.' },
    ]
    const out = await retrieveKnowledge(db, 'acct', { embeddingsApiKey: null }, 'onde fica', 3)
    expect(out).toContain('Morada da loja: Av. Eduardo Mondlane, Maputo.')
    expect(state.rpcQueries).toHaveLength(2)
  })
})

describe('location fallback helpers', () => {
  it('recognises common location wording only for fallback recovery', () => {
    expect(isLocationKnowledgeQuery('onde fica')).toBe(true)
    expect(isLocationKnowledgeQuery('qual é a morada?')).toBe(true)
    expect(isLocationKnowledgeQuery('como chegar à loja?')).toBe(true)
    expect(isLocationKnowledgeQuery('quanto custa?')).toBe(false)
  })

  it('leaves unrelated queries unchanged', () => {
    expect(expandKnowledgeQuery('qual é a política de troca?')).toBe('qual é a política de troca?')
  })
})

describe('ingestDocument', () => {
  it('embeds chunks when a key is present', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world')
    expect(h.embedTexts).toHaveBeenCalledTimes(1)
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBe('[0,0]')
    expect(state.inserted![0].account_id).toBe('acct')
  })

  it('stores chunks without embeddings when there is no key', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: null }, 'doc-1', 'hello world')
    expect(h.embedTexts).not.toHaveBeenCalled()
    expect(state.inserted![0].embedding).toBeNull()
  })

  it('deletes existing chunks and inserts nothing for empty content', async () => {
    const { db, state } = makeDb()
    await ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', '   ')
    expect(state.deletedFor).toBe('doc-1')
    expect(state.inserted).toBeNull()
    expect(h.embedTexts).not.toHaveBeenCalled()
  })

  it('still stores lexical chunks when embedding fails, then rethrows', async () => {
    const { db, state } = makeDb()
    h.embedTexts.mockRejectedValueOnce(new Error('rate limited'))
    await expect(
      ingestDocument(db, 'acct', { embeddingsApiKey: 'sk-x' }, 'doc-1', 'hello world'),
    ).rejects.toThrow('rate limited')
    expect(state.inserted).toHaveLength(1)
    expect(state.inserted![0].embedding).toBeNull()
  })
})
