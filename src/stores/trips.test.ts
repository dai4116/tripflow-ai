// trips.ts is a browser-only Pinia store: @vueuse/core's useStorage needs
// `window` (and ideally a real, working localStorage — Node's own is
// flag-gated and environment-dependent, so a deterministic in-memory stand-in
// is used instead, fresh per test, rather than relying on whatever Node
// happens to provide). fetch is mocked in every test below so nothing in
// here ever makes a real network call (Nominatim geocoding, OpenRouteService
// routing, or the AI generation endpoints all go through fetch).
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
}

class MemoryStorage {
  #store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.#store.has(key) ? this.#store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.#store.set(key, value)
  }
  removeItem(key: string): void {
    this.#store.delete(key)
  }
  clear(): void {
    this.#store.clear()
  }
}

import assert from 'node:assert/strict'
import test, { type TestContext } from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import type { CreateTripInput, Place, Trip } from '../types/index.ts'
import { resetGeocodeStateForTests } from '../data/geocode.ts'
import { useTripsStore } from './trips.ts'

// Fresh Pinia instance + fresh in-memory storage per test — a store created
// against a shared/previous instance would silently inherit the last test's
// persisted trips/places, since useStorage reads its key back on creation.
// Also resets geocode.ts's module-level cache/queue — without this, a test
// later in this file that awaits its own geocode call actually firing would
// otherwise be stuck behind real, un-awaited backlog left by every earlier
// test's own (never-awaited) geocode calls.
function freshStore() {
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage()
  setActivePinia(createPinia())
  resetGeocodeStateForTests()
  return useTripsStore()
}

// Every code path exercised below eventually touches fetch in the
// background (geocoding a 0,0 place, filling in a travel-time gap, or
// generating a trip) — stub it everywhere so nothing here ever reaches a
// real network, regardless of which path a given test happens to trigger.
function stubFetch(t: TestContext, handler?: (url: string, init: RequestInit) => Response) {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    if (handler) return handler(url, init)
    return new Response('', { status: 500 })
  })
}

function seedTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1',
    title: '測試之旅',
    destination: '京都，日本',
    days: 2,
    placeCount: 0,
    color: '#000000',
    dateRange: '',
    preferences: [],
    pace: 'balanced',
    columns: [
      { id: 'day-1', title: '第1天', dayNumber: 1, placeIds: [] },
      { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: [] },
    ],
    ...overrides,
  }
}

function seedPlace(overrides: Partial<Place> & { id: string; tripId: string; columnId: string }): Place {
  return {
    name: 'Place',
    category: 'attraction',
    estimatedTime: 1,
    address: '京都，日本',
    lat: 0,
    lng: 0,
    description: 'd',
    ...overrides,
  }
}

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

test('getTripById / placesForTrip look up by id', (t) => {
  stubFetch(t)
  const store = freshStore()
  const trip = seedTrip()
  store.trips.push(trip)
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1' }))

  assert.equal(store.getTripById('trip-1')?.id, trip.id)
  assert.equal(store.getTripById('missing'), undefined)
  assert.equal(store.placesForTrip('trip-1').length, 1)
  assert.equal(store.placesForTrip('missing').length, 0)
})

test('addPlace pushes a place into the column and recalculates placeCount', (t) => {
  stubFetch(t)
  const store = freshStore()
  store.trips.push(seedTrip())

  const place = store.addPlace({
    tripId: 'trip-1',
    columnId: 'day-1',
    name: '清水寺',
    category: 'attraction',
    description: 'd',
    lat: 34.99,
    lng: 135.78,
  })

  assert.ok(place)
  assert.equal(store.places.length, 1)
  assert.deepEqual(store.getTripById('trip-1')!.columns[0]!.placeIds, [place!.id])
  assert.equal(store.getTripById('trip-1')!.placeCount, 1)
})

test('addPlace returns undefined for an unknown trip or column', (t) => {
  stubFetch(t)
  const store = freshStore()
  store.trips.push(seedTrip())

  assert.equal(
    store.addPlace({ tripId: 'missing', columnId: 'day-1', name: 'x', category: 'attraction', description: 'd' }),
    undefined,
  )
  assert.equal(
    store.addPlace({ tripId: 'trip-1', columnId: 'missing', name: 'x', category: 'attraction', description: 'd' }),
    undefined,
  )
  assert.equal(store.places.length, 0)
})

