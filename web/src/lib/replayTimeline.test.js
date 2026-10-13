import test from 'node:test'
import assert from 'node:assert/strict'
import { eventPreviewTick, playerTimelineMarkers } from './replayTimeline.js'

test('event preview leads by three seconds without crossing the round start; tick rate varies', () => {
  assert.equal(eventPreviewTick(2000, 1000, 3000, 64), 1808)
  assert.equal(eventPreviewTick(1100, 1000, 3000, 64), 1000)
  assert.equal(eventPreviewTick(2000, 1000, 3000, 128), 1616)
})

test('player identity filters utility and creates separate kill/death markers; global view restores all', () => {
  const utility = [{ steamid: '1', tick: 200, label: '闪光' }, { steamid: '2', tick: 210, label: '烟雾' }]
  const events = [
    { type: 'player_death', tick: 250, data: JSON.stringify({ attacker_steamid: '1', user_steamid: '2', user_name: 'same name' }) },
    { type: 'player_death', tick: 300, data: { attacker_steamid: '2', user_steamid: '1', attacker_name: 'same name' } },
    { type: 'player_death', tick: 350, data: { attacker_steamid: '3', user_steamid: '2' } },
    { type: 'player_death', tick: 400, data: 'invalid' },
    { type: 'player_death', tick: 999, data: { attacker_steamid: '1', user_steamid: '2' } },
  ]
  const markers = playerTimelineMarkers(utility, events, '1', 100, 500)
  assert.deepEqual(markers.map(marker => marker.kind || marker.label), ['闪光', 'kill', 'death'])
  assert.equal(markers[1].symbol, 'crosshair')
  assert.equal(markers[2].symbol, 'skull')
  assert.equal(markers[1].percent, 37.5)
  assert.equal(playerTimelineMarkers(utility, events, '', 100, 500), utility)
  assert.deepEqual(playerTimelineMarkers(utility, events, '3', 100, 500).map(m => m.kind), ['kill'])
})
