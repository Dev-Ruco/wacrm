import { describe, expect, it } from 'vitest'
import { parseOfferingAttributeToolInput } from './tool-input'

describe('parseOfferingAttributeToolInput', () => {
  it('accepts bounded scalar hard constraints', () => {
    expect(parseOfferingAttributeToolInput([
      { key: 'capacity', value: 5 },
      { key: 'automatic', value: true },
      { key: 'finish', value: ' matte ' },
    ])).toEqual({ capacity: 5, automatic: true, finish: 'matte' })
  })

  it('returns undefined when no attributes were supplied', () => {
    expect(parseOfferingAttributeToolInput(undefined)).toBeUndefined()
    expect(parseOfferingAttributeToolInput([])).toBeUndefined()
  })

  it('rejects duplicate keys and non-scalar values', () => {
    expect(() => parseOfferingAttributeToolInput([
      { key: 'capacity', value: 5 },
      { key: 'capacity', value: 7 },
    ])).toThrow(/Duplicate catalogue attribute/)

    expect(() => parseOfferingAttributeToolInput([
      { key: 'capacity', value: { min: 5 } },
    ])).toThrow(/text, number or boolean/)
  })

  it('rejects more than the hard limit of constraints', () => {
    const input = Array.from({ length: 13 }, (_, index) => ({ key: `field_${index}`, value: index }))
    expect(() => parseOfferingAttributeToolInput(input)).toThrow(/at most 12/)
  })
})
