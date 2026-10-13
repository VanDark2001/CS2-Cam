import test from 'node:test'
import assert from 'node:assert/strict'
import { readPovFavorites, samePovFavorite, addPovFavorite } from './povFavorites.js'

const original = { id: 1, matchId: 22, round: 1, note: 'keep my note', players: [{ steamid: '123', name: 'A' }, { steamid: '456', name: 'B' }] }

test('same round and SteamID set is already saved regardless of order or nickname', () => {
  const repeated = { ...original, matchId: '22', round: '1', players: [{ steamid: '456', name: 'renamed' }, { steamid: '123' }] }
  assert.equal(samePovFavorite(original, repeated), true)
  const favorites = [original]
  assert.equal(addPovFavorite(favorites, repeated), favorites)
  assert.equal(favorites[0].note, 'keep my note')
  assert.equal(favorites[0].id, 1)
})

test('other matches, rounds and selected combinations remain separate', () => {
  for (const item of [{ ...original, matchId: 23 }, { ...original, round: 2 }, { ...original, players: [{ steamid: '123' }] }]) {
    assert.equal(samePovFavorite(original, item), false)
    assert.equal(addPovFavorite([original], item).length, 2)
  }
  assert.equal(samePovFavorite({ ...original, players: [] }, { ...original, players: [] }), false)
})

test('storage loading handles missing or malformed JSON without changing existing entries', () => {
  for (const raw of [null, 'broken', '{}', 'null']) assert.deepEqual(readPovFavorites(raw), [])
  assert.deepEqual(readPovFavorites(JSON.stringify([original])), [original])
})
