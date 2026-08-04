// aiTripClient.ts is a browser client (window.setTimeout, fetch) — shim
// `window` to the Node global object so it runs under plain `node --test`
// with no jsdom. `fetch`/AbortController are already real Node globals.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
}

import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'

import type { CreateTripInput } from '../types/index.ts'
import { dedupeByPlaceId, daysNeedingBackfill, fetchAiPlaces, findExistingAnchor } from './aiTripClient.ts'
import type { PlaceSuggestion } from './generateTrip.ts'

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
  assert.deepEqual(daysNeedingBackfill(places, 3, 2), [2, 3])
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

// Shared fetch dispatcher for the fetchAiPlaces integration tests below —
// routes by URL, and hands the parsed request body to whichever handler the
// test supplies for that endpoint.
function mockFetch(t: TestContext, handlers: {
  zones?: (body: unknown) => Response
  day?: (body: { day: number; existingAnchor: unknown }) => Response
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
  const result = await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02' }), 2, 1)
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
  const result = await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02' }), 2, 1)
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
  const result = await fetchAiPlaces(baseInput({ startDate: '2024-03-01', endDate: '2024-03-02' }), 2, 1)
  const placeIds = result?.map((p) => p.placeId).sort()
  assert.deepEqual(placeIds, ['day2-real', 'dup1'])
})

test('fetchAiPlaces returns undefined when every day comes back empty even after backfill', async (t) => {
  mockFetch(t, { day: () => new Response('', { status: 500 }) })
  const result = await fetchAiPlaces(baseInput(), 1, 1)
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
  await fetchAiPlaces(baseInput(), 1, 2)
  assert.equal(backfillBodies.length, 1)
  assert.deepEqual(backfillBodies[0]!.existingAnchor, { lat: 25.03, lng: 121.56 })
})
