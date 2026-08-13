import { describe, expect, it } from 'vitest'
import { splitReplyIntoChunks } from './chunk-reply'
import { evaluateAgentOutput } from './guardrails'

describe('history annotation recovery path', () => {
  it('allows useful content to continue while stripping the internal marker before send', () => {
    const text = '[Imagem enviada no WhatsApp]\nAqui estão outras duas opções.'
    const guardrail = evaluateAgentOutput({ text })

    expect(guardrail.safe).toBe(true)
    expect(guardrail.violations).toContain('history_annotation_leak')
    expect(splitReplyIntoChunks(text, 3)).toEqual([
      'Aqui estão outras duas opções.',
    ])
  })

  it('still blocks a serious violation even when an annotation is also present', () => {
    const text =
      '[Imagem enviada no WhatsApp]\nUse sk-abcdefghijklmnopqrstuvwxyz1234567890'
    const guardrail = evaluateAgentOutput({ text })

    expect(guardrail.safe).toBe(false)
    expect(guardrail.violations).toEqual(
      expect.arrayContaining(['history_annotation_leak', 'credential_or_secret']),
    )
  })
})
