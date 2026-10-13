import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { radarMetadata, isRadarImage } from './radarAssets.js'
import { radarPoint } from './replayRadar.js'

test('all bundled radars are 1024px square PNGs, not the map badges', () => {
  for (const map of Object.keys(radarMetadata)) {
    const radar = readFileSync(new URL(`../../public/maps/radar/${map}.png`, import.meta.url))
    const badge = readFileSync(new URL(`../../public/maps/${map}.png`, import.meta.url))
    assert.equal(radar.subarray(1, 4).toString(), 'PNG', map)
    assert.equal(radar.readUInt32BE(16), 1024, map)
    assert.equal(radar.readUInt32BE(20), 1024, map)
    assert.equal(radar.equals(badge), false, `${map} must not be its badge`)
  }
})
test('runtime rejects badges, failed images and non-square textures', () => {
  const image = { complete: true, naturalWidth: 1024, naturalHeight: 1024 }
  assert.equal(isRadarImage(image), true)
  for (const invalid of [null, { ...image, complete: false }, { ...image, naturalWidth: 512, naturalHeight: 512 }, { ...image, naturalHeight: 512 }]) assert.equal(isRadarImage(invalid), false)
})
test('Anubis and current Train use their own game overview coordinates', () => {
  assert.deepEqual(radarMetadata.de_anubis, { x: -2796, y: 3328, scale: 5.22 })
  assert.deepEqual(radarMetadata.de_train, { x: -2308, y: 2078, scale: 4.082077 })
  for (const meta of Object.values(radarMetadata)) {
    assert.deepEqual(radarPoint(meta.x, meta.y, meta, 1024, 1024), { x: 0, y: 0 })
    const middle = radarPoint(meta.x + meta.scale * 512, meta.y - meta.scale * 512, meta, 1024, 1024)
    assert(Math.abs(middle.x - 512) < 1e-9)
    assert(Math.abs(middle.y - 512) < 1e-9)
  }
  assert.equal(radarPoint(0, 0, undefined, 1024, 1024), null)
  assert.equal(radarPoint(null, 0, radarMetadata.de_anubis, 1024, 1024), null)
})
