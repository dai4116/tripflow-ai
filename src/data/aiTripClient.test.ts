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
import { dedupeByPlaceId, daysNeedingBackfill, fetchAiPlaces, findExistingAnchor, preferencesForGroup } from './aiTripClient.ts'
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

test('preferencesForGroup returns the input unchanged for a single-group (single-destination) trip', () => {
  const group: CitySegment[] = [{ destination: '京都，日本', startDay: 1, endDay: 5 }]
  const preferences = ['必吃美食', '逛街購物', '自然秘境']
  assert.equal(preferencesForGroup(preferences, group, [group]), preferences)
})

test('preferencesForGroup distributes preferences across groups proportional to each group\'s day share', () => {
  const groupA: CitySegment[] = [{ destination: 'A', startDay: 1, endDay: 3 }]
  const groupB: CitySegment[] = [{ destination: 'B', startDay: 4, endDay: 5 }]
  const allGroups = [groupA, groupB]
  const preferences = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
  const forA = preferencesForGroup(preferences, groupA, allGroups)
  const forB = preferencesForGroup(preferences, groupB, allGroups)
  // Every preference goes to exactly one group, none dropped or duplicated.
  assert.deepEqual([...forA!, ...forB!].sort(), [...preferences].sort())
  // The 3-day group gets a larger (or equal) share than the 2-day one.
  assert.ok(forA!.length >= forB!.length, `expected A's share (${forA!.length}) >= B's (${forB!.length})`)
  assert.ok(forB!.length > 0, 'expected B to get at least one preference, not be starved entirely')
})

test('preferencesForGroup treats a repeated city\'s multiple segments as ONE group, sized by their combined day count', () => {
  // Tokyo visited 3 days, then (after a 2-day Kyoto detour) 2 more days —
  // Tokyo's allocation should be sized as a 5-day city, not as two separate
  // 3-day/2-day allocations that would each individually lose to Kyoto's
  // contiguous 2 days.
  const tokyoGroup: CitySegment[] = [
    { destination: '東京，日本', startDay: 1, endDay: 3 },
    { destination: '東京，日本', startDay: 6, endDay: 7 },
  ]
  const kyotoGroup: CitySegment[] = [{ destination: '京都，日本', startDay: 4, endDay: 5 }]
  const allGroups = [tokyoGroup, kyotoGroup]
  const preferences = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']

  const forTokyo = preferencesForGroup(preferences, tokyoGroup, allGroups)
  const forKyoto = preferencesForGroup(preferences, kyotoGroup, allGroups)
  assert.deepEqual([...forTokyo!, ...forKyoto!].sort(), [...preferences].sort())
  // Tokyo's combined 5 of 7 total days should clearly outweigh Kyoto's 2.
  assert.ok(
    forTokyo!.length > forKyoto!.length,
    `expected Tokyo's 5-day combined share (${forTokyo!.length}) > Kyoto's 2-day share (${forKyoto!.length})`,
  )
})

test('preferencesForGroup guarantees every group at least 1 preference once there are enough to go around, even a tiny group next to a huge one', () => {
  // Direct regression case for the bug plain largest-remainder apportionment
  // had: a 1-day group's ideal share (2 * 1/100 = 0.02) floors to 0, and it
  // still loses the single leftover seat to the 99-day group's larger
  // fractional remainder — so with exactly 2 preferences for 2 groups, the
  // 1-day group got zero even though preferences.length >= allGroups.length.
  const tinyGroup: CitySegment[] = [{ destination: 'Tiny', startDay: 1, endDay: 1 }]
  const hugeGroup: CitySegment[] = [{ destination: 'Huge', startDay: 2, endDay: 100 }]
  const allGroups = [tinyGroup, hugeGroup]
  const preferences = ['p1', 'p2']

  const forTiny = preferencesForGroup(preferences, tinyGroup, allGroups)
  const forHuge = preferencesForGroup(preferences, hugeGroup, allGroups)
  assert.deepEqual([...forTiny!, ...forHuge!].sort(), [...preferences].sort())
  assert.equal(forTiny!.length, 1, 'the 1-day group must not be starved to zero when there are enough preferences for both groups')
  assert.equal(forHuge!.length, 1)
})

