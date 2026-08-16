import { describe, expect, it } from 'vitest'
import {
  buildLiveCatalogLearningIssue,
  sanitizeCatalogLearningRequest,
} from './live-learning'

describe('catalog live learning', () => {
  it('redacts common direct identifiers before stewardship storage', () => {
    const sanitized = sanitizeCatalogLearningRequest(
      'Quero esta opção. Ligue +258 84 123 4567 ou teste@empresa.co.mz https://example.com/x',
    )

    expect(sanitized).toContain('[número removido]')
    expect(sanitized).toContain('[email removido]')
    expect(sanitized).toContain('[link removido]')
    expect(sanitized).not.toContain('84 123 4567')
    expect(sanitized).not.toContain('teste@empresa.co.mz')
  })

  it('uses the same fingerprint for repeated equivalent catalogue requests', () => {
    const first = buildLiveCatalogLearningIssue({
      requestText: 'Tem leggings azuis tamanho M?',
      retrievalKind: 'catalog',
      outcome: 'gap',
    })
    const second = buildLiveCatalogLearningIssue({
      requestText: '  TEM   LEGGINGS AZUIS TAMANHO M?  ',
      retrievalKind: 'catalog',
      outcome: 'gap',
    })

    expect(first?.issueType).toBe(second?.issueType)
    expect(first?.severity).toBe('warning')
    expect(first?.evidence.source).toBe('live_conversation')
  })

  it('escalates a catalogue gap when it leads to human handoff', () => {
    const issue = buildLiveCatalogLearningIssue({
      requestText: 'Preciso deste serviço amanhã às 16h',
      retrievalKind: 'catalog',
      outcome: 'handoff',
    })

    expect(issue?.severity).toBe('critical')
    expect(issue?.title).toContain('atendimento humano')
    expect(issue?.evidence.handoff_count).toBe(1)
    expect(issue?.proposedChanges.auto_apply).toBe(false)
  })

  it('keeps composition gaps separate from ordinary catalogue gaps', () => {
    const catalog = buildLiveCatalogLearningIssue({
      requestText: 'Monte um pacote para mim',
      retrievalKind: 'catalog',
      outcome: 'gap',
    })
    const composition = buildLiveCatalogLearningIssue({
      requestText: 'Monte um pacote para mim',
      retrievalKind: 'composition',
      outcome: 'gap',
    })

    expect(catalog?.issueType).not.toBe(composition?.issueType)
    expect(composition?.description).toContain('composição')
  })
})
