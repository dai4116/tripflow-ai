// fetchAskAiResult uses window.setTimeout/clearTimeout — shim `window` to the
// Node global object so it runs under plain `node --test` with no jsdom (see
// aiTripClient.test.ts for the same pattern). fetch/AbortController are
// already real Node globals.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  ;(globalThis as unknown as { window: unknown }).window = globalThis
}

import assert from 'node:assert/strict'
import test from 'node:test'

import { fetchAskAiResult } from './askAiClient.ts'

function mockFetch(t: import('node:test').TestContext, body: unknown, status = 200) {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }))
}

test('returns undefined on a non-2xx response', async (t) => {
  mockFetch(t, {}, 500)
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.equal(result, undefined)
})

test('returns undefined when fetch itself throws', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('network down')
  })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.equal(result, undefined)
})

test('maps a text reply straight through', async (t) => {
  mockFetch(t, { type: 'text', text: '這個行程已經很平均了！' })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.deepEqual(result, { type: 'text', text: '這個行程已經很平均了！' })
})

test('a text reply with a non-string text field falls back to a generic acknowledgement', async (t) => {
  mockFetch(t, { type: 'text', text: 123 })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.deepEqual(result, { type: 'text', text: '了解。' })
})

test('maps a move_place tool call, defaulting message to an empty string when absent', async (t) => {
  mockFetch(t, { type: 'tool_use', name: 'move_place', input: { placeId: 'p1', toColumnId: 'day-2' } })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.deepEqual(result, { type: 'move_place', placeId: 'p1', toColumnId: 'day-2', message: '' })
})

test('maps a remove_place tool call', async (t) => {
  mockFetch(t, { type: 'tool_use', name: 'remove_place', input: { placeId: 'p1', message: '好的，我會移除。' } })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.deepEqual(result, { type: 'remove_place', placeId: 'p1', message: '好的，我會移除。' })
})

test('maps a suggest_places tool call', async (t) => {
  const places = [{ category: 'attraction', name: '清水寺', description: 'd' }]
  mockFetch(t, { type: 'tool_use', name: 'suggest_places', input: { columnId: 'day-1', places } })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.deepEqual(result, { type: 'suggest_places', columnId: 'day-1', places })
})

test('returns undefined for a move_place call missing a required field', async (t) => {
  mockFetch(t, { type: 'tool_use', name: 'move_place', input: { placeId: 'p1' } }) // no toColumnId
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.equal(result, undefined)
})

test('returns undefined for an unrecognized tool name', async (t) => {
  mockFetch(t, { type: 'tool_use', name: 'do_something_else', input: { foo: 'bar' } })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.equal(result, undefined)
})

test('returns undefined for a response that is neither text nor tool_use', async (t) => {
  mockFetch(t, { type: 'something_unexpected' })
  const result = await fetchAskAiResult('hi', '京都', [])
  assert.equal(result, undefined)
})
