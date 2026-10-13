const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { PortableRuntime } = require('./portable-runtime.cjs')

test('custom CFG is created once and user edits survive reopen', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-cfg-'))
  try {
    const runtime = new PortableRuntime(root, root)
    const file = runtime.recordingCfgFile()
    assert.equal(file, path.join(root, 'recording.cfg'))
    assert.match(fs.readFileSync(file, 'utf8'), /r_drawviewmodel/)
    fs.writeFileSync(file, 'r_drawviewmodel 0\n')
    runtime.recordingCfgFile()
    assert.equal(fs.readFileSync(file, 'utf8'), 'r_drawviewmodel 0\n')
  } finally { fs.rmSync(root, { recursive:true, force:true }) }
})
