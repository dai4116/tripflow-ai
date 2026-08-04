import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addMinutes,
  computeArrivalTimes,
  formatStayDuration,
  hhmmToHours,
  hoursToHHMM,
  minutesBetween,
} from './placeSchedule.ts'

test('addMinutes wraps forward past midnight', () => {
  assert.equal(addMinutes('23:30', 45), '00:15')
})

test('addMinutes wraps backward past midnight for a negative offset', () => {
  assert.equal(addMinutes('00:10', -30), '23:40')
})

test('minutesBetween handles a same-day span', () => {
  assert.equal(minutesBetween('09:00', '10:30'), 90)
})

test('minutesBetween wraps past midnight when end is earlier in the clock than start', () => {
  assert.equal(minutesBetween('23:00', '00:30'), 90)
})

test('formatStayDuration shows minutes only when there is a leftover', () => {
  assert.equal(formatStayDuration(2), '2 小時')
  assert.equal(formatStayDuration(1.5), '1 時 30 分')
  assert.equal(formatStayDuration(0.25), '0 時 15 分')
})

test('hoursToHHMM / hhmmToHours round-trip', () => {
  assert.equal(hoursToHHMM(1.5), '01:30')
  assert.equal(hhmmToHours('01:30'), 1.5)
  assert.equal(hoursToHHMM(0.25), '00:15')
  assert.equal(hhmmToHours('00:15'), 0.25)
})

test('computeArrivalTimes cascades from 08:00 using each place\'s duration', () => {
  const result = computeArrivalTimes([
    { id: 'a', estimatedTime: 1 },
    { id: 'b', estimatedTime: 2 },
  ])
  assert.deepEqual(result, [
    { time: '08:00', hasOverlap: false, hasInvalidDeparture: false },
    { time: '09:00', hasOverlap: false, hasInvalidDeparture: false },
  ])
})

test('computeArrivalTimes never flags the first card as overlapping, even with an early manual arrival', () => {
  const [first] = computeArrivalTimes([{ id: 'a', estimatedTime: 1, arrivalTime: '03:00' }])
  assert.equal(first!.hasOverlap, false)
})

test('computeArrivalTimes flags a manual arrival that lands before the previous card ends', () => {
  const result = computeArrivalTimes([
    { id: 'a', estimatedTime: 1 }, // 08:00 -> 09:00
    { id: 'b', estimatedTime: 1, arrivalTime: '08:30' }, // overlaps a's 09:00 end
  ])
  assert.equal(result[1]!.hasOverlap, true)
})

test('computeArrivalTimes does not flag a manual arrival that lands after the previous card ends', () => {
  const result = computeArrivalTimes([
    { id: 'a', estimatedTime: 1 }, // 08:00 -> 09:00
    { id: 'b', estimatedTime: 1, arrivalTime: '10:00' },
  ])
  assert.equal(result[1]!.hasOverlap, false)
  assert.equal(result[1]!.time, '10:00')
})

test('computeArrivalTimes compares overlap against the latest end seen so far, not just the previous card', () => {
  // a: 08:00 -> 11:00 (long stay, sets maxEnd to 11:00)
  // b: manual 09:00 arrival overlaps a, but b's own stay is short, so b's
  //    departure (09:15) lands BEFORE a's end (11:00) — cursor alone would
  //    under-report the window still open from `a`.
  // c: manual 10:00 arrival is inside a's window (08:00-11:00) but after b's
  //    departure (09:15) — only checking against maxEnd (11:00), not cursor
  //    (09:15), catches this as an overlap.
  const result = computeArrivalTimes([
    { id: 'a', estimatedTime: 3 },
    { id: 'b', estimatedTime: 0.25, arrivalTime: '09:00' },
    { id: 'c', estimatedTime: 1, arrivalTime: '10:00' },
  ])
  assert.equal(result[1]!.hasOverlap, true)
  assert.equal(result[2]!.hasOverlap, true)
})

test('computeArrivalTimes honors a valid departure-mode time', () => {
  const result = computeArrivalTimes([
    { id: 'a', estimatedTime: 1, scheduleMode: 'departure', departureTime: '10:00' },
    { id: 'b', estimatedTime: 1 },
  ])
  assert.equal(result[0]!.hasInvalidDeparture, false)
  assert.equal(result[1]!.time, '10:00')
})

test('computeArrivalTimes falls back to duration-based end when departure-mode time is invalid', () => {
  const result = computeArrivalTimes([
    { id: 'a', estimatedTime: 1, arrivalTime: '09:00', scheduleMode: 'departure', departureTime: '08:30' },
    { id: 'b', estimatedTime: 1 },
  ])
  assert.equal(result[0]!.hasInvalidDeparture, true)
  // duration-based fallback: 09:00 + 1h = 10:00, not the invalid 08:30
  assert.equal(result[1]!.time, '10:00')
})

test('computeArrivalTimes applies travelToNext only when it still points at the actual next place', () => {
  const withMatchingTravel = computeArrivalTimes([
    { id: 'a', estimatedTime: 1, travelToNext: { toPlaceId: 'b', mode: 'driving', durationMin: 15 } },
    { id: 'b', estimatedTime: 1 },
  ])
  assert.equal(withMatchingTravel[1]!.time, '09:15')

  const withStaleTravel = computeArrivalTimes([
    { id: 'a', estimatedTime: 1, travelToNext: { toPlaceId: 'x', mode: 'driving', durationMin: 15 } },
    { id: 'b', estimatedTime: 1 },
  ])
  assert.equal(withStaleTravel[1]!.time, '09:00')
})
