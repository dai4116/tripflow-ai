import assert from 'node:assert/strict'
import test from 'node:test'

import type { CreateTripInput } from '../types/index.ts'
import {
  cityFromDestination,
  computeTripDays,
  dayColorForIndex,
  formatDateRange,
  generateTrip,
  paceForTravelStyles,
  placesPerDayForPace,
  regionFromDestination,
  type PlaceSuggestion,
} from './generateTrip.ts'

function baseInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
  return {
    destination: '京都，日本',
    startDate: '2024-03-01',
    endDate: '2024-03-01',
    travelers: 2,
    travelStyle: [],
    additionalNotes: '',
    preferences: [],
    ...overrides,
  }
}

test('placesPerDayForPace maps each pace to its fixed count', () => {
  assert.equal(placesPerDayForPace('relaxed'), 3)
  assert.equal(placesPerDayForPace('balanced'), 4)
  assert.equal(placesPerDayForPace('packed'), 5)
})

test('paceForTravelStyles falls back to balanced when nothing resolves', () => {
  assert.equal(paceForTravelStyles([]), 'balanced')
  assert.equal(paceForTravelStyles(['不存在的風格']), 'balanced')
})

test('paceForTravelStyles uses a single style\'s own number directly', () => {
  assert.equal(paceForTravelStyles(['自在慢旅']), 'relaxed') // 3
  assert.equal(paceForTravelStyles(['深度探索']), 'balanced') // 4
})

test('paceForTravelStyles averages two styles and rounds to the nearest bucket', () => {
  // 精準規劃(5) + 自在慢旅(3) averages to exactly 4 -> balanced
  assert.equal(paceForTravelStyles(['精準規劃', '自在慢旅']), 'balanced')
  // 精準規劃(5) + 深度探索(4) averages to 4.5 -> rounds up to 5 -> packed
  assert.equal(paceForTravelStyles(['精準規劃', '深度探索']), 'packed')
})

test('cityFromDestination / regionFromDestination split on the first comma', () => {
  assert.equal(cityFromDestination('京都，日本'), '京都')
  assert.equal(regionFromDestination('京都，日本'), '日本')
  assert.equal(cityFromDestination('Tokyo, Japan'), 'Tokyo')
  assert.equal(regionFromDestination('Tokyo, Japan'), 'Japan')
})

test('cityFromDestination / regionFromDestination handle destinations with no comma', () => {
  assert.equal(cityFromDestination('沖繩'), '沖繩')
  assert.equal(regionFromDestination('沖繩'), '')
})

test('computeTripDays counts inclusive calendar days', () => {
  assert.equal(computeTripDays({ startDate: '2024-03-01', endDate: '2024-03-03' }), 3)
})

test('computeTripDays clamps an overlong span to 30 days', () => {
  assert.equal(computeTripDays({ startDate: '2024-01-01', endDate: '2024-03-01' }), 30)
})

test('computeTripDays clamps an end-before-start span to 1 day', () => {
  assert.equal(computeTripDays({ startDate: '2024-03-10', endDate: '2024-03-01' }), 1)
})

test('computeTripDays falls back to 7 days for unparseable dates', () => {
  assert.equal(computeTripDays({ startDate: 'not-a-date', endDate: '2024-03-01' }), 7)
})

test('formatDateRange formats a same-month range without repeating the month', () => {
  assert.equal(formatDateRange('2024-03-05', '2024-03-08'), '2024年3月5日 - 8日')
})

test('formatDateRange spells out the month again when it crosses a month boundary', () => {
  assert.equal(formatDateRange('2024-03-28', '2024-04-02'), '2024年3月28日 - 4月2日')
})

test('dayColorForIndex cycles once it runs out of distinct colors', () => {
  assert.equal(dayColorForIndex(0), dayColorForIndex(6))
  assert.notEqual(dayColorForIndex(0), dayColorForIndex(1))
})

