import { describe, expect, it } from 'vitest'
import { parseCustomerJourneyStage } from './customer-journey-classifier'

describe('parseCustomerJourneyStage', () => {
  it('accepts an exact stage key', () => {
    expect(parseCustomerJourneyStage('price_presented')).toBe('price_presented')
  })

  it('accepts a fenced or JSON-wrapped single stage', () => {
    expect(parseCustomerJourneyStage('```text\npayment_pending\n```')).toBe('payment_pending')
    expect(parseCustomerJourneyStage('{"stage":"negotiating"}')).toBe('negotiating')
  })

  it('rejects ambiguous output containing multiple stages', () => {
    expect(parseCustomerJourneyStage('need_identified ou solution_identified')).toBeNull()
  })

  it('rejects unknown stages instead of inventing one', () => {
    expect(parseCustomerJourneyStage('ready_to_buy')).toBeNull()
  })
})