test('addPlace returns the existing place instead of duplicating when the same Google placeId is already in the trip', (t) => {
  stubFetch(t)
  const store = freshStore()
  store.trips.push(seedTrip())

  const first = store.addPlace({
    tripId: 'trip-1',
    columnId: 'day-1',
    name: '清水寺',
    category: 'attraction',
    description: 'd',
    placeId: 'google-1',
  })
  const second = store.addPlace({
    tripId: 'trip-1',
    columnId: 'day-2', // even from a different column of the same trip
    name: '清水寺（重複）',
    category: 'attraction',
    description: 'd',
    placeId: 'google-1',
  })

  assert.equal(second?.id, first?.id)
  assert.equal(store.places.length, 1)
})

test('removePlace removes the place from its column and recalculates placeCount', (t) => {
  stubFetch(t)
  const store = freshStore()
  const trip = seedTrip({ placeCount: 1, columns: [{ id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['p1'] }] })
  store.trips.push(trip)
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1' }))

  store.removePlace('p1')

  assert.equal(store.places.length, 0)
  assert.deepEqual(store.getTripById('trip-1')!.columns[0]!.placeIds, [])
  assert.equal(store.getTripById('trip-1')!.placeCount, 0)
})

test('removePlace is a no-op for an unknown placeId', (t) => {
  stubFetch(t)
  const store = freshStore()
  store.trips.push(seedTrip())
  assert.doesNotThrow(() => store.removePlace('missing'))
})

test('movePlaceToColumn moves a place between columns without changing the trip\'s total placeCount', (t) => {
  stubFetch(t)
  const store = freshStore()
  const trip = seedTrip({ placeCount: 1, columns: [{ id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['p1'] }, { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: [] }] })
  store.trips.push(trip)
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1' }))

  store.movePlaceToColumn('p1', 'day-2')

  assert.deepEqual(store.getTripById('trip-1')!.columns[0]!.placeIds, [])
  assert.deepEqual(store.getTripById('trip-1')!.columns[1]!.placeIds, ['p1'])
  assert.equal(store.places.find((p) => p.id === 'p1')!.columnId, 'day-2')
  assert.equal(store.getTripById('trip-1')!.placeCount, 1)
})

test('movePlaceToColumn is a no-op when the place is already in that column', (t) => {
  stubFetch(t)
  const store = freshStore()
  const trip = seedTrip({ columns: [{ id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['p1'] }] })
  store.trips.push(trip)
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1' }))

  store.movePlaceToColumn('p1', 'day-1')

  assert.deepEqual(store.getTripById('trip-1')!.columns[0]!.placeIds, ['p1'])
})

test('movePlaceToColumn updates the place\'s address to its new column\'s city on a multi-city trip', (t) => {
  stubFetch(t)
  const store = freshStore()
  const trip = seedTrip({
    destination: '東京・大阪',
    cities: [
      { id: 'city-tokyo', destination: '東京，日本' },
      { id: 'city-osaka', destination: '大阪，日本' },
    ],
    columns: [
      { id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['p1'], cityId: 'city-tokyo' },
      { id: 'day-2', title: '第2天', dayNumber: 2, placeIds: [], cityId: 'city-osaka' },
    ],
  })
  store.trips.push(trip)
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1', address: '東京，日本' }))

  store.movePlaceToColumn('p1', 'day-2')

  assert.equal(store.places.find((p) => p.id === 'p1')!.address, '大阪，日本')
})

test('reorderColumnPlaces replaces a column\'s place order', (t) => {
  stubFetch(t)
  const store = freshStore()
  const trip = seedTrip({ columns: [{ id: 'day-1', title: '第1天', dayNumber: 1, placeIds: ['a', 'b', 'c'] }] })
  store.trips.push(trip)

  store.reorderColumnPlaces('trip-1', 'day-1', ['c', 'a', 'b'])

  assert.deepEqual(store.getTripById('trip-1')!.columns[0]!.placeIds, ['c', 'a', 'b'])
})

