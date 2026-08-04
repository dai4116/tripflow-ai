import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import handler from './place-details.ts'

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
  await handler(fakeReq({ body: { placeId: 'abc', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 404)
})

test('rejects a missing or malformed placeId', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 400)

  const res2 = fakeRes()
  await handler(fakeReq({ body: { placeId: '有空格 不合法', sessionToken: 'tok' } }), res2)
  assert.equal(res2.statusCode, 400)
})

test('rejects a missing sessionToken', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { placeId: 'abc123' } }), res)
  assert.equal(res.statusCode, 400)
})

test('resolves and returns coordinates on a successful lookup', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ location: { latitude: 34.99, longitude: 135.78 } }), { status: 200 }),
  )
  const res = fakeRes()
  await handler(fakeReq({ body: { placeId: 'abc123', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { lat: 34.99, lng: 135.78 })
})

test('returns 404 when the place cannot be resolved', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({}), { status: 200 }))
  const res = fakeRes()
  await handler(fakeReq({ body: { placeId: 'abc123', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 404)
})

test('returns 502 when the upstream call throws', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }))
  const res = fakeRes()
  await handler(fakeReq({ body: { placeId: 'abc123', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 502)
})
