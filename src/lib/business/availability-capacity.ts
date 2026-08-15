import type { ScheduleAvailabilityResult, ScheduleAvailabilityTarget } from './availability'

export interface AvailabilityReservationOccupancy {
  id: string
  offeringId: string | null
  entityId: string | null
  startsAt: string
  endsAt: string
  quantity: number
  status: 'held' | 'confirmed' | 'cancelled' | 'expired'
  holdExpiresAt: string | null
}

export interface AvailabilityCapacityResult extends ScheduleAvailabilityResult {
  configuredCapacity: number | null
  occupiedCapacity: number
  remainingCapacity: number | null
  matchedReservationIds: string[]
}

function safeDate(value: string | null): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function targetMatches(
  reservation: Pick<AvailabilityReservationOccupancy, 'offeringId' | 'entityId'>,
  target: ScheduleAvailabilityTarget,
): boolean {
  if (reservation.offeringId && reservation.offeringId !== target.offeringId) return false
  if (reservation.entityId && reservation.entityId !== target.entityId) return false
  return Boolean(reservation.offeringId || reservation.entityId)
}

function reservationConsumesCapacity(
  reservation: AvailabilityReservationOccupancy,
  at: Date,
  target: ScheduleAvailabilityTarget,
): boolean {
  if (!targetMatches(reservation, target)) return false
  if (reservation.status === 'cancelled' || reservation.status === 'expired') return false

  if (reservation.status === 'held') {
    const expiresAt = safeDate(reservation.holdExpiresAt)
    if (!expiresAt || expiresAt.getTime() <= at.getTime()) return false
  }

  const startsAt = safeDate(reservation.startsAt)
  const endsAt = safeDate(reservation.endsAt)
  if (!startsAt || !endsAt) return false
  return startsAt.getTime() <= at.getTime() && at.getTime() < endsAt.getTime()
}

/**
 * Subtract trusted reservation occupancy from configured schedule capacity.
 *
 * A null configured capacity means "capacity not quantified", not infinity.
 * In that case the schedule can still be considered open, but the result must
 * not claim a numeric number of remaining places.
 */
export function applyReservationOccupancy(args: {
  at: Date
  target: ScheduleAvailabilityTarget
  schedule: ScheduleAvailabilityResult
  reservations: AvailabilityReservationOccupancy[]
}): AvailabilityCapacityResult {
  const { at, target, schedule, reservations } = args

  const consuming = schedule.available
    ? reservations.filter((reservation) => reservationConsumesCapacity(reservation, at, target))
    : []
  const occupiedCapacity = consuming.reduce((total, reservation) => {
    const quantity = Number.isFinite(reservation.quantity)
      ? Math.max(0, Math.floor(reservation.quantity))
      : 0
    return total + quantity
  }, 0)

  const configuredCapacity = schedule.capacity
  const remainingCapacity = configuredCapacity === null
    ? null
    : Math.max(0, configuredCapacity - occupiedCapacity)

  return {
    ...schedule,
    available: schedule.available && (remainingCapacity === null || remainingCapacity > 0),
    configuredCapacity,
    occupiedCapacity,
    remainingCapacity,
    matchedReservationIds: consuming.map((reservation) => reservation.id),
  }
}
