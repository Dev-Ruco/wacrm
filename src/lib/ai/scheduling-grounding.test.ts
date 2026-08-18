import { describe, expect, it } from 'vitest'
import { schedulingEvidence, schedulingEvidenceIsComplete } from './scheduling-grounding'

describe('scheduling grounding', () => {
  it('rejects pickup intent with no customer-provided date or time', () => {
    expect(schedulingEvidenceIsComplete(['quero essa posso vir buscar?'])).toBe(false)
    expect(schedulingEvidence(['quero essa posso vir buscar?'])).toEqual({
      hasDate: false,
      hasTime: false,
    })
  })

  it('accepts date and time supplied across adjacent customer turns', () => {
    expect(schedulingEvidenceIsComplete(['posso passar amanhã?', 'às 10h'])).toBe(true)
  })

  it('accepts an explicit calendar date and time', () => {
    expect(schedulingEvidenceIsComplete(['Quero ir dia 19/08 às 10:00'])).toBe(true)
  })

  it('does not treat a vague daypart as a specific time', () => {
    expect(schedulingEvidenceIsComplete(['amanhã de manhã'])).toBe(false)
  })
})
