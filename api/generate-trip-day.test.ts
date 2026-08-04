import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

type StreamResult = { content: { type: string; text?: string }[] }
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
  return () => ({ finalMessage: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }) })
}

type Candidate = { day: number; category: string; name: string; geocodeQuery: string; description: string }
function candidate(name: string, day: number, geocodeQuery = name): Candidate {
  return { day, category: 'attraction', name, geocodeQuery, description: 'd' }
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

const BASE_BODY = { destination: '京都，日本', totalDays: 3, placesPerDay: 2, day: 2 }

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

test('validates destination, totalDays, placesPerDay, and day', async () => {
  const cases = [
    { ...BASE_BODY, destination: '' },
    { ...BASE_BODY, totalDays: 0 },
    { ...BASE_BODY, placesPerDay: 0 },
    { ...BASE_BODY, placesPerDay: 11 },
    { ...BASE_BODY, day: 0 },
    { ...BASE_BODY, day: 4 }, // > totalDays
  ]
  for (const body of cases) {
    const res = fakeRes()
    await handler(fakeReq({ body }), res)
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`)
  }
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
  await handler(fakeReq({ body: BASE_BODY }), res) // placesPerDay: 2, but 4 candidates
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: unknown[] }
  assert.equal(body.places.length, 4)
})

test('with a Google key: verifies, dedups same-place candidates, and caps at placesPerDay in confidence order', async (t) => {
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
  await handler(fakeReq({ body: { ...BASE_BODY, placesPerDay: 2 } }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { places: { placeId: string }[] }
  // A wins (first), B is deduped (same placeId as A), C fills the 2nd slot, D never needed.
  assert.deepEqual(body.places.map((p) => p.placeId), ['google-1', 'google-2'])
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
  await handler(fakeReq({ body: { ...BASE_BODY, placesPerDay: 3 } }), res)
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
  await handler(fakeReq({ body: { ...BASE_BODY, placesPerDay: 3, existingAnchor: { lat: 35, lng: 135 } } }), res)
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
