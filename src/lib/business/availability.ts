export interface ScheduleAvailabilityTarget {
  offeringId?: string | null
  entityId?: string | null
}

export interface ScheduleAvailabilityWindow {
  id: string
  offeringId: string | null
  entityId: string | null
  weekday: number
  startTime: string
  endTime: string
  timeZone: string
  capacity: number | null
  validFrom: string | null
  validUntil: string | null
}

export interface ScheduleAvailabilityException {
  id: string
  offeringId: string | null
  entityId: string | null
  startsAt: string
  endsAt: string
  status: 'available' | 'unavailable'
  capacity: number | null
}

export interface ScheduleAvailabilityResult {
  available: boolean
  source: 'exception' | 'recurring' | 'none'
  capacity: number | null
  matchedWindowIds: string[]
  matchedExceptionIds: string[]
}

const WEEKDAY: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function targetMatches(
  rule: { offeringId: string | null; entityId: string | null },
  target: ScheduleAvailabilityTarget,
): boolean {
  if (rule.offeringId && rule.offeringId !== target.offeringId) return false
  if (rule.entityId && rule.entityId !== target.entityId) return false
  return Boolean(rule.offeringId || rule.entityId)
}

function minuteOfDay(value: string): number | null {
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function safeDate(value: string): Date | null {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function zonedParts(date: Date, timeZone: string): {
  weekday: number
  date: string
  minute: number
} | null {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const parts = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]))
    const weekday = WEEKDAY[parts.get('weekday') ?? '']
    const year = parts.get('year')
    const month = parts.get('month')
    const day = parts.get('day')
    const hour = Number(parts.get('hour'))
    const minute = Number(parts.get('minute'))
    if (
      weekday === undefined || !year || !month || !day ||
      !Number.isFinite(hour) || !Number.isFinite(minute)
    ) return null
    return {
      weekday,
      date: `${year}-${month}-${day}`,
      minute: hour * 60 + minute,
    }
  } catch {
    return null
  }
}

function conservativeCapacity(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  return known.length ? Math.min(...known) : null
}

function matchingExceptions(
  at: Date,
  target: ScheduleAvailabilityTarget,
  exceptions: ScheduleAvailabilityException[],
) {
  const timestamp = at.getTime()
  return exceptions.filter((exception) => {
    if (!targetMatches(exception, target)) return false
    const startsAt = safeDate(exception.startsAt)?.getTime()
    const endsAt = safeDate(exception.endsAt)?.getTime()
    return startsAt !== undefined && endsAt !== undefined && startsAt !== null && endsAt !== null &&
      startsAt <= timestamp && timestamp < endsAt
  })
}

/**
 * Resolve schedule availability from trusted configuration only.
 *
 * Precedence is deliberately conservative:
 * 1. any matching `unavailable` exception closes the period;
 * 2. a matching `available` exception explicitly opens the period;
 * 3. otherwise a recurring window must match in its own IANA timezone.
 *
 * This evaluator does not subtract bookings or inventory. Capacity returned
 * here is configured schedule capacity, not remaining capacity.
 */
export function evaluateScheduleAvailability(args: {
  at: Date
  target: ScheduleAvailabilityTarget
  windows: ScheduleAvailabilityWindow[]
  exceptions: ScheduleAvailabilityException[]
}): ScheduleAvailabilityResult {
  const { at, target, windows, exceptions } = args
  if (Number.isNaN(at.getTime()) || (!target.offeringId && !target.entityId)) {
    return { available: false, source: 'none', capacity: null, matchedWindowIds: [], matchedExceptionIds: [] }
  }

  const activeExceptions = matchingExceptions(at, target, exceptions)
  const blocking = activeExceptions.filter((exception) => exception.status === 'unavailable')
  if (blocking.length) {
    return {
      available: false,
      source: 'exception',
      capacity: 0,
      matchedWindowIds: [],
      matchedExceptionIds: blocking.map((exception) => exception.id),
    }
  }

  const opening = activeExceptions.filter((exception) => exception.status === 'available')
  if (opening.length) {
    return {
      available: true,
      source: 'exception',
      capacity: conservativeCapacity(opening.map((exception) => exception.capacity)),
      matchedWindowIds: [],
      matchedExceptionIds: opening.map((exception) => exception.id),
    }
  }

  const matchedWindows = windows.filter((window) => {
    if (!targetMatches(window, target)) return false
    const local = zonedParts(at, window.timeZone)
    if (!local || local.weekday !== window.weekday) return false
    if (window.validFrom && local.date < window.validFrom) return false
    if (window.validUntil && local.date > window.validUntil) return false
    const start = minuteOfDay(window.startTime)
    const end = minuteOfDay(window.endTime)
    if (start === null || end === null || end <= start) return false
    return start <= local.minute && local.minute < end
  })

  if (!matchedWindows.length) {
    return { available: false, source: 'none', capacity: null, matchedWindowIds: [], matchedExceptionIds: [] }
  }
  return {
    available: true,
    source: 'recurring',
    capacity: conservativeCapacity(matchedWindows.map((window) => window.capacity)),
    matchedWindowIds: matchedWindows.map((window) => window.id),
    matchedExceptionIds: [],
  }
}
