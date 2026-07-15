import type { Place } from '../types'

// Places without a manual arrivalTime cascade off the one before them — each
// day starts at 08:00, and every place's effective arrival is the previous
// place's effective arrival plus its own stay duration. A manual override is
// used as-is and becomes the new anchor for whatever comes after it, so
// reordering cards (or editing a duration) only ever ripples forward from
// the nearest manual anchor, never backward.
const DAY_START_TIME = '08:00'

export type ScheduledTime = { time: string; isManual: boolean }

function addMinutes(time: string, minutes: number): string {
  const [hours, mins] = time.split(':').map(Number)
  const total = (((hours * 60 + mins + minutes) % 1440) + 1440) % 1440
  const outHours = Math.floor(total / 60)
  const outMinutes = total % 60
  return `${String(outHours).padStart(2, '0')}:${String(outMinutes).padStart(2, '0')}`
}

// Takes places in display order (the same order the day's column renders
// them in) and resolves each one's effective arrival time.
export function computeArrivalTimes(places: Pick<Place, 'estimatedTime' | 'arrivalTime'>[]): ScheduledTime[] {
  let cursor = DAY_START_TIME

  return places.map((place) => {
    const time = place.arrivalTime ?? cursor
    const isManual = Boolean(place.arrivalTime)
    cursor = addMinutes(time, Math.round(place.estimatedTime * 60))
    return { time, isManual }
  })
}
