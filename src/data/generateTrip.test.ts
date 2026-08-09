import assert from 'node:assert/strict'
import test from 'node:test'

import type { CreateTripInput } from '../types/index.ts'
import {
  cityFromDestination,
  computeTripDays,
  dayColorForIndex,
  dayWindowForPace,
  formatDateRange,
  generateTrip,
  paceForTravelStyles,
  regionFromDestination,
  resolveEstimatedTime,
  targetCountForWindow,
  windowForFlightDay,
  type PlaceSuggestion,
} from './generateTrip.ts'

function baseInput(overrides: Partial<CreateTripInput> = {}): CreateTripInput {
  return {
    destination: '京都，日本',
    startDate: '2024-03-01',
    endDate: '2024-03-01',
    travelStyle: [],
    additionalNotes: '',
    preferences: [],
    ...overrides,
  }
}

test('dayWindowForPace maps each pace to its active-hours window', () => {
  // relaxed starts late morning on purpose (a sleep-in pace), so its start
  // hour differs from the other two rather than only its length — and it's
  // still the shortest day of the three, so it stays the sparsest pace.
  assert.deepEqual(dayWindowForPace('relaxed'), { start: '10:00', end: '19:00' })
  assert.deepEqual(dayWindowForPace('balanced'), { start: '08:00', end: '19:00' })
  assert.deepEqual(dayWindowForPace('packed'), { start: '08:00', end: '21:00' })
})

test('paceForTravelStyles falls back to balanced when nothing resolves', () => {
  assert.equal(paceForTravelStyles([]), 'balanced')
  assert.equal(paceForTravelStyles(['不存在的風格']), 'balanced')
})

test('paceForTravelStyles looks up the selected style directly', () => {
  assert.equal(paceForTravelStyles(['自在慢旅']), 'relaxed')
  assert.equal(paceForTravelStyles(['精準規劃']), 'packed')
})

test('paceForTravelStyles only reads the first style if more than one is ever passed', () => {
  // The form is single-select now, so this shouldn't happen in practice —
  // but the function itself no longer averages; it just reads travelStyles[0].
  assert.equal(paceForTravelStyles(['精準規劃', '自在慢旅']), 'packed')
})

test('targetCountForWindow derives a soft candidate count from window length', () => {
  // Each pace stays a distinct density: relaxed < balanced < packed.
  assert.equal(targetCountForWindow({ start: '10:00', end: '19:00' }), 5) // relaxed: 540/105 ~ 5.14 -> 5
  assert.equal(targetCountForWindow({ start: '08:00', end: '19:00' }), 6) // balanced: 660/105 ~ 6.29 -> 6
  assert.equal(targetCountForWindow({ start: '08:00', end: '21:00' }), 7) // packed: 780/105 ~ 7.43 -> 7
})

test('targetCountForWindow returns 0 for a zero-length window and never exceeds the hard max', () => {
  assert.equal(targetCountForWindow({ start: '08:00', end: '08:00' }), 0)
  assert.equal(targetCountForWindow({ start: '00:00', end: '23:59' }), 7)
})

test('targetCountForWindow returns 0 for a nonzero window too short to fit even one place, not a floored-up 1', () => {
  // 50 minutes is under MIN_ESTIMATED_HOURS (60min) — too short for even the
  // shortest possible stop, so this must be treated the same as "skip this
  // day," not forced up to a minimum of 1 the way a merely-small-but-viable
  // window would be.
  assert.equal(targetCountForWindow({ start: '08:00', end: '08:50' }), 0)
  // 60 minutes exactly is the shortest a single stop can be — still viable.
  assert.equal(targetCountForWindow({ start: '08:00', end: '09:00' }), 1)
})

test('resolveEstimatedTime uses the AI estimate, clamped to a sane range', () => {
  assert.equal(resolveEstimatedTime('attraction', 2), 2)
  assert.equal(resolveEstimatedTime('attraction', 0.1), 1)
  assert.equal(resolveEstimatedTime('attraction', 10), 6)
})

test('resolveEstimatedTime rounds a valid AI estimate up to the nearest half hour, never down', () => {
  assert.equal(resolveEstimatedTime('attraction', 1.2), 1.5)
  assert.equal(resolveEstimatedTime('food', 1.6), 2)
  // Already a clean half-hour value — rounding is a no-op.
  assert.equal(resolveEstimatedTime('attraction', 2), 2)
})

test('resolveEstimatedTime falls back to the category default when the AI value is missing or invalid', () => {
  assert.equal(resolveEstimatedTime('attraction'), 1.5)
  assert.equal(resolveEstimatedTime('food', Number.NaN), 1)
  assert.equal(resolveEstimatedTime('other'), 1)
})

