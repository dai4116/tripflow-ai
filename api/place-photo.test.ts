import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

// Mocked (rather than relying on KV_REST_API_URL/TOKEN being unset, which is
// how the rest of this file exercises the "no cache configured" path) so the
// cache-hit/cache-write tests below can control exactly what a lookup
// returns and assert on exactly what gets written, independent of a real
// Redis connection. Mutable per-test via currentKvGet/currentKvSet rather
// than re-registering the mock (mock.module can't easily be re-scoped per
// test — same reasoning as ask-ai.test.ts's currentCreate).
let currentKvGet: (key: string) => Promise<unknown> = async () => undefined
let kvSetCalls: Array<{ key: string; value: unknown; ttlSeconds: number }> = []

mock.module('./_lib/kv.ts', {
  namedExports: {
    kvGet: (key: string) => currentKvGet(key),
    kvSet: (key: string, value: unknown, ttlSeconds: number) => {
      kvSetCalls.push({ key, value, ttlSeconds })
    },
  },
})

const { default: handler } = await import('./place-photo.ts')

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
  currentKvGet = async () => undefined
  kvSetCalls = []
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

test('serves a cached redirect location without calling Google', async (t) => {
  currentKvGet = async (key) => {
    assert.equal(key, 'media:places/abc123/photos/xyz789:240')
    return { location: 'https://lh3.googleusercontent.com/cached', cachedAt: Date.now() }
  }
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not be called on a cache hit')
  })
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.Location, 'https://lh3.googleusercontent.com/cached')
  assert.equal(res.headers['Cache-Control'], 'public, max-age=3600')
})

test('scopes a cache hit\'s browser Cache-Control to what\'s actually left of the 1-hour budget, not a fresh hour', async (t) => {
  const fortyMinutesAgo = Date.now() - 40 * 60 * 1000
  currentKvGet = async () => ({ location: 'https://lh3.googleusercontent.com/cached', cachedAt: fortyMinutesAgo })
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not be called on a cache hit')
  })
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.headers['Cache-Control'], 'public, max-age=1200') // 3600 - 40*60
})

test('floors a near-expiry cache hit\'s Cache-Control instead of handing the browser max-age=0', async (t) => {
  const almostAnHourAgo = Date.now() - 59 * 60 * 1000
  currentKvGet = async () => ({ location: 'https://lh3.googleusercontent.com/cached', cachedAt: almostAnHourAgo })
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not be called on a cache hit')
  })
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.headers['Cache-Control'], 'public, max-age=60')
})

test('serves a cached negative (stale ref) as 404 without calling Google', async (t) => {
  currentKvGet = async () => null
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not be called on a cache hit')
  })
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(res.statusCode, 404)
})

test('caches the resolved redirect on a successful fetch, tagged with when it was resolved', async (t) => {
  const before = Date.now()
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { Location: 'https://lh3.googleusercontent.com/abc' } }))
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.equal(kvSetCalls.length, 1)
  const call = kvSetCalls[0]
  assert.equal(call.key, 'media:places/abc123/photos/xyz789:240')
  assert.equal(call.ttlSeconds, 50 * 60)
  const value = call.value as { location: string; cachedAt: number }
  assert.equal(value.location, 'https://lh3.googleusercontent.com/abc')
  assert.ok(value.cachedAt >= before && value.cachedAt <= Date.now())
})

test('caches a stale/missing photo as a negative with a short TTL, not just answering 404 fresh every time', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 404 }))
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  // Short (5 min), not MEDIA_CACHE_TTL_SECONDS' 50 min — Google can't tell us
  // "this ref is stale" apart from "the API key just broke", so a negative
  // shouldn't be able to lock a config-level outage in for nearly an hour.
  assert.deepEqual(kvSetCalls, [{ key: 'media:places/abc123/photos/xyz789:240', value: null, ttlSeconds: 5 * 60 }])
})

test('does not cache a transient rate-limit/5xx — a bad moment must not become a 50-minute outage', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 429 }))
  const res = fakeRes()
  await handler(fakeReq({ query: { ref: VALID_REF } }), res)
  assert.deepEqual(kvSetCalls, [])
})