test('updatePlace patches only the allowed fields', (t) => {
  stubFetch(t)
  const store = freshStore()
  store.trips.push(seedTrip())
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1', name: '舊名稱' }))

  store.updatePlace('p1', { name: '新名稱', estimatedTime: 2 })

  const place = store.places.find((p) => p.id === 'p1')!
  assert.equal(place.name, '新名稱')
  assert.equal(place.estimatedTime, 2)
})

test('updatePlace clears skipGeocode when a skipGeocode place is renamed, handing it back to the normal geocode pipeline', (t) => {
  // geocode.ts's Nominatim queue is a module-level singleton, rate-limited
  // to ~1 req/sec and shared with every other test in this run — not
  // something a unit test can reliably await. skipGeocode flipping to false
  // and geocodeQuery being set synchronously (proven here) is what actually
  // re-enables geocoding for this place; whether the queued fetch itself
  // eventually fires isn't new behavior introduced by updatePlace.
  stubFetch(t, () => new Response('[]', { status: 200 }))
  const store = freshStore()
  store.trips.push(seedTrip())
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1', name: '抵達機場', skipGeocode: true }))

  store.updatePlace('p1', { name: '桃園國際機場第二航廈' })

  const place = store.places.find((p) => p.id === 'p1')!
  assert.equal(place.skipGeocode, false)
  assert.equal(place.name, '桃園國際機場第二航廈')
  // geocodeQuery, not left for the plain-name fallback — that composes
  // "name, [trip destination city/region]", which breaks for an airport
  // that isn't actually located in the trip's destination (confirmed live
  // against Nominatim — see updatePlace's own comment).
  assert.equal(place.geocodeQuery, '桃園國際機場第二航廈')
})

test('updatePlace leaves skipGeocode alone and never geocodes when the name is unchanged', (t) => {
  const geocodeUrls: string[] = []
  stubFetch(t, (url) => {
    geocodeUrls.push(url)
    return new Response('', { status: 500 })
  })
  const store = freshStore()
  store.trips.push(seedTrip())
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1', name: '抵達機場', skipGeocode: true }))

  store.updatePlace('p1', { name: '抵達機場', estimatedTime: 2 })

  const place = store.places.find((p) => p.id === 'p1')!
  assert.equal(place.skipGeocode, true)
  assert.equal(place.estimatedTime, 2)
  assert.equal(geocodeUrls.length, 0)
})

test('updatePlace still geocodes an airport rename even when the place\'s columnId no longer matches any current column', async (t) => {
  // Regression test: the geocode call used to be gated on `trip && column`
  // both resolving, so a place whose columnId had gone stale (its day column
  // removed by some other flow, the place record left behind) would silently
  // never fire this geocode at all. Fixed by only requiring `trip` — the
  // column lookup now happens inside geocodeNewPlaces itself, which already
  // degrades gracefully (falls back to trip.destination) when it can't find
  // the column, instead of skipping the call entirely.
  const geocodeUrls: string[] = []
  stubFetch(t, (url) => {
    geocodeUrls.push(url)
    return new Response('[]', { status: 200 })
  })
  const store = freshStore()
  store.trips.push(seedTrip())
  store.places.push(seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'stale-column-id', name: '抵達機場', skipGeocode: true }))

  store.updatePlace('p1', { name: '桃園國際機場第二航廈' })

  const place = store.places.find((p) => p.id === 'p1')!
  assert.equal(place.skipGeocode, false)
  assert.equal(place.geocodeQuery, '桃園國際機場第二航廈')

  // geocode.ts's Nominatim queue defers even its first call to a microtask
  // (see this file's other skipGeocode test) — the synchronous state above
  // is what proves the geocode PATH was taken; this proves the call itself
  // actually fired instead of being silently skipped by the stale columnId.
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.ok(geocodeUrls.length > 0, 'expected geocodeNewPlaces to still fire despite the stale columnId')
})

test('removeTrip deletes the trip and only its own places', (t) => {
  stubFetch(t)
  const store = freshStore()
  store.trips.push(seedTrip({ id: 'trip-1' }), seedTrip({ id: 'trip-2' }))
  store.places.push(
    seedPlace({ id: 'p1', tripId: 'trip-1', columnId: 'day-1' }),
    seedPlace({ id: 'p2', tripId: 'trip-2', columnId: 'day-1' }),
  )

  store.removeTrip('trip-1')

  assert.equal(store.getTripById('trip-1'), undefined)
  assert.ok(store.getTripById('trip-2'))
  assert.deepEqual(store.places.map((p) => p.id), ['p2'])
})

