import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

type StreamResult = {
  content: { type: string; text?: string }[]
  usage: { cache_read_input_tokens: number | null; cache_creation_input_tokens: number | null }
}
let currentStream: () => { finalMessage: () => Promise<StreamResult> } = () => {
  throw new Error('currentStream not configured for this test')
}

mock.module('@anthropic-ai/sdk', {
  defaultExport: class {
    messages = { stream: () => currentStream() }
  },
})

const { default: handler } = await import('./generate-trip-day.ts')

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

function textStream(payload: unknown) {
  return () => ({
    finalMessage: async () => ({
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      // The real SDK always returns usage on a successful response — this
      // mock fills it in so the handler's cache-hit log line (see
      // generate-trip-day.ts) doesn't crash on a field real responses always
      // have. Values here are arbitrary; no test asserts on them.
      usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
  })
}

type Candidate = { day: number; category: string; name: string; geocodeQuery: string; description: string; estimatedTimeHours: number }
function candidate(name: string, day: number, geocodeQuery = name): Candidate {
  return { day, category: 'attraction', name, geocodeQuery, description: 'd', estimatedTimeHours: 1.5 }
}

let originalAnthropicKey: string | undefined
let originalGoogleKey: string | undefined

beforeEach(() => {
  originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY
  process.env.ANTHROPIC_API_KEY = 'test-key'
  delete process.env.GOOGLE_PLACES_API_KEY
})

afterEach(() => {
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey
  if (originalGoogleKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY
  else process.env.GOOGLE_PLACES_API_KEY = originalGoogleKey
})

const BASE_BODY = { destination: '京都，日本', totalDays: 3, targetPlaceCount: 2, day: 2 }

test('rejects a non-POST method', async () => {
  const res = fakeRes()
  await handler(fakeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
})

test('returns 500 when ANTHROPIC_API_KEY is not configured', async () => {
  delete process.env.ANTHROPIC_API_KEY
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 500)
})

test('validates destination, totalDays, targetPlaceCount, and day', async () => {
  const cases = [
    { ...BASE_BODY, destination: '' },
    { ...BASE_BODY, totalDays: 0 },
    { ...BASE_BODY, targetPlaceCount: 0 },
    { ...BASE_BODY, targetPlaceCount: 11 },
    { ...BASE_BODY, day: 0 },
    { ...BASE_BODY, day: 4 }, // > totalDays
  ]
  for (const body of cases) {
    const res = fakeRes()
    await handler(fakeReq({ body }), res)
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`)
  }
})

test('rejects a malformed, non-HH:mm, or reversed windowStart/windowEnd, but accepts a body with neither field at all', async () => {
  const rejected = [
    { ...BASE_BODY, windowStart: 'not-a-time', windowEnd: '19:00' },
    { ...BASE_BODY, windowStart: '08:00', windowEnd: '25:00' },
    { ...BASE_BODY, windowStart: '19:00', windowEnd: '08:00' }, // reversed
    { ...BASE_BODY, windowStart: '08:00' }, // windowEnd missing
  ]
  for (const body of rejected) {
    const res = fakeRes()
    await handler(fakeReq({ body }), res)
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`)
  }

  // Neither field present at all — an old/malformed client body predating
  // day-length windows — degrades gracefully to the full-day default instead
  // of 400ing.
  currentStream = textStream({ places: [candidate('A', 2)] })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 200)
})

test('force-corrects every candidate\'s day to the requested day, regardless of what the model returned', async () => {
  currentStream = textStream({
    places: [candidate('A', 2), candidate('B', 5), candidate('C', 1)], // day 2 requested; B and C are mistagged
  })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res) // no GOOGLE_PLACES_API_KEY -> raw AI list, unverified
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: { day: number; name: string }[] }
  assert.equal(body.places.length, 3)
  assert.ok(body.places.every((p) => p.day === 2))
})

test('with no GOOGLE_PLACES_API_KEY, returns the full over-asked AI list uncapped and without coordinates', async () => {
  currentStream = textStream({ places: [candidate('A', 2), candidate('B', 2), candidate('C', 2), candidate('D', 2)] })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res) // targetPlaceCount: 2, but 4 candidates
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: unknown[] }
  assert.equal(body.places.length, 4)
})

