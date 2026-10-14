import test from 'node:test'
import assert from 'node:assert/strict'
import { matchTitle } from './matchTitles.js'

test('team title follows score order and preserves manual titles', () => {
  const match = { id: 1, teamNames: { 2: 'Team Vitality', 3: 'MOUZ' } }
  assert.equal(matchTitle(match, {}, '炙热沙城 II'), 'MOUZ VS Team Vitality')
  assert.equal(matchTitle(match, { 1: '决赛' }, '炙热沙城 II'), '决赛')
  assert.equal(matchTitle({ teamNames: { 2: 'Vitality' } }, {}, '炙热沙城 II'), '炙热沙城 II')
  assert.equal(matchTitle({}, {}, '炙热沙城 II'), '炙热沙城 II')
})
