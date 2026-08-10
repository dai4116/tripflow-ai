// aiTripClient.ts is a browser client (window.setTimeout, fetch) — shim
// `window` to the Node global object so it runs under plain `node --test`
// with no jsdom. `fetch`/AbortController are already real Node globals.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
}

import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import type { CitySegment } from './generateTrip.ts'
import type { CreateTripInput } from '../types/index.ts'
import { dedupeByPlaceId, daysNeedingBackfill, fetchAiPlaces, findExistingAnchor, preferencesForSegment } from './aiTripClient.ts'
import type { PlaceSuggestion } from './generateTrip.ts'

// A generic non-zero-length placeholder window, for tests that don't care
// what the actual target place count comes out to.
const PLACEHOLDER_WINDOW = { start: '08:00', end: '09:00' }
const ZERO_WINDOW = { start: '08:00', end: '08:00' }
// targetCountForWindow(180 minutes) rounds to 2 — used by the
// daysNeedingBackfill tests below, which test its count-comparison logic
// directly rather than the window -> count derivation (covered in
// generateTrip.test.ts).
const TARGET_2_WINDOW = { start: '08:00', end: '11:00' }

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

test('dedupeByPlaceId keeps the first occurrence of a placeId and keeps every place with no placeId', () => {
  const places: PlaceSuggestion[] = [
    { day: 1, name: 'A', category: 'attraction', description: 'd', placeId: 'g1' },
    { day: 2, name: 'A-dup', category: 'attraction', description: 'd', placeId: 'g1' },
    { day: 1, name: 'NoId1', category: 'attraction', description: 'd' },
    { day: 2, name: 'NoId2', category: 'attraction', description: 'd' },
  ]
  assert.deepEqual(dedupeByPlaceId(places).map((p) => p.name), ['A', 'NoId1', 'NoId2'])
})

test('daysNeedingBackfill flags every day under quota and ignores places with no day tag', () => {
  const places: PlaceSuggestion[] = [
    { day: 1, name: 'A1', category: 'attraction', description: 'd' },
    { day: 1, name: 'A2', category: 'attraction', description: 'd' },
    { day: 2, name: 'B1', category: 'attraction', description: 'd' },
    { name: 'Untagged', category: 'attraction', description: 'd' },
  ]
  assert.deepEqual(daysNeedingBackfill(places, 3, () => TARGET_2_WINDOW), [2, 3])
})

test('daysNeedingBackfill never flags a day whose window (and therefore target) is zero-length', () => {
  const places: PlaceSuggestion[] = [{ day: 1, name: 'A1', category: 'attraction', description: 'd' }]
  assert.deepEqual(
    daysNeedingBackfill(places, 2, (day) => (day === 2 ? ZERO_WINDOW : TARGET_2_WINDOW)),
    [1],
  )
})

test('findExistingAnchor returns the first coordinate-bearing place for a day, or null if there is none', () => {
  const places: PlaceSuggestion[] = [
    { day: 1, name: 'NoCoords', category: 'attraction', description: 'd' },
    { day: 1, name: 'HasCoords', category: 'attraction', description: 'd', lat: 1, lng: 2 },
    { day: 2, name: 'Day2Coords', category: 'attraction', description: 'd', lat: 9, lng: 9 },
  ]
  assert.deepEqual(findExistingAnchor(places, 1), { lat: 1, lng: 2 })
  assert.equal(findExistingAnchor(places, 3), null)
})

test('preferencesForSegment returns the input unchanged for a single-segment (single-destination) trip', () => {
  const segments: CitySegment[] = [{ destination: '京都，日本', startDay: 1, endDay: 5 }]
  const preferences = ['必吃美食', '逛街購物', '自然秘境']
  assert.equal(preferencesForSegment(preferences, segments[0]!, segments), preferences)
})