test('preferencesForGroup still lets a group legitimately get zero when there are not enough preferences to guarantee one each', () => {
  const groupA: CitySegment[] = [{ destination: 'A', startDay: 1, endDay: 1 }]
  const groupB: CitySegment[] = [{ destination: 'B', startDay: 2, endDay: 99 }]
  const allGroups = [groupA, groupB]
  const preferences = ['p1']

  const forA = preferencesForGroup(preferences, groupA, allGroups)
  const forB = preferencesForGroup(preferences, groupB, allGroups)
  assert.deepEqual([...forA!, ...forB!].sort(), preferences)
  assert.equal(forA!.length, 0)
  assert.equal(forB!.length, 1)
})

test('preferencesForGroup matches a group by sameCity (destinationPlaceId OR text), not object identity or a stale key', () => {
  // A structurally-identical-but-freshly-constructed group (same city, same
  // shape, but not the literal array reference held in allGroups) must still
  // resolve correctly — matching by sameCity rather than reference equality
  // or a precomputed key is what makes this work.
  const groupA: CitySegment[] = [{ destination: 'A', destinationPlaceId: 'place-a', startDay: 1, endDay: 3 }]
  const groupB: CitySegment[] = [{ destination: 'B', destinationPlaceId: 'place-b', startDay: 4, endDay: 5 }]
  const allGroups = [groupA, groupB]
  const preferences = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']

  const reconstructedGroupA: CitySegment[] = [{ destination: 'A', destinationPlaceId: 'place-a', startDay: 1, endDay: 3 }]
  const forA = preferencesForGroup(preferences, reconstructedGroupA, allGroups)
  assert.ok(forA && forA.length > 0, 'expected the reconstructed-but-sameCity group to still resolve to a real allocation, not fall through to []')
})

