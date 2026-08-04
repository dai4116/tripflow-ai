import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'

type CreateResult = { content: unknown[] }
let currentCreate: () => Promise<CreateResult> = () => {
  throw new Error('currentCreate not configured for this test')
}

mock.module('@anthropic-ai/sdk', {
  defaultExport: class {
    messages = { create: () => currentCreate() }
  },
})

const { default: handler } = await import('./ask-ai.ts')

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
  originalKey = process.env.ANTHROPIC_API_KEY
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY
  else process.env.ANTHROPIC_API_KEY = originalKey
})

const BASE_BODY = { message: '把清水寺搬到第 2 天', destination: '京都，日本', columns: [{ id: 'day-1', dayNumber: 1, title: '第1天', places: [] }] }

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

test('rejects a blank message or a non-array columns', async () => {
  const res1 = fakeRes()
  await handler(fakeReq({ body: { ...BASE_BODY, message: '   ' } }), res1)
  assert.equal(res1.statusCode, 400)

  const res2 = fakeRes()
  await handler(fakeReq({ body: { ...BASE_BODY, columns: undefined } }), res2)
  assert.equal(res2.statusCode, 400)
})

test('a suggest_places tool call has its place names cleaned of bilingual duplication', async () => {
  currentCreate = async () => ({
    content: [
      {
        type: 'tool_use',
        name: 'suggest_places',
        input: {
          columnId: 'day-1',
          places: [{ category: 'attraction', name: 'Chatuchak Weekend Market（洽圖洽週末市場）', geocodeQuery: 'q', description: 'd' }],
        },
      },
    ],
  })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 200)
  const body = res.body as { type: string; name: string; input: { places: { name: string }[] } }
  assert.equal(body.type, 'tool_use')
  assert.equal(body.input.places[0]!.name, '洽圖洽週末市場')
})

test('a move_place tool call is passed through as-is', async () => {
  currentCreate = async () => ({
    content: [{ type: 'tool_use', name: 'move_place', input: { placeId: 'p1', toColumnId: 'day-2', message: '好的' } }],
  })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { type: 'tool_use', name: 'move_place', input: { placeId: 'p1', toColumnId: 'day-2', message: '好的' } })
})

test('a plain text reply (no tool call) is returned as type: text', async () => {
  currentCreate = async () => ({ content: [{ type: 'text', text: '這個行程已經很平均了！' }] })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { type: 'text', text: '這個行程已經很平均了！' })
})

test('falls back to a generic acknowledgement when there is neither a tool call nor a text block', async () => {
  currentCreate = async () => ({ content: [] })
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, { type: 'text', text: '了解。' })
})

test('returns 502 when the Claude call throws', async () => {
  currentCreate = async () => {
    throw new Error('boom')
  }
  const res = fakeRes()
  await handler(fakeReq({ body: BASE_BODY }), res)
  assert.equal(res.statusCode, 502)
})
