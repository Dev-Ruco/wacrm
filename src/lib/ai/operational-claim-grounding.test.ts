import { describe, expect, it } from 'vitest'
import { unsupportedOperationalClaims } from './generate'

describe('unsupportedOperationalClaims', () => {
  it('blocks a completed reservation claim without a confirming tool', () => {
    expect(
      unsupportedOperationalClaims(
        'Perfeito 😊 Já ficou reservado em teu nome.',
        new Set(),
      ),
    ).toEqual([
      {
        claim: 'reservation completed',
        tools: ['create_order', 'schedule_visit'],
      },
    ])
  })

  it('allows a reservation claim after a successful order tool', () => {
    expect(
      unsupportedOperationalClaims(
        'Perfeito 😊 Já ficou reservado em teu nome.',
        new Set(['create_order']),
      ),
    ).toEqual([])
  })

  it('requires schedule_visit before claiming an appointment is scheduled', () => {
    expect(
      unsupportedOperationalClaims(
        'A visita ficou agendada para sexta às 14h.',
        new Set(['check_availability']),
      ),
    ).toEqual([
      {
        claim: 'visit scheduled',
        tools: ['schedule_visit'],
      },
    ])
  })

  it('does not treat a negative statement as a completed reservation', () => {
    expect(
      unsupportedOperationalClaims(
        'Ainda não ficou reservado; preciso confirmar primeiro.',
        new Set(),
      ),
    ).toEqual([])
  })

  it('does not block future intent that does not claim completion', () => {
    expect(
      unsupportedOperationalClaims(
        'Posso reservar para ti assim que confirmares o tamanho.',
        new Set(),
      ),
    ).toEqual([])
  })
})
