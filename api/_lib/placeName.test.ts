import assert from 'node:assert/strict'
import test from 'node:test'

import { stripBilingualName } from './placeName.ts'

test('collapses a duplicated English and Chinese place name to Chinese', () => {
  assert.equal(stripBilingualName('Chatuchak Weekend Market（洽圖洽週末市場）'), '洽圖洽週末市場')
  assert.equal(stripBilingualName('洽圖洽週末市場 (Chatuchak Weekend Market)'), '洽圖洽週末市場')
})

test('keeps an official English-only name', () => {
  assert.equal(stripBilingualName('Wall Street English'), 'Wall Street English')
})

test('keeps Chinese branch and campus qualifiers on an English brand', () => {
  assert.equal(
    stripBilingualName('Wall Street English（信義分校）'),
    'Wall Street English（信義分校）',
  )
  assert.equal(stripBilingualName('EF English First（台北校區）'), 'EF English First（台北校區）')
  assert.equal(stripBilingualName('ABC Cooking Studio（台北教室）'), 'ABC Cooking Studio（台北教室）')
  assert.equal(stripBilingualName('7-ELEVEN（信義店）'), '7-ELEVEN（信義店）')
})

test('keeps a normal Chinese branch annotation', () => {
  assert.equal(stripBilingualName('鼎泰豐（信義店）'), '鼎泰豐（信義店）')
})

test('does not mistake an ambiguous Chinese annotation for a translation', () => {
  assert.equal(stripBilingualName('RAW（台北）'), 'RAW（台北）')
  assert.equal(stripBilingualName('Apple（蘋果）'), 'Apple（蘋果）')
})
