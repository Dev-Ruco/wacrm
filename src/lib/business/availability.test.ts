import { describe, expect, it } from 'vitest'
import {
  evaluateScheduleAvailability,
  type ScheduleAvailabilityException,
  type ScheduleAvailabilityWindow,
} from './availability'

const window: ScheduleAvailabilityWindow = {
  id: 'window-1',
  offeringId: 'offering-1',
  entityId: null,
  weekday: 1,
  startTime: '09:00:00',
  endTime: '17:00:00',
  timeZone: 'Africa/Maputo',
  capacity: 4,
  validFrom: null,
  validUntil: null,
}

function exception(
  overrides: Partial<ScheduleAvailabilityException> = {},
): ScheduleAvailabilityException {
  return {
    id: 'exception-1',
    offeringId: 'offering-1',
    entityId: null,
    startsAt: '2026-08-17T08:00:00Z',
    endsAt: '2026-08-17T10:00:00Z',
    status: 'unavailable',
    capacity: null,
    ...overrides,
  }
}

describe('evaluateScheduleAvailability', () => {
  it('evaluates recurring windows in their configured timezone', () => {
    const result = evaluateScheduleAvailability({
      at: new Date('2026-08-17T08:30:00Z'), // Monday 10:30 in Maputo
      target: { offeringId: 'offering-1' },
      windows: [window],
      exceptions: [],
    })

    expect(result).toEqual({
      available: true,
      source: 'recurring',
      capacity: 4,
      matchedWindowIds: ['window-1'],
      matchedExceptionIds: [],
    })
  })

  it('lets an unavailable exception override a matching recurring window', () => {
    const result = evaluateScheduleAvailability({
      at: new Date('2026-08-17T08:30:00Z'),
      target: { offeringId: 'offering-1' },
      windows: [window],
      exceptions: [exception()],
    })

    expect(result.available).toBe(false)
    expect(result.source).toBe('exception')
    expect(result.capacity).toBe(0)
    expect(result.matchedExceptionIds).toEqual(['exception-1'])
  })

  it('lets an available exception explicitly open time outside recurring hours', () => {
    const result = evaluateScheduleAvailability({
      at: new Date('2026-08-17T18:30:00Z'),
      target: { offeringId: 'offering-1' },
      windows: [window],
      exceptions: [exception({
        startsAt: '2026-08-17T18:00:00Z',
        endsAt: '2026-08-17T20:00:00Z',
        status: 'available',
        capacity: 2,
      })],
    })

    expect(result.available).toBe(true)
    expect(result.source).toBe('exception')
    expect(result.capacity).toBe(2)
  })

  it('requires every configured target dimension to match', () => {
    const result = evaluateScheduleAvailability({
      at: new Date('2026-08-17T08:30:00Z'),
      target: { offeringId: 'offering-1', entityId: 'professional-b' },
      windows: [{ ...window, entityId: 'professional-a' }],
      exceptions: [],
    })

    expect(result.available).toBe(false)
    expect(result.source).toBe('none')
  })

  it('uses the most conservative known capacity across simultaneous matching rules', () => {
    const result = evaluateScheduleAvailability({
      at: new Date('2026-08-17T08:30:00Z'),
      target: { offeringId: 'offering-1' },
      windows: [window, { ...window, id: 'window-2', capacity: 2 }],
      exceptions: [],
    })

    expect(result.available).toBe(true)
    expect(result.capacity).toBe(2)
    expect(result.matchedWindowIds).toEqual(['window-1', 'window-2'])
  })
})