test('copyTemplateTrip clones a template with fresh ids and does not mutate the original template', (t) => {
  stubFetch(t) // default 500 -> geocodeDestination resolves undefined, same as a failed backfill
  const store = freshStore()

  const copy = store.copyTemplateTrip('kyoto-slow')
  assert.ok(copy)
  assert.notEqual(copy!.id, 'kyoto-slow')

  const originalFirstPlaceId = copy!.columns[0]!.placeIds[0]!
  assert.notEqual(originalFirstPlaceId, 'kyoto-kiyomizudera') // remapped to a fresh id, not the template's own

  // The copy's places actually exist in the store, are real clones (not the
  // same object identity), and its placeCount matches the columns.
  const clonedPlace = store.places.find((p) => p.id === originalFirstPlaceId)
  assert.ok(clonedPlace)
  assert.equal(clonedPlace!.tripId, copy!.id)
  assert.equal(
    copy!.placeCount,
    copy!.columns.reduce((sum, c) => sum + c.placeIds.length, 0),
  )

  // Copying a second time must not reuse the first copy's ids or mutate it.
  const secondCopy = store.copyTemplateTrip('kyoto-slow')
  assert.notEqual(secondCopy!.id, copy!.id)
  assert.equal(store.getTripById(copy!.id)!.columns[0]!.placeIds[0], originalFirstPlaceId)
})

test('copyTemplateTrip returns the trip synchronously, without waiting on the destinationPlaceId backfill', (t) => {
  stubFetch(t, (url) => {
    if (url.includes('geocode-destination')) {
      return new Response(JSON.stringify({ placeId: 'kyoto-place-id', lat: 35.01, lng: 135.76 }), { status: 200 })
    }
    return new Response('', { status: 500 })
  })
  const store = freshStore()

  const copy = store.copyTemplateTrip('kyoto-slow')

  // The backfill fetch hasn't had a chance to resolve yet — it must not be
  // awaited before the copy is created (see trips.ts's comment on why).
  assert.equal(copy?.destinationPlaceId, undefined)
})

test('copyTemplateTrip backfills destinationPlaceId via geocode-destination in the background since templates never have one', async (t) => {
  stubFetch(t, (url) => {
    if (url.includes('geocode-destination')) {
      return new Response(JSON.stringify({ placeId: 'kyoto-place-id', lat: 35.01, lng: 135.76 }), { status: 200 })
    }
    return new Response('', { status: 500 })
  })
  const store = freshStore()

  const copy = store.copyTemplateTrip('kyoto-slow')
  // Flush the backfill's pending fetch/microtasks before asserting it landed.
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(copy?.destinationPlaceId, 'kyoto-place-id')
  assert.equal(copy?.destinationLat, 35.01)
  assert.equal(copy?.destinationLng, 135.76)
  // coverImage is copied straight from the template regardless — this
  // backfill only unlocks changing it later via TripSettingsModal.vue's
  // cover-photo picker, it doesn't fetch a new photo itself.
  assert.ok(copy?.coverImage)
})

test('copyTemplateTrip returns undefined for an unknown template id', (t) => {
  stubFetch(t)
  const store = freshStore()
  assert.equal(store.copyTemplateTrip('does-not-exist'), undefined)
})

test('createTrip throws instead of silently falling back when AI generation fails', async (t) => {
  stubFetch(t) // every fetch (zones + day requests) resolves 500 -> fetchAiPlaces returns undefined
  const store = freshStore()

  await assert.rejects(() => store.createTrip(baseInput()), /AI trip generation failed/)
  assert.equal(store.trips.length, 0)
  assert.equal(store.places.length, 0)
})