test('preferencesForSegment distributes preferences across segments proportional to each segment\'s day share', () => {
  const segments: CitySegment[] = [
    { destination: 'A', startDay: 1, endDay: 3 },
    { destination: 'B', startDay: 4, endDay: 5 },
  ]
  const preferences = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
  const forA = preferencesForSegment(preferences, segments[0]!, segments)
  const forB = preferencesForSegment(preferences, segments[1]!, segments)
  // Every preference goes to exactly one segment, none dropped or duplicated.
  assert.deepEqual([...forA!, ...forB!].sort(), [...preferences].sort())
  // The 3-day segment gets a larger (or equal) share than the 2-day one.
  assert.ok(forA!.length >= forB!.length, `expected A's share (${forA!.length}) >= B's (${forB!.length})`)
  assert.ok(forB!.length > 0, 'expected B to get at least one preference, not be starved entirely')
})

// Shared fetch dispatcher for the fetchAiPlaces integration tests below —
// routes by URL, and hands the parsed request body to whichever handler the
// test supplies for that endpoint.
function mockFetch(t: TestContext, handlers: {
  zones?: (body: unknown) => Response
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  day?: (body: any) => Response
}) {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(init.body as string) : {}
    if (url.includes('plan-trip-zones')) {
      return handlers.zones ? handlers.zones(body) : new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    }
    if (url.includes('generate-trip-day')) {
      return handlers.day!(body)
    }
    throw new Error(`unexpected fetch to ${url}`)
  })
}

function dayPlace(day: number, placeId: string, overrides: Partial<PlaceSuggestion> = {}): PlaceSuggestion {
  return { day, name: placeId, category: 'attraction', description: 'd', placeId, ...overrides }
}

test('fetchAiPlaces still fetches every day when plan-trip-zones fails', async (t) => {
  mockFetch(t, {
    zones: () => new Response('', { status: 500 }),
    day: (body) => new Response(JSON.stringify({ places: [dayPlace(body.day, `p${body.day}`)] }), { status: 200 }),
  })
  const result = await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02' }), 2, PLACEHOLDER_WINDOW)
  assert.deepEqual(
    result?.map((p) => p.placeId).sort(),
    ['p1', 'p2'],
  )
})

test('fetchAiPlaces treats a non-2xx day response as empty and backfills it in a second round', async (t) => {
  let day2Attempts = 0
  mockFetch(t, {
    day: (body) => {
      if (body.day === 1) return new Response(JSON.stringify({ places: [dayPlace(1, 'p1')] }), { status: 200 })
      day2Attempts++
      if (day2Attempts === 1) return new Response('', { status: 500 })
      return new Response(JSON.stringify({ places: [dayPlace(2, 'p2')] }), { status: 200 })
    },
  })
  const result = await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02' }), 2, PLACEHOLDER_WINDOW)
  assert.equal(day2Attempts, 2)
  assert.deepEqual(
    result?.map((p) => p.placeId).sort(),
    ['p1', 'p2'],
  )
})

test('fetchAiPlaces dedupes the same real place suggested for two different days, then backfills the day that lost it', async (t) => {
  let day2Attempts = 0
  mockFetch(t, {
    day: (body) => {
      if (body.day === 1) return new Response(JSON.stringify({ places: [dayPlace(1, 'dup1')] }), { status: 200 })
      day2Attempts++
      // Day 2's first pass "coincidentally" suggests the same real place as
      // day 1 — cross-day dedup should drop it, leaving day 2 short, and its
      // backfill request (the second call for day 2) supplies a distinct place.
      if (day2Attempts === 1) return new Response(JSON.stringify({ places: [dayPlace(2, 'dup1')] }), { status: 200 })
      return new Response(JSON.stringify({ places: [dayPlace(2, 'day2-real')] }), { status: 200 })
    },
  })
  const result = await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02' }), 2, PLACEHOLDER_WINDOW)
  const placeIds = result?.map((p) => p.placeId).sort()
  assert.deepEqual(placeIds, ['day2-real', 'dup1'])
})

test('fetchAiPlaces returns undefined when every day comes back empty even after backfill', async (t) => {
  mockFetch(t, { day: () => new Response('', { status: 500 }) })
  const result = await fetchAiPlaces(baseInput(), 1, PLACEHOLDER_WINDOW)
  assert.equal(result, undefined)
})

