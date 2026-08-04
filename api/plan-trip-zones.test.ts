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

const { default: handler } = await import('./plan-trip-zones.ts')

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

let originalAnthropicKey: string | undefined
let originalGoogleKey: string | undefined

beforeEach(() => {
  originalAnthropicKey = process.env.ANTHROPIC_API_KEY
  originalGoogleKey = process.env.GOOGLE_PLACES_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.GOOGLE_PLACES_API_KEY
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
