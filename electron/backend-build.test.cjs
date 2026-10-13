const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { buildBackend, resolveBackendJar } = require('./backend-build.cjs')

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-backend-test-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function successfulBuild(server, directory) {
  fs.mkdirSync(path.join(server, directory), { recursive: true })
  fs.writeFileSync(path.join(server, directory, 'demo-show-0.0.1-SNAPSHOT.jar'), 'test jar')
}

test('repeated builds use distinct JARs and select the latest success', t => {
  const root = fixture(t)
  const first = buildBackend(root, successfulBuild)
  const original = fs.readFileSync(first)
  const second = buildBackend(root, successfulBuild)
  assert.notEqual(first, second)
  assert.deepEqual(fs.readFileSync(first), original)
  assert.equal(resolveBackendJar(root), second)
  assert.equal(resolveBackendJar(root, 'custom.jar'), 'custom.jar')
})

test('failed or incomplete builds retain the last successful selection', t => {
  const root = fixture(t)
  const first = buildBackend(root, successfulBuild)
  assert.throws(() => buildBackend(root, () => { throw new Error('Maven failed') }))
  assert.equal(resolveBackendJar(root), first)
  assert.throws(() => buildBackend(root, () => {}), /did not produce/)
  assert.equal(resolveBackendJar(root), first)
})

test('missing, malformed, deleted or escaping markers fall back to the packaged JAR', t => {
  const root = fixture(t)
  const fallback = path.join(root, 'server', 'target', 'demo-show-0.0.1-SNAPSHOT.jar')
  assert.equal(resolveBackendJar(root), fallback)
  const jar = buildBackend(root, successfulBuild)
  fs.unlinkSync(jar)
  assert.equal(resolveBackendJar(root), fallback)
  const marker = path.join(root, 'server', '.cache', 'electron-backend.json')
  fs.writeFileSync(marker, '{broken')
  assert.equal(resolveBackendJar(root), fallback)
  fs.writeFileSync(marker, JSON.stringify({ jar: '../outside.jar' }))
  assert.equal(resolveBackendJar(root), fallback)
})
