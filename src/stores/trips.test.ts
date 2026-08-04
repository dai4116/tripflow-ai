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
import { useTripsStore } from './trips.ts'

// Fresh Pinia instance + fresh in-memory storage per test — a store created
// against a shared/previous instance would silently inherit the last test's
// persisted trips/places, since useStorage reads its key back on creation.
function freshStore() {
  ;(globalThis as unknown as { localStorage: unknown }).localStorage = new MemoryStorage()
  setActivePinia(createPinia())
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
    travelers: 2,
    placeCount: 0,
    color: '#000000',
    imageGradient: '',
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
    travelers: 2,
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
  stubFetch(t)
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
  stubFetch(t, (url, init) => {
    if (url.includes('plan-trip-zones')) return new Response(JSON.stringify({ zones: [], cityCenter: null }), { status: 200 })
    if (url.includes('generate-trip-day')) {
      const body = JSON.parse(init.body as string) as { day: number }
      return new Response(
        JSON.stringify({
          places: [
            {
              day: body.day,
              name: `Day${body.day}景點`,
              category: 'attraction',
              description: 'd',
              placeId: `google-${body.day}`,
              lat: 35,
              lng: 135,
            },
          ],
        }),
        { status: 200 },
      )
    }
    return new Response('', { status: 500 })
  })
  const store = freshStore()

  const trip = await store.createTrip(baseInput({ startDate: '2024-03-01', endDate: '2024-03-01' }))

  assert.equal(store.trips.length, 1)
  assert.equal(store.trips[0]?.id, trip.id)
  assert.equal(store.places.length, 1)
  assert.equal(store.places[0]!.placeId, 'google-1')
  assert.equal(trip.placeCount, 1)
})
