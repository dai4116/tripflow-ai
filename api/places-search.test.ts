import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import handler from './places-search.ts'

function fakeReq(overrides: { method?: string; body?: unknown } = {}) {
  return { method: 'POST', body: {}, ...overrides }
}

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
    },
  }
  return res
}

let originalKey: string | undefined

beforeEach(() => {
  originalKey = process.env.GOOGLE_PLACES_API_KEY
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY
  else process.env.GOOGLE_PLACES_API_KEY = originalKey
})

test('rejects a non-POST method', async () => {
  const res = fakeRes()
  await handler(fakeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
})

test('returns 404 when GOOGLE_PLACES_API_KEY is not configured', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY
  const res = fakeRes()
  await handler(fakeReq({ body: { query: '拉麵', destination: '京都' } }), res)
  assert.equal(res.statusCode, 404)
})

test('rejects when there is neither a query nor a category', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { destination: '京都' } }), res)
  assert.equal(res.statusCode, 400)
})

test('rejects a missing destination', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { query: '拉麵' } }), res)
  assert.equal(res.statusCode, 400)
})

test('a typed query goes through Text Search, echoing back the resolved city center', async (t) => {
  const calls: string[] = []
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    calls.push(url)
    if (calls.length === 1) {
      // geocodeCityCenter's own lookup
      return new Response(JSON.stringify({ places: [{ id: 'city1', location: { latitude: 35, longitude: 135 } }] }), { status: 200 })
    }
    return new Response(
      JSON.stringify({ places: [{ id: 'p1', displayName: { text: '一乗寺ラーメン' }, location: { latitude: 35.01, longitude: 135.01 }, types: ['restaurant'] }] }),
      { status: 200 },
    )
  })
  const res = fakeRes()
  await handler(fakeReq({ body: { query: '拉麵', destination: '京都，日本' } }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { results: { placeId: string }[]; cityCenter: { lat: number; lng: number } | null }
  assert.equal(body.results.length, 1)
  assert.equal(body.results[0]!.placeId, 'p1')
  assert.deepEqual(body.cityCenter, { lat: 35, lng: 135 })
})

test('a category chip with no typed text browses via Nearby Search instead of Text Search', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.ok(url.includes('searchNearby'), `expected a Nearby Search call, got ${url}`)
    return new Response(JSON.stringify({ places: [{ id: 'n1', displayName: { text: '某餐廳' }, location: { latitude: 35.01, longitude: 135.01 } }] }), { status: 200 })
  })
  const res = fakeRes()
  // cityCenter: null (the client already tried and failed to resolve it) +
  // a dayAnchor means resolveAnchor prefers the anchor and geocodeCityCenter
  // is never called — otherwise the handler always resolves cityCenter
  // itself first when the field is omitted entirely, which would be a
  // second (Text Search) fetch call ahead of this Nearby Search one.
  await handler(fakeReq({ body: { category: 'food', destination: '京都，日本', dayAnchor: { lat: 35, lng: 135 }, cityCenter: null } }), res)
  assert.equal(res.statusCode, 200)
})

test('returns 502 when the upstream call fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }))
  const res = fakeRes()
  await handler(fakeReq({ body: { query: '拉麵', destination: '京都，日本' } }), res)
  assert.equal(res.statusCode, 502)
})
