import test from 'node:test'
import assert from 'node:assert/strict'
import { killfeedAssisterColor } from './replayKillfeed.js'
const players=[{steamid:'90000000000000001',name:'Same',teamNumber:2},{steamid:'90000000000000002',name:'Same',teamNumber:3}]
test('assist color follows exact identity and current side after a swap',()=>{
 const event={assister_steamid:players[0].steamid}
 assert.equal(killfeedAssisterColor(event,{},players,2),'#f3bf4c')
 assert.equal(killfeedAssisterColor(event,{},players,3),'#4aa3ff')
 assert.equal(killfeedAssisterColor({assister_steamid64:players[1].steamid},{},players,2),'#4aa3ff')
 assert.equal(killfeedAssisterColor({},event,players,3),'#4aa3ff')
})
test('unknown identity cannot inherit a nickname or attacker color',()=>{
 assert.equal(killfeedAssisterColor({assister_name:'Same',attacker_steamid:players[0].steamid},{},players,2),null)
 assert.equal(killfeedAssisterColor({assister_steamid:'0'},{},players,2),null)
 assert.equal(killfeedAssisterColor({assister_steamid:players[0].steamid},{},players,null),null)
})