test('createTrip builds and stores a trip from the generated AI places', async (t) => {
  stubAiGeneration(t)
  const store = freshStore()

  const trip = await store.createTrip(baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' }))

  assert.equal(store.trips.length, 1)
  assert.equal(store.trips[0]?.id, trip.id)
  assert.equal(store.places.length, 1)
  assert.equal(store.places[0]!.placeId, 'google-1')
  assert.equal(trip.placeCount, 1)
})

function stubAiGeneration(t: TestContext, extra?: (url: string, init: RequestInit) => Response | undefined) {
  stubFetch(t, (url, init) => {
    const fromExtra = extra?.(url, init)
    if (fromExtra) return fromExtra
    if (url.includes('plan-trip-zones')) return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    if (url.includes('generate-trip-day')) {
      const body = JSON.parse(init.body as string) as { day: number }
      return new Response(
        JSON.stringify({ places: [{ day: body.day, name: `Day${body.day}景點`, category: 'attraction', description: 'd', placeId: `google-${body.day}`, lat: 35, lng: 135 }] }),
        { status: 200 },
      )
    }
    return new Response('', { status: 500 })
  })
}

test('createTrip never fires a Nominatim geocode for the flight cards it adds when arrivalTime/departureTime are set', async (t) => {
  const geocodeUrls: string[] = []
  stubAiGeneration(t, (url) => {
    if (url.includes('nominatim')) {
      geocodeUrls.push(url)
      return new Response('[]', { status: 200 })
    }
    return undefined
  })
  const store = freshStore()

  // 2 days, not 1 — deliberately sidesteps flight-timing edge cases (e.g. a
  // 1-day trip with both an arrival and departure squeezing that single
  // day's window very short, or to nothing at all) that are unrelated to
  // what this test is actually checking.
  const trip = await store.createTrip(
    baseInput({ startDate: '2024-03-01', endDate: '2024-03-02', arrivalTime: '15:00', departureTime: '20:00' }),
  )

  const flightCards = store.placesForTrip(trip.id).filter((p) => p.category === 'transport')
  assert.equal(flightCards.length, 2)
  assert.ok(flightCards.every((p) => p.skipGeocode === true))
  assert.equal(geocodeUrls.length, 0, 'expected no Nominatim call for either flight card')
})

test('createTrip geocodes each place against its OWN city on a multi-city trip, not just the first city', async (t) => {
  // Regression test: geocodeNewPlaces used to take one shared destination
  // string for the whole initial batch (geocodeDestinationFor(trip), always
  // the FIRST city), so any place needing the Nominatim fallback (no
  // geocodeQuery, no server-verified coords — deliberately what this test's
  // places look like) got geocoded against the wrong city's name/region for
  // every city after the first. Fixed by resolving each place's own column
  // via destinationForColumn instead of one shared destination for the batch.
  const nominatimUrls: string[] = []
  let dayRequestCount = 0
  stubFetch(t, (url, init) => {
    if (url.includes('nominatim')) {
      nominatimUrls.push(url)
      return new Response('[]', { status: 200 })
    }
    if (url.includes('plan-trip-zones')) return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    if (url.includes('generate-trip-day')) {
      const body = JSON.parse(init.body as string) as { day: number; destination: string }
      dayRequestCount++
      // One place with no placeId/lat/lng/geocodeQuery — forces
      // resolveNewPlaceCoords down the city/region-dependent geocodePlace()
      // branch, the one this bug affected (a place WITH its own geocodeQuery
      // bypasses city/region entirely, so it wouldn't have caught this) —
      // plus 7 filler places that already have coords, so daysNeedingBackfill
      // sees this day as already at/over target and never fires a second
      // request for it. A backfill retry would enqueue a second real
      // Nominatim lookup ~1.1s (geocode.ts's rate-limit gap) after the
      // first, which this test would then have to wait out for no reason
      // relevant to the fix being tested.
      const geocodeNeeded = { day: body.day, name: `${body.destination}景點${dayRequestCount}`, category: 'attraction', description: 'd' }
      const filler = Array.from({ length: 7 }, (_, i) => ({ day: body.day, name: `filler${i}`, category: 'attraction', description: 'd', lat: 35, lng: 135 }))
      return new Response(JSON.stringify({ places: [geocodeNeeded, ...filler] }), { status: 200 })
    }
    return new Response('', { status: 500 })
  })
  const store = freshStore()

  await store.createTrip(
    baseInput({
      destination: '東京，日本',
      startDate: '2024-03-01',
      endDate: '2024-03-02',
      cities: [
        { destination: '東京，日本', days: 1 },
        { destination: '大阪，日本', days: 1 },
      ],
    }),
  )

  // Let the fire-and-forget geocode chain (queued, not awaited by
  // createTrip itself) actually run before asserting on it — geocode.ts's
  // queue serializes lookups with a ~1.1s gap between them (Nominatim's rate
  // limit), so 2 places means waiting past one full gap, not just a tick.
  await new Promise((resolve) => setTimeout(resolve, 1300))

  assert.ok(nominatimUrls.length >= 2, `expected at least one Nominatim call per city, got ${nominatimUrls.length}`)
  assert.ok(nominatimUrls.some((url) => url.includes(encodeURIComponent('東京'))), 'expected a query for the Tokyo-day place')
  assert.ok(nominatimUrls.some((url) => url.includes(encodeURIComponent('大阪'))), 'expected a query for the Osaka-day place — not both defaulting to Tokyo')
})

test('createTrip backfills destinationPlaceId from /api/geocode-destination when the input has none', async (t) => {
  stubAiGeneration(t, (url) => {
    if (url.includes('geocode-destination')) {
      return new Response(JSON.stringify({ placeId: 'resolved-place-id', lat: 35.01, lng: 135.76 }), { status: 200 })
    }
    return undefined
  })
  const store = freshStore()

  const trip = await store.createTrip(baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' }))

  assert.equal(trip.destinationPlaceId, 'resolved-place-id')
  assert.equal(trip.destinationLat, 35.01)
  assert.equal(trip.destinationLng, 135.76)
})

test('createTrip leaves destinationPlaceId unset (not a crash) when geocode-destination fails', async (t) => {
  stubAiGeneration(t) // no geocode-destination handler -> falls through to the default 500
  const store = freshStore()

  const trip = await store.createTrip(baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' }))

  assert.equal(trip.destinationPlaceId, undefined)
})

test('createTrip does not call /api/geocode-destination when the input already has a destinationPlaceId', async (t) => {
  let geocodeDestinationCalled = false
  stubAiGeneration(t, (url) => {
    if (url.includes('geocode-destination')) {
      geocodeDestinationCalled = true
      return new Response(JSON.stringify({ placeId: 'should-not-be-used', lat: 0, lng: 0 }), { status: 200 })
    }
    return undefined
  })
  const store = freshStore()

  const trip = await store.createTrip(
    baseInput({ startDate: '2024-03-01', endDate: '2024-03-01', destinationPlaceId: 'already-picked', destinationLat: 1, destinationLng: 2 }),
  )

  assert.equal(geocodeDestinationCalled, false)
  assert.equal(trip.destinationPlaceId, 'already-picked')
  assert.equal(trip.destinationLat, 1)
  assert.equal(trip.destinationLng, 2)
})

test('createTrip auto-sets coverPhotoRef from the first candidate once a destinationPlaceId is known', async (t) => {
  stubAiGeneration(t, (url) => {
    if (url.includes('geocode-destination')) {
      return new Response(JSON.stringify({ placeId: 'resolved-place-id', lat: 35.01, lng: 135.76 }), { status: 200 })
    }
    if (url.includes('place-cover-photos')) {
      return new Response(JSON.stringify({ photoRefs: ['places/x/photos/first', 'places/x/photos/second'] }), { status: 200 })
    }
    return undefined
  })
  const store = freshStore()

  const trip = await store.createTrip(baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' }))

  assert.equal(trip.coverPhotoRef, 'places/x/photos/first')
})

test('createTrip leaves coverPhotoRef unset (not a crash) when there is no destinationPlaceId to fetch photos for', async (t) => {
  stubAiGeneration(t) // no geocode-destination handler -> destinationPlaceId stays unresolved
  const store = freshStore()

  const trip = await store.createTrip(baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' }))

  assert.equal(trip.coverPhotoRef, undefined)
})

test('createTrip leaves coverPhotoRef unset when place-cover-photos returns no candidates', async (t) => {
  stubAiGeneration(t, (url) => {
    if (url.includes('geocode-destination')) {
      return new Response(JSON.stringify({ placeId: 'resolved-place-id', lat: 35.01, lng: 135.76 }), { status: 200 })
    }
    if (url.includes('place-cover-photos')) {
      return new Response(JSON.stringify({ photoRefs: [] }), { status: 200 })
    }
    return undefined
  })
  const store = freshStore()

  const trip = await store.createTrip(baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' }))

  assert.equal(trip.coverPhotoRef, undefined)
})
