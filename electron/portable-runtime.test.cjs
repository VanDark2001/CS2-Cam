const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { PortableRuntime, freePort, nativeDataPaths } = require('./portable-runtime.cjs')

test('partial database initialization is preserved and never reinitialized', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-partial-'))
  try {
    const data = path.join(root, 'data')
    fs.mkdirSync(path.join(data, 'mysql'), { recursive: true })
    fs.writeFileSync(path.join(data, 'mysql', 'auto.cnf'), 'preserve this database')
    const runtime = new PortableRuntime(path.join(root, 'resources'), data)
    await assert.rejects(runtime.start(), /旧 MySQL 数据已保留/)
    assert.equal(fs.readFileSync(path.join(data, 'mysql', 'auto.cnf'), 'utf8'), 'preserve this database')
    assert.equal(fs.existsSync(path.join(data, 'database-credentials.json')), false)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('preload exposes only the selected loopback API base and rejects invalid ports', () => {
  const script = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')
  for (const [port, expected] of [['43567', 'http://127.0.0.1:43567/api'], ['70000', undefined], ['evil', undefined]]) {
    let value
    vm.runInNewContext(script, { process: { argv: [`--csdemo-api-port=${port}`] }, require: () => ({ contextBridge: { exposeInMainWorld: (key, exposed) => { assert.equal(key, 'csdemoDesktop'); value = exposed } } }) })
    assert.equal(value?.apiBase, expected)
    if (value) assert.deepEqual(Object.keys(value), ['apiBase'])
  }
})
test('port selection uses an available loopback port', async () => {
  const port = await freePort()
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)
})
test('portable startup selects its own SQLite file and only spawns Java', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-sqlite-'))
  const previous = process.env.MYSQL_URL
  process.env.MYSQL_URL = 'jdbc:mysql://127.0.0.1:3306/private'
  const runtime = new PortableRuntime(path.join(root, 'resources'), path.join(root, '中文 数据'))
  const spawned = []
  let initialized = false
  runtime.database = async action => { assert.equal(action, 'schema'); initialized = true }
  runtime.spawnLogged = (exe, args) => { assert.ok(initialized); spawned.push(exe); return { exitCode: 0 } }
  try {
    await runtime.start()
    assert.equal(runtime.env.CS2_DATABASE, path.join(runtime.data, 'csdemo.sqlite3'))
    assert.equal(runtime.env.MYSQL_URL, undefined)
    assert.equal(spawned.length, 1)
    assert.equal(path.basename(spawned[0]), 'java.exe')
    assert.equal(fs.existsSync(path.join(runtime.data, 'database-credentials.json')), false)
  } finally {
    await runtime.stop()
    if (previous === undefined) delete process.env.MYSQL_URL
    else process.env.MYSQL_URL = previous
    fs.rmSync(root, { recursive: true, force: true })
  }
})
test('native database aliases access Chinese data without moving or deleting it', { skip: process.platform !== 'win32' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'csdemo-paths-'))
  let native
  try {
    const data = path.join(root, '中文 数据')
    const runtime = path.join(root, '运行环境')
    fs.mkdirSync(data)
    fs.mkdirSync(path.join(runtime, 'mysql'), { recursive: true })
    fs.writeFileSync(path.join(data, 'preserve.txt'), 'keep')
    native = nativeDataPaths(data)
    assert.doesNotMatch(native.data, /[^\x20-\x7e]/)
    assert.equal(fs.readFileSync(path.join(native.data, 'preserve.txt'), 'utf8'), 'keep')
    fs.unlinkSync(path.join(native.links, 'data'))
    fs.rmdirSync(native.links)
    native = null
    assert.equal(fs.readFileSync(path.join(data, 'preserve.txt'), 'utf8'), 'keep')
  } finally {
    if (native) { for (const name of ['data']) fs.unlinkSync(path.join(native.links, name)); fs.rmdirSync(native.links) }
    fs.rmSync(root, { recursive: true, force: true })
  }
})
