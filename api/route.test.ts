import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import handler from './route.ts'

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
  originalKey = process.env.OPENROUTESERVICE_API_KEY
  process.env.OPENROUTESERVICE_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTESERVICE_API_KEY
  else process.env.OPENROUTESERVICE_API_KEY = originalKey
})

const VALID_BODY = { mode: 'walking', from: { lat: 35, lng: 135 }, to: { lat: 35.01, lng: 135.01 } }

test('rejects a non-POST method', async () => {
  const res = fakeRes()
  await handler(fakeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
})

test('returns 500 when OPENROUTESERVICE_API_KEY is not configured', async () => {
  delete process.env.OPENROUTESERVICE_API_KEY
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 500)
})

test('rejects an unknown travel mode', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { ...VALID_BODY, mode: 'teleport' } }), res)
  assert.equal(res.statusCode, 400)
})

test('rejects a missing or malformed from/to', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { mode: 'walking', from: { lat: 35 }, to: VALID_BODY.to } }), res)
  assert.equal(res.statusCode, 400)
})

test('returns duration/distance in the app\'s own units on success', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.ok(url.includes('foot-walking')) // walking -> ORS's foot-walking profile
    const body = JSON.parse(init.body as string) as { coordinates: number[][] }
    // ORS wants [lng, lat] pairs, not [lat, lng].
    assert.deepEqual(body.coordinates, [[135, 35], [135.01, 35.01]])
    return new Response(JSON.stringify({ routes: [{ summary: { duration: 630, distance: 850 } }] }), { status: 200 })
  })
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { durationMin: 11, distanceKm: 0.85 }) // 630s -> round(10.5) = 11min
})

test('treats an upstream 404 (no routable path) as a cacheable 404, not a 502', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 404 }))
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 404)
})

test('treats a 200 with no usable route summary as 404 too', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ routes: [] }), { status: 200 }))
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 404)
})

test('treats a transient upstream failure (rate limit) as 502, not 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }))
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 502)
})