test('preferencesForGroup merges a repeated city\'s visits into one group even when only ONE occurrence carries a destinationPlaceId', () => {
  // sameCity is an OR-match: placeId when BOTH sides have one, else a text
  // fallback — covering the asymmetric case where, say, the user picked a
  // Google Places suggestion for Tokyo's first visit but typed the second
  // visit's destination as free text (no placeId). Both must still be
  // recognized as the SAME group, or Tokyo's zone-planning silently splits
  // back into two uncoordinated allocations — the exact bug this whole
  // unified-group design exists to prevent.
  const tokyoGroup: CitySegment[] = [
    { destination: '東京，日本', destinationPlaceId: 'place-tokyo', startDay: 1, endDay: 3 },
    { destination: '東京，日本', startDay: 6, endDay: 7 }, // no placeId — e.g. typed as free text
  ]
  const kyotoGroup: CitySegment[] = [{ destination: '京都，日本', destinationPlaceId: 'place-kyoto', startDay: 4, endDay: 5 }]
  const allGroups = [tokyoGroup, kyotoGroup]
  const preferences = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7']

  const forTokyo = preferencesForGroup(preferences, tokyoGroup, allGroups)
  const forKyoto = preferencesForGroup(preferences, kyotoGroup, allGroups)
  assert.deepEqual([...forTokyo!, ...forKyoto!].sort(), [...preferences].sort())
  assert.ok(
    forTokyo!.length > forKyoto!.length,
    `expected Tokyo's 5-day combined share (${forTokyo!.length}) > Kyoto's 2-day share (${forKyoto!.length})`,
  )
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

test('fetchAiPlaces does NOT send arrivalDay/departureDay to plan-trip-zones when the trip has no flight times at all', async (t) => {
  // Regression test: arrivalDay/departureDay used to be derived purely from
  // whether a city group owns the trip's absolute first/last day, with no
  // check that input.arrivalTime/departureTime were actually set — every
  // ordinary trip's first/last group satisfies that day-ownership check, so
  // arrivalDay ended up sent with no matching time, and buildZonePlanPrompt
  // interpolated the literal string "undefined" into the Chinese prompt for
  // the vast majority of trips that never set a flight time.
  let zonesBody: { arrivalDay?: number; arrivalTime?: string; departureDay?: number; departureTime?: string } | undefined
  mockFetch(t, {
    zones: (body) => {
      zonesBody = body as typeof zonesBody
      return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    },
    day: (body) => new Response(JSON.stringify({ places: [dayPlace(body.day, `p${body.day}`)] }), { status: 200 }),
  })
  await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02' }), 2, PLACEHOLDER_WINDOW)
  assert.equal(zonesBody?.arrivalDay, undefined)
  assert.equal(zonesBody?.arrivalTime, undefined)
  assert.equal(zonesBody?.departureDay, undefined)
  assert.equal(zonesBody?.departureTime, undefined)
})

test('fetchAiPlaces sends arrivalDay=1 and the matching arrivalTime to plan-trip-zones when arrivalTime is set', async (t) => {
  let zonesBody: { arrivalDay?: number; arrivalTime?: string } | undefined
  mockFetch(t, {
    zones: (body) => {
      zonesBody = body as typeof zonesBody
      return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    },
    day: (body) => new Response(JSON.stringify({ places: [dayPlace(body.day, `p${body.day}`)] }), { status: 200 }),
  })
  await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02', arrivalTime: '14:00' }), 2, PLACEHOLDER_WINDOW)
  assert.equal(zonesBody?.arrivalDay, 1)
  assert.equal(zonesBody?.arrivalTime, '14:00')
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

test('fetchAiPlaces plans a repeated city as ONE unified multi-day visit — a single zone-planning call covering its combined day count, not one call per visit', async (t) => {
  type ZoneBody = { destination: string; totalDays: number }
  type DayBody = { destination: string; day: number; totalDays: number; zones: { day: number; zone: string }[] }
  const zoneBodies: ZoneBody[] = []
  const dayBodies: DayBody[] = []
  const WIDE_WINDOW = { start: '08:00', end: '20:00' }

  mockFetch(t, {
    zones: (body) => {
      const b = body as ZoneBody
      zoneBodies.push(b)
      if (b.destination === '東京，日本') {
        // A distinct theme per relative day, 1..totalDays — if Tokyo is
        // correctly planned as ONE 5-day visit, this returns 5 entries in
        // a single call; if it were wrongly split back into per-visit
        // calls, this same handler would instead get invoked twice with
        // totalDays 3 and 2.
        return new Response(
          JSON.stringify({
            zones: Array.from({ length: b.totalDays }, (_, i) => ({ day: i + 1, zone: `TokyoZone${i + 1}`, focus: 'f', assignedPreferences: [] })),
            cityCenter: { lat: 35.68, lng: 139.69 },
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ zones: [{ day: 1, zone: 'KyotoZone', focus: 'f', assignedPreferences: [] }, { day: 2, zone: 'KyotoZone2', focus: 'f', assignedPreferences: [] }], cityCenter: null }), { status: 200 })
    },
    day: (body) => {
      dayBodies.push(body as DayBody)
      const places = Array.from({ length: 8 }, (_, i) => dayPlace(body.day, `${body.destination}-${body.day}-${i}`))
      return new Response(JSON.stringify({ places }), { status: 200 })
    },
  })

  // Tokyo 3 days, then Kyoto 2 days, then back to Tokyo for 2 more days.
  const input = baseInput({
    destination: '東京，日本',
    cities: [
      { destination: '東京，日本', days: 3 },
      { destination: '京都，日本', days: 2 },
      { destination: '東京，日本', days: 2 },
    ],
  })
  const result = await fetchAiPlaces(input, 7, WIDE_WINDOW)

  // Exactly ONE zone-planning call for Tokyo (not two, one per visit),
  // covering its combined 5 days (3 + 2) — Kyoto gets its own separate call.
  const tokyoZoneBodies = zoneBodies.filter((b) => b.destination === '東京，日本')
  assert.equal(tokyoZoneBodies.length, 1)
  assert.equal(tokyoZoneBodies[0]!.totalDays, 5)
  assert.equal(zoneBodies.filter((b) => b.destination === '京都，日本').length, 1)

  const tokyoDayBodies = dayBodies.filter((b) => b.destination === '東京，日本').sort((a, b) => a.day - b.day)
  assert.equal(tokyoDayBodies.length, 5)
  // day/totalDays sent to the server are relative to the whole 5-day Tokyo
  // GROUP, continuing across the Kyoto interruption — absolute days 1/2/3
  // (first visit) map to group-relative 1/2/3, and absolute days 6/7
  // (second visit) map to group-relative 4/5, all against totalDays=5.
  assert.deepEqual(tokyoDayBodies.map((b) => [b.day, b.totalDays]), [
    [1, 5],
    [2, 5],
    [3, 5],
    [4, 5],
    [5, 5],
  ])
  // Every Tokyo day-request sees the SAME shared 5-entry zones array (proof
  // the second visit isn't independently re-planning) — day 4/5 aren't
  // missing or truncated relative to day 1-3's.
  for (const b of tokyoDayBodies) assert.equal(b.zones.length, 5)

  // The returned places are re-tagged back to ABSOLUTE trip days — the
  // second Tokyo visit's group-relative days 4/5 (what the mock's placeId
  // is built from, since that's what the server actually saw) resolve to
  // absolute days 6/7 in the merged result, not misattributed to Kyoto's
  // own absolute days 4/5.
  assert.ok(result?.filter((p) => p.day === 6).every((p) => p.placeId?.startsWith('東京，日本-4-')))
  assert.ok(result?.filter((p) => p.day === 7).every((p) => p.placeId?.startsWith('東京，日本-5-')))
  // Absolute days 4/5 belong entirely to Kyoto, not Tokyo's group-relative
  // days of the same number — no cross-city confusion despite the number
  // reuse.
  assert.ok(result?.filter((p) => p.day === 4).every((p) => p.placeId?.startsWith('京都，日本-')))
  assert.ok(result?.filter((p) => p.day === 5).every((p) => p.placeId?.startsWith('京都，日本-')))
})

test('fetchAiPlaces still merges a repeated city into ONE zone-planning call when only ONE visit carries a destinationPlaceId', async (t) => {
  // planCitySegments groups segments with its own sameCity-based array scan
  // (a separate call site from preferencesForGroup, though both share the
  // same sameCity function) — this exercises THAT grouping loop directly,
  // for the asymmetric case where the user picked a Places suggestion for
  // Tokyo's first visit (destinationPlaceId set) but typed the second visit
  // as free text (no placeId, same city name).
  type ZoneBody = { destination: string; totalDays: number }
  const zoneBodies: ZoneBody[] = []
  const WIDE_WINDOW = { start: '08:00', end: '20:00' }

  mockFetch(t, {
    zones: (body) => {
      zoneBodies.push(body as ZoneBody)
      return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    },
    day: (body) => new Response(JSON.stringify({ places: [dayPlace(body.day, `p${body.day}`)] }), { status: 200 }),
  })

  const input = baseInput({
    destination: '東京，日本',
    destinationPlaceId: 'place-tokyo',
    cities: [
      { destination: '東京，日本', destinationPlaceId: 'place-tokyo', days: 3 },
      { destination: '京都，日本', destinationPlaceId: 'place-kyoto', days: 2 },
      { destination: '東京，日本', days: 2 }, // no placeId — e.g. typed as free text
    ],
  })
  await fetchAiPlaces(input, 7, WIDE_WINDOW)

  const tokyoZoneBodies = zoneBodies.filter((b) => b.destination === '東京，日本')
  assert.equal(tokyoZoneBodies.length, 1, 'expected the two Tokyo visits to merge into one zone-planning call despite only one carrying a placeId')
  assert.equal(tokyoZoneBodies[0]!.totalDays, 5)
})

test('fetchAiPlaces sends every day-request in a repeated-city group the SAME destination text — the group\'s first occurrence\'s, not each visit\'s own', async (t) => {
  // Regression test: day-requests used to send each segment's OWN
  // destination text (plan.segment.destination) even though the whole
  // group shares one zone-planning call's context. sameCity's text fallback
  // can merge two occurrences whose destination text genuinely differs (same
  // city, different wording — here "東京，日本" vs a free-typed "東京", both
  // reducing to the same cityFromDestination "東京") — without this fix, the
  // second Tokyo visit's day-requests would describe the destination as
  // "東京" while the shared zone hints/city-center were planned against
  // "東京，日本", a mismatch between what Claude was told when planning zones
  // and what later day-requests for the same group say.
  type DayBody = { destination: string; day: number }
  const dayBodies: DayBody[] = []
  const WIDE_WINDOW = { start: '08:00', end: '20:00' }

  mockFetch(t, {
    zones: () => new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 }),
    day: (body) => {
      dayBodies.push(body as DayBody)
      // 8 places (well above any day's target count) so this doesn't trigger
      // a backfill retry for the same day — a retry would push a second body
      // with the identical destination text, which is harmless to what this
      // test checks but would make the exact-count assertion below brittle.
      const places = Array.from({ length: 8 }, (_, i) => dayPlace(body.day, `${body.destination}-${body.day}-${i}`))
      return new Response(JSON.stringify({ places }), { status: 200 })
    },
  })

  const input = baseInput({
    destination: '東京，日本',
    cities: [
      { destination: '東京，日本', days: 3 },
      { destination: '京都，日本', days: 2 },
      { destination: '東京', days: 2 }, // free-typed, no comma — same real city, different text
    ],
  })
  await fetchAiPlaces(input, 7, WIDE_WINDOW)

  // Every day-request whose absolute day belongs to Tokyo (1-3 for the first
  // visit, 6-7 for the second) must use the group's shared destination text
  // — the first occurrence's "東京，日本" — never the second visit's own
  // free-typed "東京".
  const secondVisitBodies = dayBodies.filter((b) => b.destination === '東京')
  assert.deepEqual(secondVisitBodies, [], 'expected no day-request to use the second visit\'s own destination text once merged into the Tokyo group')
  assert.equal(dayBodies.filter((b) => b.destination === '東京，日本').length, 5, 'expected all 5 Tokyo-group day-requests (3 + 2) to share the representative\'s destination text')
})

test('fetchAiPlaces does not merge two DIFFERENT same-named cities into one combined zone-planning call, even though their destination text shares a bare city name', async (t) => {
  // Two distinct real places named "Cambridge" (UK vs. USA) — same text
  // before the first comma, but resolved to different Google Places
  // suggestions, so they carry different destinationPlaceId values. Under
  // the unified-group design, wrongly merging these would combine two
  // unrelated cities into a single "5-day Cambridge" zone-planning call
  // that makes no geographic sense for either.
  type ZoneBody = { destination: string; totalDays: number }
  const zoneBodies: ZoneBody[] = []
  const WIDE_WINDOW = { start: '08:00', end: '20:00' }

  mockFetch(t, {
    zones: (body) => {
      const b = body as ZoneBody
      zoneBodies.push(b)
      return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    },
    day: (body) => new Response(JSON.stringify({ places: [dayPlace(body.day, `${body.destination}-${body.day}`)] }), { status: 200 }),
  })

  const input = baseInput({
    destination: 'Cambridge, United Kingdom',
    cities: [
      { destination: 'Cambridge, United Kingdom', destinationPlaceId: 'place-cambridge-uk', days: 1 },
      { destination: 'Cambridge, United States', destinationPlaceId: 'place-cambridge-us', days: 1 },
    ],
  })
  await fetchAiPlaces(input, 2, WIDE_WINDOW)

  // Two independent 1-day calls, not one merged 2-day call.
  assert.equal(zoneBodies.length, 2)
  assert.ok(zoneBodies.every((b) => b.totalDays === 1))
})
