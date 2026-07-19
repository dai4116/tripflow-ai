import type { Place } from '../types'

// Places without a manual arrivalTime cascade off the one before them. Each
// day starts at 08:00; a place advances the cursor by its stay duration, or
// uses its explicit departureTime when departure mode is active. A manual
// arrival becomes the next anchor, so edits only ripple forward.
const DAY_START_TIME = '08:00'

export type ScheduledTime = { time: string; hasOverlap: boolean; hasInvalidDeparture: boolean }

function clockTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function isBeforePreviousEnd(time: string, previousEnd: string): boolean {
  const currentMinutes = clockTimeToMinutes(time)
  const previousEndMinutes = clockTimeToMinutes(previousEnd)

  // A TripColumn represents one itinerary day. Do not silently reinterpret an
  // earlier clock time as "the next day" — without an explicit day offset that
  // guess hides real conflicts such as 20:00 followed by a manual 05:00.
  return currentMinutes < previousEndMinutes
}

export function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number)
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440
  const outHours = Math.floor(total / 60)
  const outMinutes = total % 60
  return `${String(outHours).padStart(2, '0')}:${String(outMinutes).padStart(2, '0')}`
}

// Minutes from start to end, wrapping past midnight if end is earlier in the
// clock than start (e.g. arriving 23:00, leaving 00:30 is a 90-minute stay).
export function minutesBetween(start: string, end: string): number {
  const [startHours, startMins] = start.split(':').map(Number)
  const [endHours, endMins] = end.split(':').map(Number)
  const diff = endHours * 60 + endMins - (startHours * 60 + startMins)
  return diff >= 0 ? diff : diff + 1440
}

// "1.5" -> "1 時 30 分" (or "1 小時" when there's no leftover minutes) — the
// one place a stay duration's decimal-hours storage becomes reader-facing.
export function formatStayDuration(hours: number): string {
  const wholeHours = Math.floor(hours)
  const minutes = Math.round((hours - wholeHours) * 60)
  return minutes > 0 ? `${wholeHours} 時 ${String(minutes).padStart(2, '0')} 分` : `${wholeHours} 小時`
}

// 1.5 -> "01:30" — same decimal-hours storage, but formatted to feed (and
// read back from) TimePickerSheet, which only knows HH/MM wheels.
export function hoursToHHMM(hours: number): string {
  const wholeHours = Math.floor(hours)
  const minutes = Math.round((hours - wholeHours) * 60)
  return `${String(wholeHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function hhmmToHours(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (Number.isFinite(hours) ? hours : 0) + (Number.isFinite(minutes) ? minutes : 0) / 60
}

// Takes places in display order (the same order the day's column renders
// them in) and resolves each one's effective arrival time.
export function computeArrivalTimes(
  places: Pick<Place, 'id' | 'estimatedTime' | 'arrivalTime' | 'scheduleMode' | 'departureTime' | 'travelToNext'>[],
): ScheduledTime[] {
  let cursor = DAY_START_TIME
  // Tracks the latest end time seen so far (not just the previous card's) —
  // a short intermediate stay can pull `cursor` earlier than an even-earlier
  // card's real end, and comparing overlap against `cursor` alone would then
  // miss a manual arrival that still lands inside that earlier card's window.
  let maxEnd = DAY_START_TIME

  return places.map((place, index) => {
    const time = place.arrivalTime ?? cursor
    const hasOverlap = index > 0 && Boolean(place.arrivalTime) && isBeforePreviousEnd(time, maxEnd)

    // A departure time earlier than this place's own arrival is invalid —
    // trust it only when it doesn't rewind the cascade; otherwise fall back
    // to the duration-based end so one bad value can't corrupt every card
    // after it, and surface it as its own conflict on this card.
    const departureIsSet = place.scheduleMode === 'departure' && Boolean(place.departureTime)
    const hasInvalidDeparture = departureIsSet && isBeforePreviousEnd(place.departureTime!, time)
    const departure = departureIsSet && !hasInvalidDeparture ? place.departureTime! : addMinutes(time, Math.round(place.estimatedTime * 60))

    // travelToNext can be stale (pointing at a place that's no longer
    // actually next — see the TravelToNext type comment, e.g. after a
    // reorder) — only add it to the cascade when it still matches the place
    // that's actually next in this list.
    const nextPlace = places[index + 1]
    const travelMinutes = place.travelToNext && nextPlace && place.travelToNext.toPlaceId === nextPlace.id ? place.travelToNext.durationMin : 0
    cursor = addMinutes(departure, travelMinutes)
    // maxEnd reflects the earliest you could physically be at the NEXT
    // place (departure + travel), not just when this stay ends — a manual
    // arrival exactly at departure time would otherwise not be flagged as
    // an overlap even when there's a real travel gap to close first.
    if (!isBeforePreviousEnd(cursor, maxEnd)) maxEnd = cursor

    return { time, hasOverlap, hasInvalidDeparture }
  })
}
