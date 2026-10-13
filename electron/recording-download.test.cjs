const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { downloadFile } = require('./portable-runtime.cjs')

test('Chromium download waits for complete file and follows redirects', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-download-'))
  try {
    const file = path.join(dir, 'tool.zip')
    await downloadFile('https://example.test/tool.zip', file, 0, async (_, options) => {
      assert.equal(options.redirect, 'follow')
      assert.ok(options.signal)
      return new Response('archive', { headers: { 'content-length': '7' } })
    })
    assert.equal(fs.readFileSync(file, 'utf8'), 'archive')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('HTTP and truncated downloads fail and remove partial archive', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-download-'))
  try {
    const file = path.join(dir, 'tool.zip')
    await assert.rejects(downloadFile('https://example.test/tool.zip', file, 0,
      async () => new Response('missing', { status: 404 })), /HTTP 404/)
    await assert.rejects(downloadFile('https://example.test/tool.zip', file, 0,
      async () => new Response('partial', { headers: { 'content-length': '99' } })), /不完整/)
    assert.equal(fs.existsSync(file), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('interrupted response settles rejection instead of hanging', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-download-'))
  try {
    const file = path.join(dir, 'tool.zip')
    const body = new ReadableStream({ start(controller) { controller.error(new Error('connection reset')) } })
    await assert.rejects(downloadFile('https://example.test/tool.zip', file, 0,
      async () => new Response(body)), /connection reset/)
    assert.equal(fs.existsSync(file), false)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
