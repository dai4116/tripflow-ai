import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import handler from './places-autocomplete.ts'

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
  await handler(fakeReq({ body: { input: '東京', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 404)
})

test('rejects a blank input', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { input: '   ', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 400)
})

test('rejects a missing sessionToken', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { input: '東京' } }), res)
  assert.equal(res.statusCode, 400)
})

test('returns suggestions on success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(
      JSON.stringify({
        suggestions: [
          {
            placePrediction: {
              placeId: 'p1',
              structuredFormat: { mainText: { text: '日本・東京' }, secondaryText: { text: '' } },
              types: ['locality'],
            },
          },
        ],
      }),
      { status: 200 },
    ),
  )
  const res = fakeRes()
  await handler(fakeReq({ body: { input: '東京', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { suggestions: [{ placeId: 'p1', mainText: '日本・東京', secondaryText: '' }] })
})

test('returns 502 when the upstream call throws', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 500 }))
  const res = fakeRes()
  await handler(fakeReq({ body: { input: '東京', sessionToken: 'tok' } }), res)
  assert.equal(res.statusCode, 502)
})