test('resolveEstimatedTime always uses the fixed default for stay/transport, ignoring any AI estimate', () => {
  assert.equal(resolveEstimatedTime('stay', 5), 0.5)
  assert.equal(resolveEstimatedTime('transport', 3), 0.25)
})

test('windowForFlightDay leaves middle days and days with no flight info untouched', () => {
  const base = dayWindowForPace('balanced')
  assert.deepEqual(windowForFlightDay(base, 2, 3, { arrivalTime: '15:00', departureTime: '20:00' }), base)
  assert.deepEqual(windowForFlightDay(base, 1, 3, {}), base)
})

test('windowForFlightDay narrows day 1 for a late arrival and the last day for an early departure', () => {
  const base = dayWindowForPace('balanced') // 08:00-19:00
  // Arriving 15:00 -> buffered start 16:30.
  assert.deepEqual(windowForFlightDay(base, 1, 3, { arrivalTime: '15:00' }), { start: '16:30', end: '19:00' })
  // Departing 12:00 -> buffered end 10:30.
  assert.deepEqual(windowForFlightDay(base, 3, 3, { departureTime: '12:00' }), { start: '08:00', end: '10:30' })
})

test('windowForFlightDay + targetCountForWindow: a late arrival leaving only a tiny unusable sliver is treated as "skip this day"', () => {
  // Balanced pace ends at 19:00. Arriving 17:25 -> buffered start 18:55,
  // leaving only 5 minutes — nonzero-length (so windowForFlightDay alone
  // doesn't collapse it), but targetCountForWindow's own too-short floor
  // must still report 0 rather than forcing a place into 5 minutes of time.
  const base = dayWindowForPace('balanced')
  const narrowed = windowForFlightDay(base, 1, 3, { arrivalTime: '17:25' })
  assert.deepEqual(narrowed, { start: '18:55', end: '19:00' })
  assert.equal(targetCountForWindow(narrowed), 0)
})

test('windowForFlightDay combines both ends for a one-day trip with a known arrival and departure', () => {
  const base = dayWindowForPace('packed') // 08:00-21:00
  const result = windowForFlightDay(base, 1, 1, { arrivalTime: '09:00', departureTime: '18:00' })
  // Arrive 09:00 (buffered 10:30), depart 18:00 (buffered 16:30).
  assert.deepEqual(result, { start: '10:30', end: '16:30' })
})

test('windowForFlightDay collapses to a zero-length window when a flight leaves no usable time at all', () => {
  const base = dayWindowForPace('balanced')
  const result = windowForFlightDay(base, 1, 1, { arrivalTime: '20:00' })
  assert.deepEqual(result, { start: base.start, end: base.start })
})

test('windowForFlightDay does not wrap past midnight for a very late arrival or very early departure', () => {
  // A later arrival must never leave MORE room than an earlier one — both of
  // these buffer past the window's own end entirely, so both should collapse
  // to zero length, same as an exact-boundary arrival does (regression: a
  // naive HH:mm-wrapping buffer previously read a very late arrival as
  // landing after midnight, which looked EARLIER than the window's end and
  // wrongly left the window un-narrowed).
  const base = dayWindowForPace('balanced')
  assert.deepEqual(windowForFlightDay(base, 1, 3, { arrivalTime: '21:00' }), { start: base.start, end: base.start })
  assert.deepEqual(windowForFlightDay(base, 1, 3, { arrivalTime: '23:00' }), { start: base.start, end: base.start })
  assert.deepEqual(windowForFlightDay(base, 3, 3, { departureTime: '09:00' }), { start: base.start, end: base.start })
  assert.deepEqual(windowForFlightDay(base, 3, 3, { departureTime: '01:00' }), { start: base.start, end: base.start })
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
  const { trip, places } = generateTrip(input, [], aiPlaces)

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
  const { trip, places } = generateTrip(input, [], aiPlaces)

  const order = trip.columns[0]!.placeIds.map((id) => places.find((p) => p.id === id)!.name)
  // Morning bucket goes first (evening last) and, within it, the greedy
  // nearest-neighbor chain visits the near point before the far one even
  // though the far one appeared earlier in the input array. All 4 fit
  // comfortably within balanced's 11-hour window at ~1.5h/1h each.
  assert.deepEqual(order, ['Morning1', 'Morning2-near', 'Morning3-far', 'Evening1'])
})

