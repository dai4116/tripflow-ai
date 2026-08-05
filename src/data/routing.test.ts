import assert from 'node:assert/strict'
import test from 'node:test'

import { formatTravelDuration } from './routing.ts'

test('formatTravelDuration shows minutes only under an hour', () => {
  assert.equal(formatTravelDuration(45), '45 分')
})

test('formatTravelDuration shows hours only on an exact hour', () => {
  assert.equal(formatTravelDuration(60), '1 小時')
  assert.equal(formatTravelDuration(120), '2 小時')
})

test('formatTravelDuration shows hours and minutes together', () => {
  assert.equal(formatTravelDuration(80), '1 小時 20分')
})

test('formatTravelDuration handles zero', () => {
  assert.equal(formatTravelDuration(0), '0 分')
})
