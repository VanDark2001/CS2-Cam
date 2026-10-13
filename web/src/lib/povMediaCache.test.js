import test from 'node:test'
import assert from 'node:assert/strict'
import { createPovMediaCache } from './povMediaCache.js'

const settle = () => new Promise(resolve => setImmediate(resolve))
test('complete videos are fetched once, reused, and released at a round change', async () => {
  let calls = 0, serial = 0, state
  const revoked = []
  const cache = createPovMediaCache({ fetcher: async () => { calls++; return new Response(new Blob(['video'])) },
    createUrl: () => `blob:${++serial}`, revokeUrl: url => revoked.push(url), onChange: next => { state = next } })
  cache.setFiles(['a', 'b', 'a']); await settle(); await settle()
  assert.equal(calls, 2)
  assert.equal(state.a.status, 'ready')
  const saved = state.a.url
  cache.setFiles(['a', 'b']); await settle()
  assert.equal(calls, 2); assert.equal(state.a.url, saved)
  cache.setFiles(['c']); await settle(); await settle()
  assert.equal(revoked.length, 2)
  cache.dispose(); assert.equal(revoked.length, 3)
})

test('partial or truncated responses fail visibly and retry never marks them cached', async () => {
  let state, requests = 0
  const cache = createPovMediaCache({ fetcher: async () => {
    requests++
    return requests === 1 ? new Response('first megabyte', { status: 206 })
      : requests === 2 ? new Response('short', { headers: { 'content-length': '100' } })
      : new Response('whole video')
  }, createUrl: () => 'blob:ready', revokeUrl: () => {}, onChange: next => { state = next } })
  cache.setFiles(['a']); await settle(); await settle(); assert.equal(state.a.status, 'error')
  cache.retry('a'); await settle(); await settle(); assert.equal(state.a.status, 'error')
  cache.retry('a'); await settle(); await settle(); assert.equal(state.a.status, 'ready')
  cache.dispose()
})

test('a late download from a previous round cannot allocate a stale Blob URL', async () => {
  let finish, urls = 0, state
  const cache = createPovMediaCache({ concurrency: 1, fetcher: () => new Promise(resolve => { finish = resolve }),
    createUrl: () => { urls++; return 'blob:stale' }, revokeUrl: () => {}, onChange: next => { state = next } })
  cache.setFiles(['old']); await settle()
  cache.setFiles([])
  finish(new Response('old video')); await settle(); await settle()
  assert.equal(urls, 0); assert.deepEqual(state, {})
  cache.dispose()
})