test('generateTrip carries the suggestion\'s Google placeId through to the resulting Place', () => {
  const aiPlaces: PlaceSuggestion[] = [
    { day: 1, name: 'A1', category: 'attraction', description: 'd', placeId: 'google-1' },
    { day: 1, name: 'A2', category: 'attraction', description: 'd' }, // no-Google-key fallback path
  ]
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' })
  const { places } = generateTrip(input, [], aiPlaces)

  assert.equal(places.find((p) => p.name === 'A1')!.placeId, 'google-1')
  assert.equal(places.find((p) => p.name === 'A2')!.placeId, undefined)
})

test('generateTrip resolves each place\'s estimatedTime from its AI-suggested duration', () => {
  const aiPlaces: PlaceSuggestion[] = [
    { day: 1, name: 'Landmark', category: 'attraction', description: 'd', estimatedTimeHours: 1.2 },
    { day: 1, name: 'NoEstimate', category: 'food', description: 'd' },
  ]
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' })
  const { places } = generateTrip(input, [], aiPlaces)

  // 1.2 is clamped/rounded up to a clean 1.5, not stored as-is.
  assert.equal(places.find((p) => p.name === 'Landmark')!.estimatedTime, 1.5)
  // No AI estimate -> falls back to the food category default.
  assert.equal(places.find((p) => p.name === 'NoEstimate')!.estimatedTime, 1)
})

test('generateTrip trims a day to its duration budget once accepted places would overshoot the window', () => {
  const aiPlaces: PlaceSuggestion[] = [
    { day: 1, name: 'A1', category: 'attraction', description: 'd' },
    { day: 1, name: 'A2', category: 'attraction', description: 'd' },
    { day: 1, name: 'A3', category: 'attraction', description: 'd' },
  ]
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' })
  // Each attraction defaults to 1.5h + a 25min inter-stop buffer. Starting at
  // 08:00: A1 ends 09:30 (+buffer 09:55), A2 would end 11:25 (fits by
  // 11:30), A3 would end 13:20 (doesn't fit) -> exactly 2 accepted.
  const { trip, places } = generateTrip(input, [], aiPlaces, { start: '08:00', end: '11:30' })

  assert.equal(trip.columns[0]!.placeIds.length, 2)
  assert.equal(places.length, 2)
})

test('generateTrip always keeps at least one place even if it alone overshoots the window', () => {
  const aiPlaces: PlaceSuggestion[] = [{ day: 1, name: 'BigMuseum', category: 'attraction', description: 'd', estimatedTimeHours: 5 }]
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' })
  const { trip, places } = generateTrip(input, [], aiPlaces, { start: '08:00', end: '09:00' })

  assert.equal(trip.columns[0]!.placeIds.length, 1)
  assert.equal(places[0]!.estimatedTime, 5)
})

test('generateTrip falls back to the pace-derived day window when no override is given', () => {
  const aiPlaces: PlaceSuggestion[] = Array.from({ length: 5 }, (_, i) => ({
    day: 1,
    name: `Place${i}`,
    category: 'attraction' as const,
    description: 'd',
  }))
  // travelStyle: [] -> paceForTravelStyles -> 'balanced' -> 08:00-19:00 window
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01', travelStyle: [] })
  const { trip } = generateTrip(input, [], aiPlaces)

  assert.equal(trip.pace, 'balanced')
  // All 5 fit comfortably within balanced's 11-hour window at attraction's
  // default 1.5h each (5*90 + 4*25 = 550min of 660min available) — the
  // day-window budget doesn't force an arbitrary count cap the way the old
  // flat placesPerDay(4) used to.
  assert.equal(trip.columns[0]!.placeIds.length, 5)
})

test('generateTrip prepends a manually-timed "抵達機場" card to day 1 and appends "前往機場" to the last day, narrowing their AI-suggestion windows', () => {
  const aiPlaces: PlaceSuggestion[] = Array.from({ length: 4 }, (_, i) => ({
    day: 1,
    name: `Day1-${i}`,
    category: 'attraction' as const,
    description: 'd',
  })).concat(
    Array.from({ length: 4 }, (_, i) => ({
      day: 2,
      name: `Day2-${i}`,
      category: 'attraction' as const,
      description: 'd',
    })),
  )
  const input = baseInput({
    startDate: '2024-03-01',
    endDate: '2024-03-02',
    arrivalTime: '15:00',
    departureTime: '20:00',
  })
  const { trip, places } = generateTrip(input, [], aiPlaces)
  const placeById = new Map(places.map((p) => [p.id, p]))

  const day1 = trip.columns[0]!
  const day2 = trip.columns[1]!

  const arrivalCard = placeById.get(day1.placeIds[0]!)!
  assert.equal(arrivalCard.name, '抵達機場')
  assert.equal(arrivalCard.category, 'transport')
  assert.equal(arrivalCard.arrivalTime, '15:00')
  assert.equal(arrivalCard.estimatedTime, 1.5)
  assert.equal(arrivalCard.lat, 0)
  assert.equal(arrivalCard.skipGeocode, true)
  // Day 1's window is buffered to start at 16:30 (arrival + 90min), leaving
  // only ~2.5 hours of balanced's 08:00-19:00 window — enough for one
  // 1.5-hour attraction, not all 4 offered.
  assert.equal(day1.placeIds.length - 1, 1)

  const departureCard = placeById.get(day2.placeIds[day2.placeIds.length - 1]!)!
  assert.equal(departureCard.name, '前往機場')
  assert.equal(departureCard.category, 'transport')
  // Buffered: 90 minutes before the raw 20:00 departure.
  assert.equal(departureCard.arrivalTime, '18:30')
  // Day 2's buffered window (08:00-18:30) still comfortably fits all 4
  // 1.5-hour attractions plus their inter-stop buffers.
  assert.equal(day2.placeIds.length - 1, 4)
})

