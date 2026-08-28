import assert from 'node:assert/strict'
import { beforeEach, mock, test } from 'node:test'

// Mocked so each test controls exactly what kvIncr returns per key, without
// a real Redis connection — same reasoning as place-photo.test.ts's kv.ts
// mock. Keyed by the Redis key string so a test can give different counts to
// the three independent counters (global/session-day/session-10min) in one
// call.
let counts: Record<string, number | undefined> = {}
const incrCalls: Array<{ key: string; ttlSeconds: number }> = []

mock.module('./kv.ts', {
  namedExports: {
    kvIncr: async (key: string, ttlSeconds: number) => {
      incrCalls.push({ key, ttlSeconds })
      return counts[key]
    },
  },
})

const { checkRateLimit, enforceRateLimit } = await import('./rateLimit.ts')

const RULE = { endpoint: 'test-endpoint', sessionPer10Min: 3, sessionPerDay: 8, globalPerDay: 40 }

beforeEach(() => {
  counts = {}
  incrCalls.length = 0
})

function keysFor(visitorId: string | undefined) {
  const today = new Date().toISOString().slice(0, 10)
  return {
    global: `ratelimit:global:${RULE.endpoint}:${today}`,
    sessionDay: visitorId ? `ratelimit:sessionday:${RULE.endpoint}:${visitorId}:${today}` : undefined,
    session10: visitorId ? `ratelimit:session10:${RULE.endpoint}:${visitorId}` : undefined,
  }
}

test('allows a request comfortably under every limit', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 5
  counts[keys.sessionDay!] = 2
  counts[keys.session10!] = 1

  const result = await checkRateLimit('visitor-1', RULE)
  assert.equal(result.allowed, true)
})

test('blocks once the global daily count exceeds the limit', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 41 // > 40
  counts[keys.sessionDay!] = 1
  counts[keys.session10!] = 1

  const result = await checkRateLimit('visitor-1', RULE)
  assert.equal(result.allowed, false)
})

test('blocks once the per-visitor daily count exceeds the limit, even with global headroom', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 5
  counts[keys.sessionDay!] = 9 // > 8
  counts[keys.session10!] = 1

  const result = await checkRateLimit('visitor-1', RULE)
  assert.equal(result.allowed, false)
})

test('blocks once the per-visitor 10-minute burst count exceeds the limit', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 5
  counts[keys.sessionDay!] = 2
  counts[keys.session10!] = 4 // > 3

  const result = await checkRateLimit('visitor-1', RULE)
  assert.equal(result.allowed, false)
})

test('a value exactly at the limit is still allowed — only exceeding it blocks', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 40
  counts[keys.sessionDay!] = 8
  counts[keys.session10!] = 3

  const result = await checkRateLimit('visitor-1', RULE)
  assert.equal(result.allowed, true)
})

test('with no visitor id, only the global counter is checked — session counters are never incremented', async () => {
  const keys = keysFor(undefined)
  counts[keys.global] = 5

  const result = await checkRateLimit(undefined, RULE)
  assert.equal(result.allowed, true)
  assert.equal(
    incrCalls.some((call) => call.key.startsWith('ratelimit:sessionday:') || call.key.startsWith('ratelimit:session10:')),
    false,
  )
})

test('a missing visitor id still enforces the global cap', async () => {
  const keys = keysFor(undefined)
  counts[keys.global] = 41

  const result = await checkRateLimit(undefined, RULE)
  assert.equal(result.allowed, false)
})

// kvIncr returning undefined is its own "KV unavailable / not configured"
// signal (see kv.ts) — checkRateLimit must treat that as "can't enforce this
// counter" and fail open, not as a satisfied (0-ish) count.
test('degrades to allowed when KV is unavailable for every counter', async () => {
  // counts left empty — every kvIncr call resolves to undefined
  const result = await checkRateLimit('visitor-1', RULE)
  assert.equal(result.allowed, true)
})

test('still blocks on the one counter KV can answer even if others are unavailable', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 999 // only this one is "available" and over limit
  // sessionDay/session10 left undefined (KV unavailable for those keys)

  const result = await checkRateLimit('visitor-1', RULE)
  assert.equal(result.allowed, false)
})

