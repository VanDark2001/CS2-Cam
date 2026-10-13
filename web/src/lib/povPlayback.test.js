import test from 'node:test'
import assert from 'node:assert/strict'
import { povPlaybackSeconds, povPlaybackTick, isPovAutomaticPause } from './povPlayback.js'

test('short and full POVs share time zero and seek directly to round time', () => {
  assert.equal(povPlaybackSeconds(1300, 1300), 0)
  assert.equal(povPlaybackSeconds(1300 + 5 * 64, 1300), 5)
  assert.equal(povPlaybackTick(5, 1300, 6300), 1620)
  assert.equal(povPlaybackTick(100, 1300, 6300), 6300)
  assert.equal(povPlaybackTick(-1, 1300, 6300), 1300)
})

test('an ended thumbnail must not pause longer POVs or the round clock', () => {
  const thumbnail = { ended: true }, overlay = { ended: false }
  assert.equal(isPovAutomaticPause(thumbnail), true)
  assert.equal(isPovAutomaticPause(overlay), false)
  assert.equal(isPovAutomaticPause(overlay, true), true)
  assert.equal(isPovAutomaticPause({ ended: false }), false)
})

test('time conversion respects demo tick rate', () => {
  assert.equal(povPlaybackSeconds(256, 128, 128), 1)
  assert.equal(povPlaybackTick(1, 128, 512, 128), 256)
})
