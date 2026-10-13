import test from 'node:test'
import assert from 'node:assert/strict'
import { favoritePovStatus } from './povAvailability.js'

const item = { round: 1, players: [{ steamid: 'a', slot: 9 }, { steamid: 'b', slot: 3 }] }
const job = { round: 1, status: 'completed', players: [{ steamid: 'b', slot: 3 }, { steamid: 'a', slot: 9 }], files: [{ name: 'player_1', url: '/a.mp4' }] }
test('completed files match SteamID using recording index, not game slot or nickname', () => {
  const result = favoritePovStatus(item, [job, { ...job, round: 2 }, { ...job, status: 'recording' }])
  assert.equal(result.completed, 1)
  assert.deepEqual(result.missing, [item.players[1]])
})
test('separate jobs cover selected players, unknown multi-player main files do not', () => {
  assert.equal(favoritePovStatus(item, [job, { ...job, files: [{ name: 'player_0', url: '/b.mp4' }] }]).completed, 2)
  assert.equal(favoritePovStatus(item, [{ ...job, files: [{ name: 'final.mp4', url: '/mixed.mp4' }] }]).completed, 0)
  assert.equal(favoritePovStatus(item, [{ ...job, players: [{ steamid: 'a' }], files: [{ name: 'final.mp4', url: '/a.mp4' }] }]).completed, 1)
})