test('generateTrip groups suggestions by their own day field and drops out-of-range or untagged ones', () => {
  const aiPlaces: PlaceSuggestion[] = [
    { day: 1, name: 'A1', category: 'attraction', description: 'd' },
    { day: 1, name: 'A2', category: 'food', description: 'd' },
    { day: 2, name: 'B1', category: 'attraction', description: 'd' },
    { day: 4, name: 'OutOfRange', category: 'other', description: 'd' }, // trip is only 3 days
    { name: 'NoDay', category: 'other', description: 'd' }, // missing day tag
  ]
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-03' })
  const { trip, places } = generateTrip(input, [], aiPlaces, 2)

  assert.equal(trip.columns.length, 3)
  const namesForColumn = (columnId: string) =>
    trip.columns
      .find((c) => c.id === columnId)!
      .placeIds.map((id) => places.find((p) => p.id === id)!.name)

  assert.deepEqual(namesForColumn('day-1'), ['A1', 'A2'])
  assert.deepEqual(namesForColumn('day-2'), ['B1'])
  assert.deepEqual(namesForColumn('day-3'), [])
  // OutOfRange and NoDay never became places at all.
  assert.equal(places.length, 3)
})

test('generateTrip orders a day by time-of-day bucket first, then nearest-neighbor within a bucket', () => {
  const aiPlaces: PlaceSuggestion[] = [
    { day: 1, name: 'Evening1', category: 'food', description: 'd', timeOfDay: 'evening', lat: 0, lng: 0 },
    { day: 1, name: 'Morning1', category: 'attraction', description: 'd', timeOfDay: 'morning', lat: 0, lng: 0 },
    { day: 1, name: 'Morning3-far', category: 'attraction', description: 'd', timeOfDay: 'morning', lat: 0, lng: 10 },
    { day: 1, name: 'Morning2-near', category: 'attraction', description: 'd', timeOfDay: 'morning', lat: 0, lng: 1 },
  ]
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' })
  const { trip, places } = generateTrip(input, [], aiPlaces, 4)

  const order = trip.columns[0]!.placeIds.map((id) => places.find((p) => p.id === id)!.name)
  // Morning bucket goes first (evening last) and, within it, the greedy
  // nearest-neighbor chain visits the near point before the far one even
  // though the far one appeared earlier in the input array.
  assert.deepEqual(order, ['Morning1', 'Morning2-near', 'Morning3-far', 'Evening1'])
})

test('generateTrip caps each day at placesPerDay and does not backfill a short day', () => {
  const aiPlaces: PlaceSuggestion[] = [
    { day: 1, name: 'A1', category: 'attraction', description: 'd' },
    { day: 1, name: 'A2', category: 'attraction', description: 'd' },
    { day: 1, name: 'A3', category: 'attraction', description: 'd' },
  ]
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' })
  const { trip, places } = generateTrip(input, [], aiPlaces, 2)

  assert.equal(trip.columns[0]!.placeIds.length, 2)
  assert.equal(places.length, 2)
})

test('generateTrip falls back to the pace-derived placesPerDay when no override is given', () => {
  const aiPlaces: PlaceSuggestion[] = Array.from({ length: 5 }, (_, i) => ({
    day: 1,
    name: `Place${i}`,
    category: 'attraction' as const,
    description: 'd',
  }))
  // travelStyle: [] -> paceForTravelStyles -> 'balanced' -> 4 per day
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01', travelStyle: [] })
  const { trip } = generateTrip(input, [], aiPlaces)

  assert.equal(trip.pace, 'balanced')
  assert.equal(trip.columns[0]!.placeIds.length, 4)
})

test('generateTrip carries the resolved trip metadata through', () => {
  const input = baseInput({
    destination: '京都，日本',
    startDate: '2024-03-05',
    endDate: '2024-03-08',
    travelStyle: ['自在慢旅'],
  })
  const { trip, places } = generateTrip(input, [], [])

  assert.equal(trip.title, '京都之旅')
  assert.equal(trip.destination, '京都，日本')
  assert.equal(trip.days, 4)
  assert.equal(trip.dateRange, '2024年3月5日 - 8日')
  assert.equal(trip.pace, 'relaxed')
  assert.equal(trip.columns.length, 4)
  assert.equal(trip.placeCount, places.length)
  assert.equal(places.length, 0)
})
