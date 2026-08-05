import assert from 'node:assert/strict'
import { mock, test } from 'node:test'

import { geocodeCity, geocodePlace, geocodeRawQuery } from './geocode.ts'

// geocode.ts serializes every lookup through one module-level queue with a
// real 1.1s gap between tasks (Nominatim's rate limit) — fake timers avoid
// paying that in real wall-clock time per test. Enabled once for the whole
// file (not per-test) since the queue itself is shared file-wide state.
mock.timers.enable({ apis: ['setTimeout'] })

// Advances past the queue's inter-task delay and flushes the microtask turns
// its `.then()` chain needs to actually hand off to the next queued task —
// call this after every geocode call that wasn't a cache hit, or the delay
// it leaves pending would stall the very next enqueued call (in this test or
// the next one) instead of firing.
async function drainQueue() {
  mock.timers.tick(1100)
  await Promise.resolve()
  await Promise.resolve()
}

function nominatimResponse(results: { lat: string; lon: string }[]) {
  return new Response(JSON.stringify(results), { status: 200 })
}

test('returns null for a blank query without calling fetch', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return nominatimResponse([])
  })
  assert.equal(await geocodeRawQuery('   '), null)
  assert.equal(calls, 0)
})

test('resolves and caches a successful lookup — a repeat call does not re-fetch', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return nominatimResponse([{ lat: '35.0116', lon: '135.7681' }])
  })
  const query = '清水寺快取測試查詢字串'
  const first = await geocodeRawQuery(query)
  await drainQueue()
  const second = await geocodeRawQuery(query)
  assert.deepEqual(first, { lat: 35.0116, lng: 135.7681 })
  assert.deepEqual(second, { lat: 35.0116, lng: 135.7681 })
  assert.equal(calls, 1)
})

test('a genuine no-match is also cached, not just a successful hit', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return nominatimResponse([])
  })
  const query = '真的查無此地點測試查詢字串'
  assert.equal(await geocodeRawQuery(query), null)
  await drainQueue()
  assert.equal(await geocodeRawQuery(query), null)
  assert.equal(calls, 1)
})

test('a network/non-2xx failure is NOT cached, so a later retry can still succeed', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    if (calls === 1) return new Response('', { status: 500 })
    return nominatimResponse([{ lat: '1', lon: '2' }])
  })

  const query = '暫時失敗後重試測試查詢字串'
  assert.equal(await geocodeRawQuery(query), null)
  await drainQueue() // the module's rate-limit queue gates the retry behind this same gap
  assert.deepEqual(await geocodeRawQuery(query), { lat: 1, lng: 2 })
  assert.equal(calls, 2)
  await drainQueue()
})

test('geocodePlace composes "name, city[, region]"', async (t) => {
  let requestedUrl = ''
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requestedUrl = url
    return nominatimResponse([{ lat: '1', lon: '2' }])
  })
  await geocodePlace('清水寺', '京都', '日本')
  assert.match(decodeURIComponent(requestedUrl), /q=清水寺, 京都, 日本$/)
  await drainQueue()
})

test('geocodePlace falls back to just the name when there is no city', async (t) => {
  let requestedUrl = ''
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requestedUrl = url
    return nominatimResponse([{ lat: '1', lon: '2' }])
  })
  await geocodePlace('清水寺獨立查詢字串', '', '日本')
  assert.match(decodeURIComponent(requestedUrl), /q=清水寺獨立查詢字串, 日本$/)
  await drainQueue()
})

test('geocodeCity composes "city[, region]"', async (t) => {
  let requestedUrl = ''
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    requestedUrl = url
    return nominatimResponse([{ lat: '1', lon: '2' }])
  })
  await geocodeCity('京都市城市查詢字串', '日本')
  assert.match(decodeURIComponent(requestedUrl), /q=京都市城市查詢字串, 日本$/)
  await drainQueue()
})