test('every call increments all three counters regardless of order', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 1
  counts[keys.sessionDay!] = 1
  counts[keys.session10!] = 1

  await checkRateLimit('visitor-1', RULE)

  const incrementedKeys = incrCalls.map((call) => call.key)
  assert.ok(incrementedKeys.includes(keys.global))
  assert.ok(incrementedKeys.includes(keys.sessionDay!))
  assert.ok(incrementedKeys.includes(keys.session10!))
})

test('session-10min TTL is fixed at 10 minutes regardless of the rule', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.session10!] = 1

  await checkRateLimit('visitor-1', RULE)

  const session10Call = incrCalls.find((call) => call.key === keys.session10)
  assert.equal(session10Call?.ttlSeconds, 10 * 60)
})

test('different visitors get independent counters', async () => {
  const keysA = keysFor('visitor-a')
  const keysB = keysFor('visitor-b')
  counts[keysA.global] = 1
  counts[keysA.sessionDay!] = 9 // visitor A over their own limit
  counts[keysB.global] = 1
  counts[keysB.sessionDay!] = 1 // visitor B well under

  const resultA = await checkRateLimit('visitor-a', RULE)
  const resultB = await checkRateLimit('visitor-b', RULE)

  assert.equal(resultA.allowed, false)
  assert.equal(resultB.allowed, true)
})

// generate-trip-day.ts's rule omits sessionPer10Min/sessionPerDay entirely
// (global-only backstop — see its own comment for why).
const GLOBAL_ONLY_RULE = { endpoint: 'global-only-endpoint', globalPerDay: 200 }

test('a rule with no sessionPer10Min/sessionPerDay never touches the session counters', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const globalKey = `ratelimit:global:${GLOBAL_ONLY_RULE.endpoint}:${today}`
  counts[globalKey] = 5

  const result = await checkRateLimit('visitor-1', GLOBAL_ONLY_RULE)
  assert.equal(result.allowed, true)
  assert.equal(
    incrCalls.some((call) => call.key.startsWith('ratelimit:sessionday:') || call.key.startsWith('ratelimit:session10:')),
    false,
  )
})

test('a rule with no session limits still enforces its global cap', async () => {
  const today = new Date().toISOString().slice(0, 10)
  const globalKey = `ratelimit:global:${GLOBAL_ONLY_RULE.endpoint}:${today}`
  counts[globalKey] = 201 // > 200

  const result = await checkRateLimit('visitor-1', GLOBAL_ONLY_RULE)
  assert.equal(result.allowed, false)
})

function fakeRes() {
  const calls: { status?: number; body?: unknown } = {}
  const res = {
    status: (code: number) => {
      calls.status = code
      return { json: (body: unknown) => { calls.body = body } }
    },
  }
  return { res, calls }
}

test('enforceRateLimit reads the visitor id from the x-visitor-id header', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 1
  counts[keys.sessionDay!] = 1
  counts[keys.session10!] = 1

  const { res } = fakeRes()
  const allowed = await enforceRateLimit({ headers: { 'x-visitor-id': 'visitor-1' } }, res, RULE)

  assert.equal(allowed, true)
  const incrementedKeys = incrCalls.map((call) => call.key)
  assert.ok(incrementedKeys.includes(keys.sessionDay!))
})

test('enforceRateLimit returns false and writes a 429 with a generic message when blocked', async () => {
  const keys = keysFor('visitor-1')
  counts[keys.global] = 999
  counts[keys.sessionDay!] = 1
  counts[keys.session10!] = 1

  const { res, calls } = fakeRes()
  const allowed = await enforceRateLimit({ headers: { 'x-visitor-id': 'visitor-1' } }, res, RULE)

  assert.equal(allowed, false)
  assert.equal(calls.status, 429)
  assert.deepEqual(calls.body, { error: 'rate_limited', message: '目前使用量較高，請稍後再試' })
})

test('enforceRateLimit tolerates a missing headers object entirely', async () => {
  const keys = keysFor(undefined)
  counts[keys.global] = 1

  const { res } = fakeRes()
  const allowed = await enforceRateLimit({}, res, RULE)

  assert.equal(allowed, true)
})
