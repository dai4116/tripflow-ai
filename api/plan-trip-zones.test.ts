import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

// @anthropic-ai/sdk's default export is a class whose `.messages.stream()`
// returns a stream-like object with `.finalMessage()`. Mocked once at module
// scope (mock.module can't easily be re-scoped per test) — each test instead
// swaps `currentStream` to control what that call resolves/throws.
type StreamResult = { content: { type: string; text?: string }[] }
let currentStream: () => { finalMessage: () => Promise<StreamResult> } = () => {
  throw new Error('currentStream not configured for this test')
}

mock.module('@anthropic-ai/sdk', {
  defaultExport: class {
    messages = { stream: () => currentStream() }
  },
})

// Mocked so most tests exercise the "allowed" path without needing real KV
// (the unmocked module already degrades to allowed with no KV configured —
// see kv.ts — but mocking here lets the one 429 test below force a block
// deterministically, and asserts on the visitor id the handler forwards).
// Mirrors enforceRateLimit's own contract (writes the 429 itself, returns
// whether the caller should proceed) so the handler's `if (!(await
// enforceRateLimit(...))) return` short-circuits the same way it would for
// real.
let currentRateLimitAllowed = true
let lastRateLimitArgs: { visitorId: string | undefined; rule: unknown } | undefined
mock.module('./_lib/rateLimit.ts', {
  namedExports: {
    enforceRateLimit: async (
      req: { headers?: Record<string, string | string[] | undefined> },
      res: { status: (code: number) => { json: (body: unknown) => void } },
      rule: unknown,
    ) => {
      const visitorIdHeader = req.headers?.['x-visitor-id']
      const visitorId = typeof visitorIdHeader === 'string' ? visitorIdHeader : undefined
      lastRateLimitArgs = { visitorId, rule }
      if (!currentRateLimitAllowed) {
        res.status(429).json({ error: 'rate_limited', message: '目前使用量較高，請稍後再試' })
        return false
      }
      return true
    },
  },
})

const { default: handler } = await import('./plan-trip-zones.ts')

function fakeReq(overrides: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
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

let originalAnthropicKey: string | undefined
let originalGoogleKey: string | undefined

beforeEach(() => {
  originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.GOOGLE_PLACES_API_KEY
  currentRateLimitAllowed = true
  lastRateLimitArgs = undefined
})

afterEach(() => {
  if (originalAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalAnthropicKey
  if (originalGoogleKey === undefined) delete process.env.GOOGLE_PLACES_API_KEY
  else process.env.GOOGLE_PLACES_API_KEY = originalGoogleKey
})

const VALID_BODY = { destination: '京都，日本', totalDays: 3, preferences: ['廟宇', '購物'] }

test('rejects a non-POST method', async () => {
  const res = fakeRes()
  await handler(fakeReq({ method: 'GET' }), res)
  assert.equal(res.statusCode, 405)
})

test('rejects a missing destination', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { totalDays: 3 } }), res)
  assert.equal(res.statusCode, 400)
})

test('rejects an out-of-range totalDays', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: { destination: '京都', totalDays: 31 } }), res)
  assert.equal(res.statusCode, 400)
})

test('rejects an out-of-range or non-integer arrivalDay/departureDay, but accepts a body with neither field at all', async () => {
  const rejected = [
    { ...VALID_BODY, arrivalDay: 0 },
    { ...VALID_BODY, arrivalDay: 4 }, // > totalDays (3)
    { ...VALID_BODY, arrivalDay: 1.5 },
    { ...VALID_BODY, departureDay: 0 },
    { ...VALID_BODY, departureDay: 4 },
  ]
  for (const body of rejected) {
    const res = fakeRes()
    await handler(fakeReq({ body }), res)
    assert.equal(res.statusCode, 400, `expected 400 for ${JSON.stringify(body)}`)
  }

  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res) // no ANTHROPIC_API_KEY -> still fine, best-effort
  assert.equal(res.statusCode, 200)
})

test('is fully best-effort with no API keys configured: still 200, empty zones, null cityCenter', async () => {
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { zones: [], cityCenter: null })
})

test('returns Claude\'s zone plan, dropping an out-of-range day and a hallucinated preference', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  currentStream = textStream({
    days: [
      { day: 1, zone: '清水寺周邊', focus: '古蹟', assignedPreferences: ['廟宇'] },
      { day: 1, zone: '重複的第一天', focus: 'x', assignedPreferences: ['幻想出來的偏好'] }, // not in ctx.preferences
      { day: 99, zone: '超出範圍', focus: 'x', assignedPreferences: [] }, // totalDays is 3
    ],
  })
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { zones: { day: number; assignedPreferences: string[] }[] }
  assert.equal(body.zones.length, 2) // day 99 dropped
  assert.deepEqual(body.zones[0]!.assignedPreferences, ['廟宇'])
  assert.deepEqual(body.zones[1]!.assignedPreferences, []) // hallucinated preference filtered out
})

test('degrades to empty zones (not an error response) when the Claude call throws', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  currentStream = () => ({
    finalMessage: async () => {
      throw new Error('upstream boom')
    },
  })
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { zones: [], cityCenter: null })
})

test('returns 429 without ever calling Claude when the rate limiter blocks the request', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  currentRateLimitAllowed = false
  let streamCalled = false
  currentStream = () => {
    streamCalled = true
    return { finalMessage: async () => ({ content: [] }) }
  }
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 429)
  assert.equal((res.body as { error?: string }).error, 'rate_limited')
  assert.equal(streamCalled, false)
})

test('forwards the X-Visitor-Id header to the rate limiter', async () => {
  await handler(fakeReq({ body: VALID_BODY, headers: { 'x-visitor-id': 'visitor-42' } }), fakeRes())
  assert.equal(lastRateLimitArgs?.visitorId, 'visitor-42')
})

test('rate limiter runs before body validation — a blocked request never reaches the 400 checks', async () => {
  currentRateLimitAllowed = false
  const res = fakeRes()
  await handler(fakeReq({ body: { destination: '' } }), res) // would otherwise 400 (missing destination)
  assert.equal(res.statusCode, 429)
})

test('resolves both zones and cityCenter together when both API keys are configured', async (t) => {
  process.env.ANTHROPIC_API_KEY = 'test-key'
  process.env.GOOGLE_PLACES_API_KEY = 'test-key'
  currentStream = textStream({ days: [{ day: 1, zone: 'z', focus: 'f', assignedPreferences: [] }] })
  t.mock.method(globalThis, 'fetch', async () =>
    new Response(JSON.stringify({ places: [{ id: 'c1', location: { latitude: 35, longitude: 135 } }] }), { status: 200 }),
  )
  const res = fakeRes()
  await handler(fakeReq({ body: VALID_BODY }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { zones: unknown[]; cityCenter: { lat: number; lng: number } | null }
  assert.equal(body.zones.length, 1)
  assert.deepEqual(body.cityCenter, { lat: 35, lng: 135 })
})