test('fetchAiPlaces narrows day 1\'s window when arrivalTime shortens it, and passes arrivalTime through only for that day', async (t) => {
  const dayBodies: Array<{ day: number; targetPlaceCount: number; windowStart: string; windowEnd: string; arrivalTime?: string; departureTime?: string }> = []
  mockFetch(t, {
    day: (body) => {
      dayBodies.push(body)
      return new Response(JSON.stringify({ places: [dayPlace(body.day, `p${body.day}`)] }), { status: 200 })
    },
  })
  await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02', arrivalTime: '14:00' }), 2, { start: '08:00', end: '21:00' })
  const day1 = dayBodies.find((body) => body.day === 1)!
  const day2 = dayBodies.find((body) => body.day === 2)!
  // Arriving 14:00 -> buffered start 15:30, narrowing day 1's window and
  // therefore its derived targetPlaceCount below day 2's untouched one.
  assert.equal(day1.windowStart, '15:30')
  assert.equal(day1.windowEnd, '21:00')
  assert.ok(
    day1.targetPlaceCount > 0 && day1.targetPlaceCount < day2.targetPlaceCount,
    `expected day 1's targetPlaceCount to be thinned below day 2's, got ${day1.targetPlaceCount} vs ${day2.targetPlaceCount}`,
  )
  assert.equal(day1.arrivalTime, '14:00')
  assert.equal(day2.windowStart, '08:00')
  assert.equal(day2.windowEnd, '21:00')
  assert.equal(day2.arrivalTime, undefined)
})

test('fetchAiPlaces skips a day entirely (no request at all) when a flight leaves it no usable window', async (t) => {
  const requestedDays: number[] = []
  mockFetch(t, {
    day: (body) => {
      requestedDays.push(body.day)
      return new Response(JSON.stringify({ places: [dayPlace(body.day, `p${body.day}`)] }), { status: 200 })
    },
  })
  // A one-day trip arriving at 20:00: buffered start (21:30) falls after the
  // 08:00-21:00 base window entirely, so day 1's window collapses to zero
  // length and gets skipped.
  const result = await fetchAiPlaces(baseInput({ arrivalTime: '20:00' }), 1, { start: '08:00', end: '21:00' })
  assert.deepEqual(requestedDays, [])
  assert.equal(result, undefined)
})

test('fetchAiPlaces sends a short day\'s existing accepted place as existingAnchor on its backfill request', async (t) => {
  const backfillBodies: Array<{ existingAnchor: unknown }> = []
  mockFetch(t, {
    day: (body) => {
      if (!body.existingAnchor) {
        // First pass: only 1 of the 2 needed places, with real coordinates.
        return new Response(
          JSON.stringify({ places: [dayPlace(1, 'first', { lat: 25.03, lng: 121.56 })] }),
          { status: 200 },
        )
      }
      backfillBodies.push(body)
      return new Response(JSON.stringify({ places: [dayPlace(1, 'second')] }), { status: 200 })
    },
  })
  await fetchAiPlaces(baseInput(), 1, TARGET_2_WINDOW)
  assert.equal(backfillBodies.length, 1)
  assert.deepEqual(backfillBodies[0]!.existingAnchor, { lat: 25.03, lng: 121.56 })
})

