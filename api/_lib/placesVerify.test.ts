import assert from 'node:assert/strict'
import test from 'node:test'

import {
  autocompletePlaces,
  distanceKm,
  geocodeCityCenter,
  nearbyPlaces,
  searchPlaces,
  verifyPlace,
} from './placesVerify.ts'

// Minimal fake of a Google Places Text/Nearby Search response body.
type FakePlace = {
  id: string
  name?: string
  lat: number
  lng: number
  businessStatus?: string
  types?: string[]
}

function textSearchBody(places: FakePlace[]): string {
  return JSON.stringify({
    places: places.map((p) => ({
      id: p.id,
      displayName: { text: p.name ?? '' },
      location: { latitude: p.lat, longitude: p.lng },
      businessStatus: p.businessStatus ?? 'OPERATIONAL',
      types: p.types ?? ['point_of_interest'],
    })),
  })
}

const TAIPEI = { lat: 25.03, lng: 121.56 }
// ~166km north of TAIPEI (well past the 80km MAX_KM_FROM_CITY guard).
const FAR_FROM_TAIPEI = { lat: 26.5, lng: 121.56 }

test('distanceKm is 0 for the same point and matches the known ~111km/degree-of-latitude figure', () => {
  assert.equal(distanceKm(TAIPEI, TAIPEI), 0)
  const oneDegreeNorth = { lat: TAIPEI.lat + 1, lng: TAIPEI.lng }
  assert.ok(Math.abs(distanceKm(TAIPEI, oneDegreeNorth) - 111.19) < 1)
})

test('verifyPlace returns the verified place when it is within range of the city center', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(textSearchBody([{ id: 'p1', name: '鼎泰豐', lat: 25.031, lng: 121.561 }]), { status: 200 }),
  )
  const result = await verifyPlace('key', ['鼎泰豐 台北'], TAIPEI)
  assert.deepEqual(result, { placeId: 'p1', name: '鼎泰豐', lat: 25.031, lng: 121.561, photoRef: undefined })
})

test('verifyPlace rejects a hit far from the city center as a wrong-city match', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(textSearchBody([{ id: 'p2', name: '東山樂園', lat: FAR_FROM_TAIPEI.lat, lng: FAR_FROM_TAIPEI.lng }]), {
      status: 200,
    }),
  )
  const result = await verifyPlace('key', ['東山樂園'], TAIPEI)
  assert.equal(result, null)
})

test('verifyPlace rejects a permanently closed listing', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      textSearchBody([{ id: 'p3', name: '已歇業店家', lat: 25.031, lng: 121.561, businessStatus: 'CLOSED_PERMANENTLY' }]),
      { status: 200 },
    ),
  )
  const result = await verifyPlace('key', ['已歇業店家'], TAIPEI)
  assert.equal(result, null)
})

test('verifyPlace rejects a disqualifying type like a transit station', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      textSearchBody([{ id: 'p4', name: '某轉運站', lat: 25.031, lng: 121.561, types: ['transit_station'] }]),
      { status: 200 },
    ),
  )
  const result = await verifyPlace('key', ['某轉運站'], TAIPEI)
  assert.equal(result, null)
})

test('verifyPlace falls through to geocodeQueryAlt when the primary query has no match', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const { textQuery } = JSON.parse(init.body as string) as { textQuery: string }
    if (textQuery === '主要查詢字串') return new Response(textSearchBody([]), { status: 200 })
    return new Response(textSearchBody([{ id: 'p5', name: '備用名稱', lat: 25.031, lng: 121.561 }]), { status: 200 })
  })
  const result = await verifyPlace('key', ['主要查詢字串', '備用查詢字串'], TAIPEI)
  assert.equal(result?.placeId, 'p5')
})

test('verifyPlace caches a result so an identical later call does not re-fetch', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(textSearchBody([{ id: 'p6', name: '快取測試店', lat: 25.031, lng: 121.561 }]), { status: 200 })
  })
  const query = ['快取測試查詢字串']
  const first = await verifyPlace('key', query, TAIPEI)
  const second = await verifyPlace('key', query, TAIPEI)
  assert.equal(first?.placeId, 'p6')
  assert.equal(second?.placeId, 'p6')
  assert.equal(calls, 1)
})

test('geocodeCityCenter resolves to coordinates on a successful lookup', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(textSearchBody([{ id: 'c1', name: '台中市', lat: 24.15, lng: 120.67 }]), { status: 200 }),
  )
  const result = await geocodeCityCenter('key', '台中，台灣獨有查詢字串')
  assert.deepEqual(result, { lat: 24.15, lng: 120.67 })
})

test('geocodeCityCenter returns null instead of throwing on a failed request', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }))
  const result = await geocodeCityCenter('key', '解析失敗的查詢字串')
  assert.equal(result, null)
})

test('searchPlaces short-circuits on a blank query without calling fetch', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(textSearchBody([]), { status: 200 })
  })
  const results = await searchPlaces('key', '   ', undefined, null, TAIPEI)
  assert.deepEqual(results, [])
  assert.equal(calls, 0)
})

test('searchPlaces infers a category from Google\'s place types when no category chip was selected', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(textSearchBody([{ id: 's1', name: '街角咖啡廳', lat: 25.031, lng: 121.561, types: ['cafe'] }]), {
      status: 200,
    }),
  )
  const [result] = await searchPlaces('key', '咖啡廳搜尋字串', undefined, null, TAIPEI)
  assert.equal(result?.category, 'food')
})

test('searchPlaces drops a wrong-city hit even though locationBias only ranks, not excludes', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      textSearchBody([{ id: 's2', name: '同名但在別的城市', lat: FAR_FROM_TAIPEI.lat, lng: FAR_FROM_TAIPEI.lng }]),
      { status: 200 },
    ),
  )
  const results = await searchPlaces('key', '跨城市查詢字串', undefined, null, TAIPEI)
  assert.deepEqual(results, [])
})

test('nearbyPlaces widens from the tight day-anchor radius to the whole city when the tight radius finds nothing', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { locationRestriction: { circle: { radius: number } } }
    if (body.locationRestriction.circle.radius === 8000) return new Response(textSearchBody([]), { status: 200 })
    return new Response(textSearchBody([{ id: 'n1', name: '城市範圍才找到的店', lat: 25.031, lng: 121.561 }]), {
      status: 200,
    })
  })
  const dayAnchor = { lat: 25.031, lng: 121.561 }
  const results = await nearbyPlaces('key', 'food', dayAnchor, TAIPEI)
  assert.equal(results.length, 1)
  assert.equal(results[0]?.placeId, 'n1')
})

test('autocompletePlaces drops sub-city predictions (wards/streets), keeping only city-level ones', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: 'ac1',
              structuredFormat: { mainText: { text: '日本・東京' }, secondaryText: { text: '' } },
              types: ['locality'],
            },
          },
          {
            placePrediction: {
              placeId: 'ac2',
              structuredFormat: { mainText: { text: '足立區' }, secondaryText: { text: '東京, 日本' } },
              types: ['sublocality_level_1'],
            },
          },
        ],
      }),
      { status: 200 },
    ),
  )
  const results = await autocompletePlaces('key', '東京', 'session-1')
  assert.equal(results.length, 1)
  assert.equal(results[0]?.placeId, 'ac1')
})
