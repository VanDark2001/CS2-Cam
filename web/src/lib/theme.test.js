import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme, setThemeMode, startThemeClock, themeMode, activeTheme, themeStorageError, THEME_KEY } from './theme.js'

test('automatic boundaries use local computer time; manual modes stay fixed', () => {
 for (const [h,m,expected] of [[6,59,'dark'],[7,0,'light'],[18,59,'light'],[19,0,'dark'],[23,59,'dark'],[0,0,'dark']]) {
  const now = new Date(2026,9,14,h,m)
  assert.equal(resolveTheme('auto',now),expected)
  assert.equal(resolveTheme('dark',now),'dark')
  assert.equal(resolveTheme('light',now),'light')
 }
})
test('saved preference, live clock, resume and storage updates without page reload', () => {
 const originalDate = globalThis.Date; let hour=8; const events=new Map(); const store=new Map(); let tick
 globalThis.Date=class extends originalDate {constructor(...args){super(...(args.length?args:[2026,9,14,hour,0]))}}
 globalThis.document={documentElement:{dataset:{},style:{}},hidden:false,addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)}
 globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)}
 globalThis.window={setInterval:fn=>(tick=fn,1),addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)}
 const stop=startThemeClock()
 try {
  setThemeMode('auto');assert.equal(activeTheme.value,'light');assert.equal(store.get(THEME_KEY),'auto')
  hour=19;tick();assert.equal(activeTheme.value,'dark')
  setThemeMode('light');hour=23;tick();assert.equal(activeTheme.value,'light')
  events.get('storage')({key:THEME_KEY,newValue:'auto'});assert.equal(activeTheme.value,'dark')
  hour=8;events.get('focus')();assert.equal(activeTheme.value,'light')
  setThemeMode('invalid');assert.equal(themeMode.value,'auto')
  globalThis.localStorage.setItem=()=>{throw new Error('blocked')};setThemeMode('dark');assert.equal(activeTheme.value,'dark');assert.ok(themeStorageError.value)
 } finally {stop();globalThis.Date=originalDate;delete globalThis.window;delete globalThis.document;delete globalThis.localStorage}
})
