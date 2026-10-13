const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const JAR_NAME = 'demo-show-0.0.1-SNAPSHOT.jar'
const MARKER_NAME = 'electron-backend.json'

function isFile(file) {
  try { return fs.statSync(file).isFile() && fs.statSync(file).size > 0 }
  catch { return false }
}

function resolveBackendJar(root, override) {
  if (override) return override
  const server = path.join(root, 'server')
  try {
    const record = JSON.parse(fs.readFileSync(path.join(server, '.cache', MARKER_NAME), 'utf8'))
    // The marker may only select a build inside this project's runtime cache.
    if (typeof record.jar === 'string' && /^\.cache\/electron-builds\/[a-f0-9-]+\/demo-show-0\.0\.1-SNAPSHOT\.jar$/.test(record.jar)) {
      const jar = path.join(server, record.jar)
      if (isFile(jar)) return jar
    }
  } catch { /* No successful local runtime build yet. */ }
  return path.join(server, 'target', JAR_NAME)
}

function runMaven(server, buildDirectory) {
  const args = ['-q', '-DskipTests', 'package', `-Dcsdemo.build.directory=${buildDirectory}`]
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `mvn ${args.join(' ')}`], { cwd: server, stdio: 'inherit', windowsHide: true })
    : spawnSync('mvn', args, { cwd: server, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Maven failed (exit code ${result.status}).`)
}

function buildBackend(root, runner = runMaven) {
  const server = path.join(root, 'server')
  const directory = `.cache/electron-builds/${randomUUID()}`
  runner(server, directory)
  const jar = path.join(server, directory, JAR_NAME)
  if (!isFile(jar)) throw new Error(`Backend build did not produce ${jar}`)

  // Publish only after Maven's repackage has succeeded; never replace a live JAR.
  const marker = path.join(server, '.cache', MARKER_NAME)
  fs.mkdirSync(path.dirname(marker), { recursive: true })
  const pending = `${marker}.${randomUUID()}.tmp`
  fs.writeFileSync(pending, JSON.stringify({ jar: `${directory}/${JAR_NAME}` }) + '\n')
  fs.renameSync(pending, marker)
  return jar
}

module.exports = { buildBackend, resolveBackendJar }

if (require.main === module) {
  try {
    const jar = buildBackend(path.resolve(__dirname, '..'))
    console.log(`[INFO] Backend ready: ${jar}`)
  } catch (error) {
    console.error(`[ERROR] ${error.message}`)
    process.exitCode = 1
  }
}
