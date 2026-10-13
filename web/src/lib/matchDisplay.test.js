import test from 'node:test'
import assert from 'node:assert/strict'
import { matchTime, fileLabel } from './matchDisplay.js'
test('match time displays minutes without inventing or shifting the date', () => {
  assert.equal(matchTime('2026-10-08 15:26:29', 'file_last_modified'), '2026-10-08 15:26')
  assert.equal(matchTime('2026-10-08T15:26:29', 'demo'), '2026-10-08 15:26')
  assert.equal(matchTime('2026-10-08 15:26:29', null), '2026-10-08 15:26 · 导入时间')
  assert.equal(matchTime(null, 'demo'), '时间未知')
  assert.equal(matchTime('broken', 'demo'), '时间未知')
})
test('portable file display strips machine directories', () => {
  assert.equal(fileLabel('C:\\private\\source.dem'), 'source.dem')
  assert.equal(fileLabel('/private/source.dem'), 'source.dem')
})
