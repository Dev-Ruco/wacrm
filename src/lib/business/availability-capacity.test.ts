import { describe, expect, it } from 'vitest'
import { applyReservationOccupancy, type AvailabilityReservationOccupancy } from './availability-capacity'

const target = { offeringId: 'offering-1', entityId: 'professional-1' }
const at = new Date('2026-08-17T08:30:00Z')

function reservation(
  overrides: Partial<AvailabilityReservationOccupancy> = {},
): AvailabilityReservationOccupancy {
  return {
    id: 'reservation-1',
    offeringId: 'offering-1',
    entityId: 'professional-1',
    startsAt: '2026-08-17T08:00:00Z',
    endsAt: '2026-08-17T09:00:00Z',
    quantity: 1,
    status: 'confirmed',
    holdExpiresAt: null,
    ...overrides,
  }
}

const openSchedule = {
  available: true,
  source: 'recurring' as const,
  capacity: 3,
  matchedWindowIds: ['window-1'],
  matchedExceptionIds: [],
}

describe('applyReservationOccupancy', () => {
  it('subtracts overlapping confirmed reservations from configured capacity', () => {
    const result = applyReservationOccupancy({
      at,
      target,
      schedule: openSchedule,
      reservations: [reservation({ quantity: 2 })],
    })

    expect(result.available).toBe(true)
    expect(result.configuredCapacity).toBe(3)
    expect(result.occupiedCapacity).toBe(2)
    expect(result.remainingCapacity).toBe(1)
    expect(result.matchedReservationIds).toEqual(['reservation-1'])
  })

  it('marks the instant unavailable when known capacity is fully consumed', () => {
    const result = applyReservationOccupancy({
      at,
      target,
      schedule: openSchedule,
      reservations: [reservation({ quantity: 3 })],
    })

    expect(result.available).toBe(false)
    expect(result.remainingCapacity).toBe(0)
  })

  it('ignores cancelled, expired and expired-hold reservations', () => {
    const result = applyReservationOccupancy({
      at,
      target,
      schedule: openSchedule,
      reservations: [
        reservation({ id: 'cancelled', status: 'cancelled' }),
        reservation({ id: 'expired', status: 'expired' }),
        reservation({
          id: 'held-expired',
          status: 'held',
          holdExpiresAt: '2026-08-17T08:29:59Z',
        }),
      ],
    })

    expect(result.occupiedCapacity).toBe(0)
    expect(result.remainingCapacity).toBe(3)
    expect(result.matchedReservationIds).toEqual([])
  })

  it('counts an unexpired hold as occupied capacity', () => {
    const result = applyReservationOccupancy({
      at,
      target,
      schedule: openSchedule,
      reservations: [reservation({
        status: 'held',
        holdExpiresAt: '2026-08-17T08:45:00Z',
      })],
    })

    expect(result.occupiedCapacity).toBe(1)
    expect(result.remainingCapacity).toBe(2)
  })

  it('does not invent a remaining number when configured capacity is unknown', () => {
    const result = applyReservationOccupancy({
      at,
      target,
      schedule: { ...openSchedule, capacity: null },
      reservations: [reservation({ quantity: 4 })],
    })

    expect(result.available).toBe(true)
    expect(result.configuredCapacity).toBeNull()
    expect(result.occupiedCapacity).toBe(4)
    expect(result.remainingCapacity).toBeNull()
  })

  it('does not count reservations from another target', () => {
    const result = applyReservationOccupancy({
      at,
      target,
      schedule: openSchedule,
      reservations: [reservation({ entityId: 'professional-2', quantity: 3 })],
    })

    expect(result.occupiedCapacity).toBe(0)
    expect(result.remainingCapacity).toBe(3)
  })
})
