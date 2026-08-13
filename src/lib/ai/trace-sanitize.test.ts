import { describe, expect, it } from 'vitest'
import {
  sanitizeTraceMetadata,
  toolTraceFinishedMetadata,
  toolTraceStartedMetadata,
} from './trace-sanitize'

describe('trace metadata sanitization', () => {
  it('redacts sensitive keys and credential-like values recursively', () => {
    const result = sanitizeTraceMetadata({
      api_key: 'should-not-survive',
      nested: {
        authorization: 'Bearer abcdefghijklmnopqrstuvwxyz',
        safe: 'catalog lookup',
      },
      tokenish: 'eyJabcdefghijklmno.abcdefghijklmnop.abcdefghijklmnop',
    })

    expect(result.api_key).toBe('[REDACTED]')
    expect((result.nested as Record<string, unknown>).authorization).toBe('[REDACTED]')
    expect((result.nested as Record<string, unknown>).safe).toBe('catalog lookup')
    expect(result.tokenish).toBe('[REDACTED]')
  })

  it('keeps only a privacy-reduced catalogue input summary', () => {
    const result = toolTraceStartedMetadata(
      'search_catalog',
      JSON.stringify({
        query: 'camisola treino',
        category: 'camisola',
        color: 'preto',
        size: 'M',
        mode: 'browse',
        irrelevant_private_field: 'must disappear',
      }),
    )

    expect(result).toMatchObject({
      action_class: 'read',
      input: {
        query: 'camisola treino',
        category: 'camisola',
        color: 'preto',
        size: 'M',
        mode: 'browse',
      },
    })
    expect(JSON.stringify(result)).not.toContain('irrelevant_private_field')
  })

  it('does not copy knowledge excerpts into a finished tool trace', () => {
    const result = toolTraceFinishedMetadata({
      name: 'search_knowledge',
      rawArguments: JSON.stringify({ query: 'política de devolução', limit: 3 }),
      rawResult: JSON.stringify({
        ok: true,
        found: true,
        matches: [
          { content: 'conteúdo privado muito longo' },
          { content: 'segundo documento' },
        ],
      }),
    })

    expect(result).toMatchObject({
      action_class: 'read',
      output: { ok: true, found: true, match_count: 2 },
    })
    expect(JSON.stringify(result)).not.toContain('conteúdo privado')
  })
})
