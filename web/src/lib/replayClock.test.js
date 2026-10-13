import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replayCountdown, replayFreezeEnd } from './replayClock.js'

const replay = { startTick: 1182, globalTick: 1316, roundEndTick: 4332, endTick: 4780, tickRate: 64, events: [] }

test('Ancient first-round freeze event equal to origin overrides an old fabricated 15 seconds', () => {
  const data = { ...replay, freezeEndTick: 2142, events: [{ type: 'round_freeze_end', tick: 1182 }] }
  assert.equal(replayFreezeEnd(data), 1182)
  assert.equal(replayCountdown(data).text, '回合 1:53')
  assert.equal(replayCountdown({ ...replay, globalTick: 1182, freezeEndTick: 1182 }).text, '回合 1:55')
})

test('real freeze time remains a buy countdown, including recorded long technical pauses', () => {
  assert.equal(replayCountdown({ ...replay, freezeEndTick: 2142 }).text, '购买 0:13')
  assert.equal(replayCountdown({ ...replay, freezeEndTick: 3102 }).text, '购买 0:28')
  assert.equal(replayCountdown({ ...replay, freezeEndTick: 2142, globalTick: 2142 }).text, '回合 1:55')
})

test('missing or invalid phase data never fabricates a buying period', () => {
  for (const freezeEndTick of [undefined, null, NaN, 100, 5000]) {
    assert.equal(replayFreezeEnd({ ...replay, freezeEndTick }), null)
    assert.equal(replayCountdown({ ...replay, freezeEndTick }).text, '回合进行中')
  }
})

test('phase events must belong to the current round; tick rate is respected', () => {
  assert.equal(replayFreezeEnd({ ...replay, events: [{ type: 'round_freeze_end', tick: 1181 }, { type: 'round_freeze_end', tick: 4800 }] }), null)
  assert.equal(replayCountdown({ ...replay, tickRate: 128, freezeEndTick: 2142 }).text, '购买 0:07')
})

test('loading, bomb, round end and final end take priority over the ordinary countdown', () => {
  assert.equal(replayCountdown(replay, { loading: true }).text, '加载中')
  assert.deepEqual(replayCountdown(replay, { bomb: true }), { text: '炸弹已安放', bomb: true })
  assert.deepEqual(replayCountdown(replay, { bombDefused: true }), { text: '炸弹已拆除', bomb: false, defused: true })
  assert.equal(replayCountdown(replay, { bomb: true, bombRemaining: 40 }).text, '爆炸 0:40')
  assert.deepEqual(replayCountdown(replay, { bomb: true, bombRemaining: 39.2 }), { text: '爆炸 0:40', bomb: true })
  assert.equal(replayCountdown({ ...replay, globalTick: 4780 }).text, '回合结束')
  assert.equal(replayCountdown({ ...replay, globalTick: 4780 }, { finalRound: true }).text, '比赛结束')
})