test('with a Google key: verifies, dedups same-place candidates, and keeps every other verified survivor (no exact-count cap anymore)', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  currentStream = textStream({
    places: [candidate('A', 2, 'query-a'), candidate('B-dup-of-A', 2, 'query-b'), candidate('C', 2, 'query-c'), candidate('D', 2, 'query-d')],
  })
  const QUERY_RESULTS: Record<string, { id: string; lat: number; lng: number }> = {
    'query-a': { id: 'google-1', lat: 35, lng: 135 },
    'query-b': { id: 'google-1', lat: 35, lng: 135 }, // same real place as A
    'query-c': { id: 'google-2', lat: 35.0001, lng: 135.0001 },
    'query-d': { id: 'google-3', lat: 35.0001, lng: 135.0001 },
  }
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const { textQuery } = JSON.parse(init.body as string) as { textQuery: string }
    const hit = QUERY_RESULTS[textQuery]
    if (!hit) return new Response(JSON.stringify({ places: [] }), { status: 200 })
    return new Response(JSON.stringify({ places: [{ id: hit.id, displayName: { text: textQuery }, location: { latitude: hit.lat, longitude: hit.lng } }] }), { status: 200 })
  })
  const res = fakeRes()
  await handler(fakeReq({ body: { ...BASE_BODY, targetPlaceCount: 2 } }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: { placeId: string }[] }
  // B is deduped (same placeId as A). The precise trim to the day's real
  // duration budget now happens client-side in generateTrip.ts, so with
  // targetPlaceCount=2 the server's loose ceiling (targetPlaceCount +
  // PER_DAY_BUFFER = 4) doesn't drop C or D — all 3 surviving places come back.
  assert.deepEqual(body.places.map((p) => p.placeId), ['google-1', 'google-2', 'google-3'])
})

test('the accept ceiling is targetPlaceCount + PER_DAY_BUFFER with no further clamp, even for a packed-pace targetPlaceCount past the client-side hard max', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  // targetPlaceCount(10) + PER_DAY_BUFFER(2) = 12, past the client's own
  // HARD_MAX_PLACES_PER_DAY(7) — no longer clamped down to 7 here (see
  // overAskCountFor's own comment: the old clamp zeroed out exactly the
  // buffer packed-pace days need most, forcing an avoidable backfill round
  // on any ordinary verification attrition). The client's own duration-
  // budget walk in generateTrip.ts still does the real trim downstream.
  const names = Array.from({ length: 12 }, (_, i) => `P${i}`)
  currentStream = textStream({ places: names.map((name) => candidate(name, 2, name)) })
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const { textQuery } = JSON.parse(init.body as string) as { textQuery: string }
    return new Response(
      JSON.stringify({ places: [{ id: `g-${textQuery}`, displayName: { text: textQuery }, location: { latitude: 35, longitude: 135 } }] }),
      { status: 200 },
    )
  })
  const res = fakeRes()
  await handler(fakeReq({ body: { ...BASE_BODY, targetPlaceCount: 10 } }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: unknown[] }
  assert.equal(body.places.length, 12)
})

test('photo fetches are limited to the first targetPlaceCount accepted places, leaving the PER_DAY_BUFFER backups without a photoRef', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  // targetPlaceCount=2, PER_DAY_BUFFER=2 -> overAskCount=4. All 4 verify to
  // the same coordinates (so none are dropped by the geographic-anchor
  // filter), isolating the photo-fetch trim as the only thing that can
  // leave a later candidate without a photoRef.
  // Query strings distinct from any other test's in this file — placesVerify.ts's
  // module-level cache Map persists across tests in the same process, so
  // reusing another test's exact query string would silently return that
  // test's stale cached result instead of hitting this test's own mock.
  currentStream = textStream({
    places: [
      candidate('A', 2, 'photo-trim-query-a'),
      candidate('B', 2, 'photo-trim-query-b'),
      candidate('C', 2, 'photo-trim-query-c'),
      candidate('D', 2, 'photo-trim-query-d'),
    ],
  })
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'GET') {
      // getPlaceCoverPhotos — placeId is the last URL segment.
      const placeId = decodeURIComponent(url.split('/places/')[1]!)
      return new Response(JSON.stringify({ photos: [{ name: `photo-for-${placeId}` }] }), { status: 200 })
    }
    const { textQuery } = JSON.parse(init!.body as string) as { textQuery: string }
    return new Response(
      JSON.stringify({ places: [{ id: `google-${textQuery}`, displayName: { text: textQuery }, location: { latitude: 35, longitude: 135 } }] }),
      { status: 200 },
    )
  })
  const res = fakeRes()
  await handler(fakeReq({ body: { ...BASE_BODY, targetPlaceCount: 2 } }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: { photoRef?: string }[] }
  assert.equal(body.places.length, 4)
  // Confidence order (A, B, C, D) is preserved through dedup/anchor
  // filtering — A and B (the first targetPlaceCount=2) get a photoRef; C
  // and D (the PER_DAY_BUFFER backups) don't.
  assert.deepEqual(
    body.places.map((p) => Boolean(p.photoRef)),
    [true, true, false, false],
  )
})

