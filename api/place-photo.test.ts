import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'

import handler from './place-photo.ts'

function fakeReq(overrides: { method?: string; query?: Record<string, string> } = {}) {
  return { method: 'GET', query: {}, ...overrides }
}

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    ended: false,
    status(code: number) {
      res.statusCode = code
      return res
    },
    json(body: unknown) {
      res.body = body
    },
    setHeader(name: string, value: string) {
      res.headers[name] = value
    },
    end() {
      res.ended = true
    },
  }
  return res
}

const VALID_REF = 'places/abc123/photos/xyz789'

let originalKey: string | undefined

beforeEach(() => {
  originalKey = process.env.GOOGLE_PLACES_API_KEY
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY
  else process.env.GOOGLE_PLACES_API_KEY = originalKey
})

test('rejects a non-GET method', async () => {
  const res = fakeRes()
  await handler(fakeReq({ method: 'POST' }), res)
  assert.equal(res.statusCode, 405)
})

test('returns 404 (no body) when GOOGLE_PLACES_API_KEY is not configured', async () => {
  delete process.env.GOOGLE_PLACES_API_KEY
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.statusCode, 404)
  assert.equal(res.ended, true)
})

test('rejects a malformed photo ref instead of forwarding it into a URL', async () => {
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: '../../etc/passwd' } }), res)
  assert.equal(res.statusCode, 400)
})

test('redirects to the Google CDN location on success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { Location: 'https://lh3.googleusercontent.com/abc' } }))
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.Location, 'https://lh3.googleusercontent.com/abc')
  assert.equal(res.headers['Cache-Control'], 'public, max-age=3600')
})

test('treats a stale/missing photo as a permanent 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.statusCode, 404)
})

test('treats a Google rate-limit/5xx as a transient 502, not a cached 404', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 429 }))
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.statusCode, 502)
})

test('clamps an out-of-range requested width into MIN..MAX', async (t) => {
  let requestedUrl = ''
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requestedUrl = url
    return new Response(null, { status: 302, headers: { Location: 'https://lh3.googleusercontent.com/abc' } })
  })
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF, w: '99999' } }), res)
  assert.match(requestedUrl, /maxWidthPx=1000/)
})
