import assert from 'node:assert/strict'
import test from 'node:test'

import type { Place, TripColumn } from '../types/index.ts'
import { useColumnSchedule } from './useColumnSchedule.ts'

function place(overrides: Partial<Place> & { id: string }): Place {
  return {
    tripId: 't1',
    name: 'Place',
    category: 'attraction',
    estimatedTime: 1,
    address: '京都',
    lat: 0,
    lng: 0,
    description: 'd',
    columnId: 'day-1',
    ...overrides,
  }
}

const PLACES: Place[] = [
  place({ id: 'a', name: 'A', estimatedTime: 1 }),
  place({ id: 'b', name: 'B', estimatedTime: 1, arrivalTime: '08:30' }), // overlaps A's 09:00 end
]
const COLUMNS: TripColumn[] = [{ id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['a', 'b'] }]

test('getColumnPlaces resolves placeIds to Place objects, dropping unknown ids', () => {
  const { getColumnPlaces } = useColumnSchedule(() => PLACES, () => COLUMNS, () => '08:00')
  assert.deepEqual(getColumnPlaces(['a', 'missing', 'b']).map((p) => p.id), ['a', 'b'])
})

test('getColumnCards bundles each place with its order, arrival time, and overlap flag', () => {
  const { getColumnCards } = useColumnSchedule(() => PLACES, () => COLUMNS, () => '08:00')
  const cards = getColumnCards(['a', 'b'])

  assert.equal(cards.length, 2)
  assert.equal(cards[0]!.order, 1)
  assert.equal(cards[0]!.arrivalTime, '08:00')
  assert.equal(cards[0]!.hasTimeOverlap, false)

  assert.equal(cards[1]!.order, 2)
  assert.equal(cards[1]!.arrivalTime, '08:30')
  assert.equal(cards[1]!.hasTimeOverlap, true) // manual 08:30 overlaps A's 09:00 end
  assert.equal(cards[1]!.overlapReason, 'arrival')
})

test('getColumnCards reports a departure-mode overlap as overlapReason "departure"', () => {
  const places: Place[] = [
    place({ id: 'a', estimatedTime: 1 }),
    place({ id: 'b', estimatedTime: 1, arrivalTime: '09:00', scheduleMode: 'departure', departureTime: '08:30' }),
  ]
  const { getColumnCards } = useColumnSchedule(() => places, () => COLUMNS, () => '08:00')
  const cards = getColumnCards(['a', 'b'])
  assert.equal(cards[1]!.hasTimeOverlap, true)
  assert.equal(cards[1]!.overlapReason, 'departure')
})

test('getPlaceSchedule looks up a place\'s own column and returns its resolved card', () => {
  const { getPlaceSchedule } = useColumnSchedule(() => PLACES, () => COLUMNS, () => '08:00')
  const schedule = getPlaceSchedule(PLACES[1])
  assert.equal(schedule?.place.id, 'b')
  assert.equal(schedule?.arrivalTime, '08:30')
})

test('getPlaceSchedule returns null for a null/undefined place or one whose column no longer exists', () => {
  const { getPlaceSchedule } = useColumnSchedule(() => PLACES, () => COLUMNS, () => '08:00')
  assert.equal(getPlaceSchedule(null), null)
  assert.equal(getPlaceSchedule(undefined), null)
  assert.equal(getPlaceSchedule(place({ id: 'orphan', columnId: 'day-missing' })), null)
})
