import test from 'node:test'
import assert from 'node:assert/strict'
import { roundHudFrames } from './roundHudTransition.js'
test('title transforms into the label while the timer and icon enter on the same timeline',()=>{
 const frames=roundHudFrames(-55,.45)
 assert.equal(frames.title[2].opacity,1)
 assert.equal(frames.title[2].transform,`translateX(55px) scale(${1/.45})`)
 assert.equal(frames.title[3].transform,'none')
 assert.equal(frames.values.at(-1).opacity,1)
 assert.equal(frames.title.at(-1).opacity,1)
 assert.ok(frames.values[1].offset<frames.title[3].offset)
 for(const list of Object.values(frames)){assert.equal(list[0].offset,0);assert.equal(list.at(-1).offset,1)}
})
test('reduced motion preserves fading without translations or scaling',()=>{
 for(const list of Object.values(roundHudFrames(-55,.45,true)))for(const frame of list)assert.equal(frame.transform,'none')
})
