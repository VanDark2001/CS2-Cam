import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareReplayEffects, trajectoryAt, activeEffectZone, effectRemainingSeconds, formatEffectRemaining } from './replayEffects.js'

const pathEvent = (entity = 7, start = 100) => ({ type: 'grenade_trajectory', tick: start, data: {
  entity_id: entity, grenade_type: 'CSmokeGrenadeProjectile',
  points: [[start, 0, 0], [start + 4, 4, 0], [start + 8, 4, 4], [start + 20, 4, 4]],
} })

test('a bounce follows the recorded corner and never exposes future points', () => {
  const path = prepareReplayEffects([pathEvent()]).paths[0]
  const frame = trajectoryAt(path, 106)
  assert.deepEqual(frame.head, [106, 4, 2])
  assert(frame.tail.every(point => point[0] <= 106))
  assert.equal(trajectoryAt(path, 99), null)
  // Pause/seek to the same tick yields the identical visual state.
  assert.deepEqual(trajectoryAt(path, 106), frame)
})

test('detonation ends flight; an expiry with no coordinates ends the cloud', () => {
  const effects = prepareReplayEffects([
    pathEvent(), { type: 'smokegrenade_detonate', tick: 109, data: { entityid: 7, x: 4, y: 4 } },
    { type: 'smokegrenade_expired', tick: 150, data: { entityid: 7 } },
  ])
  assert.equal(effects.paths[0].end, 109)
  assert.equal(effects.zones[0].end, 150)
  assert.equal(trajectoryAt(effects.paths[0], 109).flying, false)
  assert.equal(trajectoryAt(effects.paths[0], 142), null)
})

test('a reused entity is paired with its own later detonation', () => {
  const effects = prepareReplayEffects([
    pathEvent(), { type: 'smokegrenade_detonate', tick: 109, data: { entityid: 7, x: 4, y: 4 } },
    pathEvent(7, 200), { type: 'smokegrenade_detonate', tick: 216, data: { entityid: 7, x: 4, y: 4 } },
  ])
  assert.deepEqual(effects.paths.map(path => path.end), [109, 216])
})

test('missing coordinates stay unknown and knife/grenade events produce no gunfire', () => {
  const effects = prepareReplayEffects([
    { type: 'smokegrenade_detonate', tick: 20, data: { x: null, y: null } },
    ...['weapon_ak47', 'weapon_knife_skeleton', 'weapon_molotov', 'weapon_flashbang'].map(weapon => ({ type: 'weapon_fire', tick: 50, data: { weapon } })),
  ])
  assert.equal(effects.zones.length, 0)
  assert.equal(effects.shots.length, 1)
})

test('defuse/explosion removes the C4 timer even when it has no coordinates', () => {
  const effects = prepareReplayEffects([
    { type: 'bomb_planted', tick: 100, data: { user_X: 0, user_Y: 0 } },
    { type: 'bomb_defused', tick: 190, data: {} },
  ])
  assert.equal(effects.zones[0].end, 100 + 40 * 64)
  assert.equal(effects.zones[0].stop, 190)
})

test('a coordinate-less C4 plant still creates the shared forty-second timer zone', () => {
  const effects = prepareReplayEffects([
    { type: 'bomb_planted', tick: 100, steamid: 'player-1', data: { site: 932, user_X: null, user_Y: null } },
  ])
  assert.equal(effects.zones.length, 1)
  assert.equal(effects.zones[0].end, 100 + 40 * 64)
  assert.equal(effects.zones[0].steamid, 'player-1')
})

test('C4 coordinates remain drawable when an older parser uses lowercase fields', () => {
  const effects = prepareReplayEffects([
    { type: 'bomb_planted', tick: 100, data: { user_x: '12.5', user_y: '24.5', user_z: '-8' } },
  ])
  assert.deepEqual(effects.zones[0].x, '12.5')
  assert.deepEqual(effects.zones[0].y, '24.5')
  assert.deepEqual(effects.zones[0].z, '-8')
  assert.ok(activeEffectZone(effects, 120, 'bomb'))
})

test('HUD and map use the same active C4 zone and rounded remaining seconds', () => {
  const effects = prepareReplayEffects([
    { type: 'bomb_planted', tick: 100, data: { x: 1, y: 2 } },
    // Older parser output can contain a duplicate plant row at the same tick.
    { type: 'bomb_planted', tick: 100, data: { x: 3, y: 4 } },
  ])
  const zone = activeEffectZone(effects, 100 + 6 * 64, 'bomb')
  assert.equal(zone, effects.zones[0])
  assert.equal(effectRemainingSeconds(zone, 100 + 6 * 64, 64), 34)
  assert.equal(formatEffectRemaining(zone, 100 + 6 * 64, 64), '34')
})