test('the first accepted candidate becomes the day anchor when no existingAnchor is given, dropping far-away later candidates', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  // Confidence order deliberately puts the geographic outlier first.
  currentStream = textStream({
    places: [candidate('Outlier', 2, 'q-outlier'), candidate('Near1', 2, 'q-near1'), candidate('Near2', 2, 'q-near2')],
  })
  const QUERY_RESULTS: Record<string, { id: string; lat: number; lng: number }> = {
    'q-outlier': { id: 'g-outlier', lat: 35, lng: 135.5 }, // ~45km from the "near" cluster
    'q-near1': { id: 'g-near1', lat: 35, lng: 135.001 },
    'q-near2': { id: 'g-near2', lat: 35, lng: 135.002 },
  }
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const { textQuery } = JSON.parse(init.body as string) as { textQuery: string }
    const hit = QUERY_RESULTS[textQuery]!
    return new Response(JSON.stringify({ places: [{ id: hit.id, displayName: { text: textQuery }, location: { latitude: hit.lat, longitude: hit.lng } }] }), { status: 200 })
  })
  const res = fakeRes()
  await handler(fakeReq({ body: { ...BASE_BODY, targetPlaceCount: 3 } }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: { placeId: string }[] }
  // Outlier became the anchor (first accepted); both real near-cluster places got dropped as "too far" from it.
  assert.deepEqual(body.places.map((p) => p.placeId), ['g-outlier'])
})

test('existingAnchor (a backfill request) overrides confidence-order anchoring, keeping the day geographically consistent', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  currentStream = textStream({
    places: [candidate('Outlier', 2, 'q-outlier'), candidate('Near1', 2, 'q-near1'), candidate('Near2', 2, 'q-near2')],
  })
  const QUERY_RESULTS: Record<string, { id: string; lat: number; lng: number }> = {
    'q-outlier': { id: 'g-outlier', lat: 35, lng: 135.5 },
    'q-near1': { id: 'g-near1', lat: 35, lng: 135.001 },
    'q-near2': { id: 'g-near2', lat: 35, lng: 135.002 },
  }
  t.mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    const { textQuery } = JSON.parse(init.body as string) as { textQuery: string }
    const hit = QUERY_RESULTS[textQuery]!
    return new Response(JSON.stringify({ places: [{ id: hit.id, displayName: { text: textQuery }, location: { latitude: hit.lat, longitude: hit.lng } }] }), { status: 200 })
  })
  const res = fakeRes()
  await handler(fakeReq({ body: { ...BASE_BODY, targetPlaceCount: 3, existingAnchor: { lat: 35, lng: 135 } } }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: { placeId: string }[] }
  // With the anchor fixed near the "near" cluster from the start, the
  // outlier is dropped instead of hijacking the day's geography.
  assert.deepEqual(body.places.map((p) => p.placeId).sort(), ['g-near1', 'g-near2'])
})

test('returns 502 when nothing verifies', async (t) => {
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  currentStream = textStream({ places: [candidate('A', 2), candidate('B', 2)] })
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ places: [] }), { status: 200 }))
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 502)
})

test('returns 502 when the Claude call itself fails', async () => {
  currentStream = () => ({
    finalMessage: async () => {
      throw new Error('boom')
    },
  })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 502)
})