test('generateTrip adds no flight card when no flight info is given', () => {
  const input = baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' })
  const { trip, places } = generateTrip(input, [], [])
  assert.deepEqual(trip.columns[0]!.placeIds, [])
  assert.equal(places.length, 0)
})

test('generateTrip on a one-day trip with both arrival and departure sandwiches the AI places between both flight cards', () => {
  const aiPlaces: PlaceSuggestion[] = [{ day: 1, name: 'Lunch', category: 'food', description: 'd' }]
  const input = baseInput({ arrivalTime: '10:00', departureTime: '18:00' })
  const { trip, places } = generateTrip(input, [], aiPlaces)
  const names = trip.columns[0]!.placeIds.map((id) => places.find((p) => p.id === id)!.name)
  assert.deepEqual(names, ['抵達機場', 'Lunch', '前往機場'])
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

test('generateTrip leaves cities and every column.cityId undefined when input.cities is absent — the untouched single-destination path', () => {
  const input = baseInput({ destination: '京都，日本', startDate: '2024-03-01', endDate: '2024-03-03' })
  const { trip } = generateTrip(input, [], [])

  assert.equal(trip.cities, undefined)
  assert.equal(trip.destination, '京都，日本')
  assert.ok(trip.columns.every((column) => column.cityId === undefined))
})

test('generateTrip assigns each column a cityId from input.cities\' cumulative day counts', () => {
  const input = baseInput({
    destination: '阿姆斯特丹，荷蘭',
    startDate: '2024-03-01',
    endDate: '2024-03-05',
    cities: [
      { destination: '阿姆斯特丹，荷蘭', days: 3 },
      { destination: '布魯塞爾，比利時', days: 2 },
    ],
  })
  const { trip } = generateTrip(input, [], [])

  assert.equal(trip.cities?.length, 2)
  const [amsterdam, brussels] = trip.cities!
  assert.equal(amsterdam!.destination, '阿姆斯特丹，荷蘭')
  assert.equal(brussels!.destination, '布魯塞爾，比利時')

  assert.equal(trip.columns.length, 5)
  assert.deepEqual(
    trip.columns.map((column) => column.cityId),
    [amsterdam!.id, amsterdam!.id, amsterdam!.id, brussels!.id, brussels!.id],
  )
})

test('generateTrip joins every city name into trip.destination once there is more than one, but keeps the plain single-city string for just one', () => {
  const multiCity = generateTrip(
    baseInput({
      destination: '阿姆斯特丹，荷蘭',
      startDate: '2024-03-01',
      endDate: '2024-03-02',
      cities: [
        { destination: '阿姆斯特丹，荷蘭', days: 1 },
        { destination: '布魯塞爾，比利時', days: 1 },
      ],
    }),
    [],
    [],
  ).trip
  assert.equal(multiCity.destination, '阿姆斯特丹・布魯塞爾')
  assert.equal(multiCity.title, '阿姆斯特丹・布魯塞爾之旅')

  // A single-entry cities array collapses to the same untouched path as it
  // being absent entirely — a single entry IS a single destination, so
  // trip.cities and every column.cityId must stay undefined here too, not
  // just when `cities` is omitted outright.
  const singleCityViaArray = generateTrip(
    baseInput({
      destination: '阿姆斯特丹，荷蘭',
      startDate: '2024-03-01',
      endDate: '2024-03-01',
      cities: [{ destination: '阿姆斯特丹，荷蘭', days: 1 }],
    }),
    [],
    [],
  ).trip
  assert.equal(singleCityViaArray.destination, '阿姆斯特丹，荷蘭')
  assert.equal(singleCityViaArray.cities, undefined)
  assert.ok(singleCityViaArray.columns.every((column) => column.cityId === undefined))
})
