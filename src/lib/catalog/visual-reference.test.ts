import { describe, expect, it } from 'vitest'
import {
  parseVisualReferenceAssessments,
  visualReferenceConfidence,
} from './visual-reference'

describe('visual reference matching', () => {
  it('accepts only server-issued candidate ids and normalizes scores', () => {
    const matches = parseVisualReferenceAssessments(
      '```json\n{"matches":[{"candidate":"C2","score":91.4,"reason":" mesmo corte  "},{"candidate":"invented","score":100},{"candidate":"C1","score":"67","reason":"cor semelhante"}]}\n```',
      ['C1', 'C2'],
    )

    expect(matches).toEqual([
      { candidate: 'C2', score: 91, reason: 'mesmo corte' },
      { candidate: 'C1', score: 67, reason: 'cor semelhante' },
    ])
  })

  it('keeps only the strongest assessment for a duplicated candidate', () => {
    const matches = parseVisualReferenceAssessments(
      '{"matches":[{"candidate":"C1","score":55},{"candidate":"C1","score":82}]}',
      ['C1'],
    )

    expect(matches).toEqual([{ candidate: 'C1', score: 82, reason: '' }])
  })

  it('requires separation from the runner-up before calling a match high confidence', () => {
    expect(visualReferenceConfidence(94, 78)).toBe('high')
    expect(visualReferenceConfidence(94, 91)).toBe('medium')
    expect(visualReferenceConfidence(72, 40)).toBe('medium')
    expect(visualReferenceConfidence(58, null)).toBe('low')
  })
})