test('fetchAiPlaces fans a multi-city trip out into one independent, correctly-scoped request per (city, its own relative day)', async (t) => {
  type ZoneBody = { destination: string; totalDays: number }
  type DayBody = { destination: string; day: number; totalDays: number; zones: { zone: string }[]; cityCenter: unknown }
  const zoneBodies: ZoneBody[] = []
  const dayBodies: DayBody[] = []
  // Wide enough that windowForTransitDay's 90-minute segment-boundary
  // narrowing (see generateTrip.ts) never collapses a transition day's
  // window to zero — this test is about request routing, not that.
  const WIDE_WINDOW = { start: '08:00', end: '20:00' }

  mockFetch(t, {
    zones: (body) => {
      const b = body as ZoneBody
      zoneBodies.push(b)
      const label = b.destination === '阿姆斯特丹，荷蘭' ? 'AmsZone' : 'BruZone'
      return new Response(
        JSON.stringify({
          zones: Array.from({ length: b.totalDays }, (_, i) => ({ day: i + 1, zone: `${label}${i + 1}`, focus: 'f', assignedPreferences: [] })),
          cityCenter: b.destination === '阿姆斯特丹，荷蘭' ? { lat: 52.37, lng: 4.9 } : { lat: 50.85, lng: 4.35 },
        }),
        { status: 200 },
      )
    },
    day: (body) => {
      dayBodies.push(body as DayBody)
      // 8 places (>= any real targetPlaceCount, capped at 7 — see
      // generateTrip.ts's own "never exceeds the hard max" test) so no day
      // ever comes up short and triggers a second (backfill) round — this
      // test is about first-pass request routing, not backfill.
      const places = Array.from({ length: 8 }, (_, i) => dayPlace(body.day, `${body.destination}-${body.day}-${i}`))
      return new Response(JSON.stringify({ places }), { status: 200 })
    },
  })

  const input = baseInput({
    destination: '阿姆斯特丹，荷蘭',
    cities: [
      { destination: '阿姆斯特丹，荷蘭', days: 3 },
      { destination: '布魯塞爾，比利時', days: 2 },
    ],
  })
  const result = await fetchAiPlaces(input, 5, WIDE_WINDOW)

  // Zone planning ran once per city, each scoped to ONLY that city's own day
  // count (3, 2) — not the whole trip's 5.
  assert.deepEqual(
    zoneBodies.map((b) => `${b.destination}:${b.totalDays}`).sort(),
    ['阿姆斯特丹，荷蘭:3', '布魯塞爾，比利時:2'].sort(),
  )

  const amsBodies = dayBodies.filter((b) => b.destination === '阿姆斯特丹，荷蘭').sort((a, b) => a.day - b.day)
  const bruBodies = dayBodies.filter((b) => b.destination === '布魯塞爾，比利時').sort((a, b) => a.day - b.day)
  assert.equal(dayBodies.length, 5)
  assert.equal(amsBodies.length, 3)
  assert.equal(bruBodies.length, 2)

  // day/totalDays sent to the server are RELATIVE to each city, not the
  // trip's absolute day numbers — Amsterdam's 3 days are tagged 1/2/3 of 3,
  // Brussels' 2 days are tagged 1/2 of 2 (not, say, 4/5 of 5).
  assert.deepEqual(amsBodies.map((b) => [b.day, b.totalDays]), [
    [1, 3],
    [2, 3],
    [3, 3],
  ])
  assert.deepEqual(bruBodies.map((b) => [b.day, b.totalDays]), [
    [1, 2],
    [2, 2],
  ])

  // Each city's requests only ever see its OWN zone hints — this is the bug
  // per-segment planning exists to prevent: two cities' zone hints share the
  // same day numbering (both start at 1), so a shared/merged zones array
  // would let Brussels' day 1 pick up Amsterdam's day-1 theme.
  for (const b of amsBodies) assert.ok(b.zones.every((z) => z.zone.startsWith('AmsZone')))
  for (const b of bruBodies) assert.ok(b.zones.every((z) => z.zone.startsWith('BruZone')))

  // Each city's requests get THAT city's own geocoded center, not a shared
  // one for the whole trip.
  assert.deepEqual(amsBodies[0]!.cityCenter, { lat: 52.37, lng: 4.9 })
  assert.deepEqual(bruBodies[0]!.cityCenter, { lat: 50.85, lng: 4.35 })

  // The returned places are re-tagged back to ABSOLUTE trip day numbers
  // (1..5) before merging — the relative numbering the server actually saw
  // never leaks into the result.
  assert.deepEqual([...new Set(result?.map((p) => p.day))].sort((a, b) => (a ?? 0) - (b ?? 0)), [1, 2, 3, 4, 5])
  // Day 4/5 (Brussels' relative days 1/2) resolved from real Brussels
  // requests, not misrouted to Amsterdam or some other segment.
  assert.ok(result?.filter((p) => p.day === 4).every((p) => p.placeId?.startsWith('布魯塞爾，比利時-1-')))
  assert.ok(result?.filter((p) => p.day === 5).every((p) => p.placeId?.startsWith('布魯塞爾，比利時-2-')))
})
