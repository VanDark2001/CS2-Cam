const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { spawn, execFileSync } = require('node:child_process')
const https = require('node:https')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const DEFAULT_RECORDING_SETTINGS = Object.freeze({
  resolution: '1920x1080',
  speed: '2',
  bitrate: 'auto',
  hideHud: false,
  hideViewmodel: false,
  showXray: false,
  hideKillfeed: false,
})
function freePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer()
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port
      socket.close(error => error ? reject(error) : resolve(port))
    })
  })
}
function writeJson(file, value) {
  const temporary = `${file}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(temporary, file)
}
function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}
function execute(exe, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', data => { output = (output + data).slice(-8000) })
    child.stderr.on('data', data => { output = (output + data).slice(-8000) })
    const timer = setTimeout(() => { child.kill(); reject(new Error('本地运行环境响应超时')) }, options.timeout || 180000)
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => {
      clearTimeout(timer)
      code === 0 ? resolve(output) : reject(new Error(`${path.basename(exe)} 退出码 ${code}：${output}`))
    })
  })
}
async function downloadFile(url, destination, redirects = 0, fetcher = null) {
  // Chromium uses the desktop's proxy settings; Node HTTPS does not.
  if (!fetcher && process.versions.electron) fetcher = require('electron').net.fetch
  if (fetcher) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('下载超时，请检查网络后重试')), 180000)
    try {
      const response = await fetcher(url, { signal: controller.signal, redirect: 'follow' })
      if (!response.ok) throw new Error(`下载失败：HTTP ${response.status}`)
      if (!response.body) throw new Error('下载响应为空')
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destination), { signal: controller.signal })
      const expected = Number(response.headers.get('content-length'))
      if (expected > 0 && fs.statSync(destination).size !== expected) throw new Error('下载文件不完整，请重试')
    } catch (error) {
      try { fs.rmSync(destination, { force: true }) } catch {}
      throw error
    } finally { clearTimeout(timer) }
    return
  }
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('下载重定向次数过多'))
    const request = https.get(url, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume()
        return downloadFile(new URL(response.headers.location, url).toString(), destination, redirects + 1).then(resolve, reject)
      }
      if (response.statusCode !== 200) { response.resume(); return reject(new Error(`下载失败：HTTP ${response.statusCode}`)) }
      const output = fs.createWriteStream(destination)
      pipeline(response, output).then(resolve, reject)
    })
    request.on('error', reject)
    request.setTimeout(30000, () => request.destroy(new Error('下载连接超时')))
  })
}
async function extractZip(archive, destination) {
  const powershell = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe'
  await execute(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`], { timeout: 180000 })
}
function findFile(root, name) {
  const wanted = name.toLowerCase()
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === wanted) return target
      if (entry.isDirectory() && entry.name !== 'data' && entry.name !== 'node_modules') stack.push(target)
    }
  }
  return ''
}
function nativeDataPaths(data) {
  // Recording tools still need an ASCII alias for profiles and capture output.
  // SQLite itself uses the real Unicode path.
  if (process.platform !== 'win32') return { data, links: null }
  const candidates = [os.tmpdir(), process.env.PUBLIC && path.join(process.env.PUBLIC, 'Documents')].filter(Boolean)
  for (const directory of candidates) {
    if (/[^\x20-\x7e]/.test(directory)) continue
    const links = path.join(directory, 'csdemo-portable-links', randomUUID())
    try {
      fs.mkdirSync(links, { recursive: true })
      fs.symlinkSync(data, path.join(links, 'data'), 'junction')
      return { data: path.join(links, 'data'), links }
    } catch {
      // Remove only this attempt's links/empty folder, never junction targets.
      for (const name of ['data']) { try { fs.unlinkSync(path.join(links, name)) } catch {} }
      try { fs.rmdirSync(links) } catch {}
    }
  }
  throw new Error('无法创建录制工具的兼容路径。请检查 Windows 临时目录写入权限。')
}

function registrySteamPaths() {
  if (process.platform !== 'win32') return []
  const keys = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ]
  const paths = []
  for (const [key, value] of keys) {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/v', value], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
      const match = output.match(new RegExp(`${value}\\s+REG_[A-Z0-9_]+\\s+(.+)`, 'i'))
      if (match?.[1]) paths.push(match[1].trim().replace(/\\\\/g, '\\'))
    } catch {}
  }
  return paths
}

function steamLibraryPaths(steamRoots) {
  const libraries = new Set(steamRoots)
  for (const root of steamRoots) {
    const file = path.join(root, 'steamapps', 'libraryfolders.vdf')
    try {
      const text = fs.readFileSync(file, 'utf8')
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) libraries.add(match[1].replace(/\\\\/g, '\\'))
    } catch {}
  }
  return [...libraries]
}

function cs2InstallDirs(library) {
  const dirs = new Set(['Counter-Strike Global Offensive', 'Counter-Strike 2', 'CSGO'])
  try {
    const manifest = fs.readFileSync(path.join(library, 'steamapps', 'appmanifest_730.acf'), 'utf8')
    const match = manifest.match(/"installdir"\s+"([^"]+)"/i)
    if (match?.[1]) dirs.add(match[1])
  } catch {}
  return [...dirs]
}

function detectCs2Executable() {
  if (process.platform !== 'win32') return ''
  const roots = [
    ...registrySteamPaths(),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Steam'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Steam'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Steam'),
  ].filter(Boolean).map(value => path.normalize(value))
  const libraries = steamLibraryPaths([...new Set(roots)])
  const candidates = []
  for (const library of libraries) {
    for (const installDir of cs2InstallDirs(library)) {
      const game = path.join(library, 'steamapps', 'common', installDir)
      candidates.push(path.join(game, 'game', 'bin', 'win64', 'cs2.exe'))
      candidates.push(path.join(game, 'bin', 'win64', 'cs2.exe'))
    }
  }
  return candidates.find(candidate => fs.existsSync(candidate)) || ''
}
class PortableRuntime {
  constructor(resources, data) {
    this.resources = resources
    this.data = data
    this.project = path.join(resources, 'project')
    this.runtime = path.join(resources, 'runtime')
    this.python = path.join(this.runtime, 'python', 'python.exe')
    this.backend = null
    this.children = new Set()
  }
  async start() {
    fs.mkdirSync(this.data, { recursive: true })
    for (const directory of ['server', 'logs', 'uploads', 'avatars']) fs.mkdirSync(path.join(this.data, directory), { recursive: true })
    this.configFile = path.join(this.data, 'settings.json')
    this.settings = { version: 1, ...readJson(this.configFile, { version: 1 }) }
    this.settings.recording = { ...DEFAULT_RECORDING_SETTINGS, ...(this.settings.recording || {}) }
    const configuredCs2 = this.settings.CS2_EXE && path.resolve(this.data, this.settings.CS2_EXE)
    if (!configuredCs2 || !fs.existsSync(configuredCs2)) {
      const detectedCs2 = detectCs2Executable()
      if (detectedCs2) {
        this.settings.CS2_EXE = detectedCs2
        writeJson(this.configFile, this.settings)
      }
    }
    const databaseFile = path.join(this.data, 'csdemo.sqlite3')
    if (!fs.existsSync(databaseFile) && fs.existsSync(path.join(this.data, 'mysql'))) {
      throw new Error('旧 MySQL 数据已保留。请先迁移到 data/csdemo.sqlite3，再启动新版。')
    }
    this.port = await freePort()
    this.env = { ...process.env, SERVER_PORT: String(this.port), CS2_DATABASE: databaseFile,
      CS2_PROJECT_ROOT: this.project, CS2_DATA_ROOT: this.data, CS2_PYTHON: this.python,
      CS2_POWERSHELL: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      CS2_POV_PROFILE: path.join(this.data, '.pov-profile'), POV_LOCK: path.join(this.data, '.pov-record.lock'),
      CS2_REPLAY_EXPORTER: path.join(this.project, 'tools', 'replay_positions', 'replay_positions.exe'),
      PYTHONUTF8: '1', PYTHONUNBUFFERED: '1',
      HLAE_EXE: path.join(this.runtime, 'hlae', 'HLAE.exe'),
      FFMPEG_EXE: path.join(this.runtime, 'hlae', 'ffmpeg', 'bin', 'ffmpeg.exe'),
      FFPROBE_EXE: path.join(this.runtime, 'hlae', 'ffmpeg', 'bin', 'ffprobe.exe'),
    }
    this.applyRecordingEnvironment()
    // The portable file always wins over development database environment variables.
    for (const key of Object.keys(this.env)) if (key.startsWith('MYSQL_')) delete this.env[key]
    delete this.env.SPRING_DATASOURCE_URL
    // Only user-selected recording paths override the bundled recording tools.
    for (const key of ['CS2_EXE', 'HLAE_EXE', 'FFMPEG_EXE', 'FFPROBE_EXE']) {
      if (this.settings[key]) this.env[key] = path.resolve(this.data, this.settings[key])
    }
    this.env.HLAE_WRAPPER = path.join(this.project, 'tools', 'pov', 'hlae_wrapper.ps1')
    this.nativePaths = nativeDataPaths(this.data)
    this.env.CS2_NATIVE_DATA = this.nativePaths.data
    this.env.CS2_POV_PROFILE = path.join(this.nativePaths.data, '.pov-profile')
    await this.database('schema')
    const jar = path.join(this.project, 'server', 'target', 'demo-show-0.0.1-SNAPSHOT.jar')
    this.backend = this.spawnLogged(path.join(this.runtime, 'java', 'bin', 'java.exe'),
      ['-jar', jar, `--server.port=${this.port}`, '--server.address=127.0.0.1'], 'backend.log', path.join(this.data, 'server'))
    return this
  }
  spawnLogged(exe, args, name, cwd) {
    const descriptor = fs.openSync(path.join(this.data, 'logs', name), 'a')
    let child
    try { child = spawn(exe, args, { cwd, env: this.env, windowsHide: true, stdio: ['ignore', descriptor, descriptor] }) }
    finally { fs.closeSync(descriptor) }
    this.children.add(child)
    child.once('exit', () => this.children.delete(child))
    child.once('error', error => { this.startError = error; this.children.delete(child) })
    return child
  }
  database(action) {
    return execute(this.python, [path.join(this.project, 'tools', 'portable_database.py'), action], { env: this.env, cwd: this.data, timeout: 30000 })
  }
  saveRecordingPath(key, value) {
    this.settings[key] = value
    writeJson(this.configFile, this.settings)
    // Java reads recording paths per job from settings.json; no service restart is needed.
    this.env[key] = value
  }
  recordingSettings() { return { ...DEFAULT_RECORDING_SETTINGS, ...(this.settings.recording || {}) } }
  saveRecordingSetting(key, value) {
    this.settings.recording = { ...this.recordingSettings(), [key]: value }
    writeJson(this.configFile, this.settings)
    this.applyRecordingEnvironment()
  }
  applyRecordingEnvironment() {
    const settings = this.recordingSettings()
    this.env.CS2_POV_RESOLUTION = settings.resolution
    this.env.CS2_POV_TIMESCALE = settings.speed
    this.env.CS2_POV_BITRATE = settings.bitrate || 'auto'
    this.env.CS2_POV_CUSTOM_CFG = path.join(this.data, 'recording.cfg')
    this.env.CS2_POV_HIDE_HUD = settings.hideHud ? '1' : '0'
    this.env.CS2_POV_HIDE_VIEWMODEL = '0'
    this.env.CS2_POV_SHOW_XRAY = settings.showXray ? '1' : '0'
    this.env.CS2_POV_HIDE_KILLFEED = '0'
  }
  recordingStatus() {
    return ['CS2_EXE', 'HLAE_EXE', 'FFMPEG_EXE', 'FFPROBE_EXE'].map(key => ({ key, path: this.env[key] || '', ready: fs.existsSync(this.env[key] || '') }))
  }
  recordingCfgFile() {
    const file = path.join(this.data, 'recording.cfg')
    if (!fs.existsSync(file)) fs.writeFileSync(file, '// Custom recording commands. Applied after UI visual settings.\n// Saved changes apply to the next recording.\n// r_drawviewmodel 0\n// cl_draw_only_deathnotices 1\n', { encoding: 'utf8', flag: 'wx' })
    return file
  }
  async installRecordingTool(key) {
    const urls = {
      HLAE_EXE: 'https://github.com/advancedfx/advancedfx/releases/download/v2.192.5/hlae_2_192_5.zip',
      FFMPEG_EXE: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl-shared.zip',
    }
    const root = path.join(this.data, 'tools', key === 'HLAE_EXE' ? 'hlae' : 'ffmpeg')
    const temporary = path.join(this.data, 'tools', `.download-${key}-${randomUUID()}`)
    const archive = `${temporary}.zip`
    fs.mkdirSync(path.dirname(temporary), { recursive: true })
    try {
      await downloadFile(urls[key], archive)
      fs.mkdirSync(temporary, { recursive: true })
      await extractZip(archive, temporary)
      const executable = findFile(temporary, key === 'HLAE_EXE' ? 'HLAE.exe' : 'ffmpeg.exe')
      if (!executable) throw new Error(`${key === 'HLAE_EXE' ? 'HLAE' : 'FFmpeg'} 压缩包中未找到可执行文件`)
      const sourceRoot = path.dirname(executable)
      if (key === 'HLAE_EXE' && !findFile(path.dirname(executable), 'AfxHookSource2.dll')) throw new Error('HLAE 压缩包缺少 AfxHookSource2.dll')
      if (key === 'FFMPEG_EXE' && !findFile(sourceRoot, 'ffprobe.exe')) throw new Error('FFmpeg 压缩包缺少 ffprobe.exe')
      fs.rmSync(root, { recursive: true, force: true })
      fs.mkdirSync(root, { recursive: true })
      fs.cpSync(path.dirname(executable), root, { recursive: true })
      this.settings[key] = path.relative(this.data, path.join(root, path.basename(executable)))
      if (key === 'FFMPEG_EXE') this.settings.FFPROBE_EXE = path.relative(this.data, path.join(root, 'ffprobe.exe'))
      writeJson(this.configFile, this.settings)
      this.env[key] = path.resolve(this.data, this.settings[key])
      if (key === 'FFMPEG_EXE') this.env.FFPROBE_EXE = path.resolve(this.data, this.settings.FFPROBE_EXE)
      return this.recordingStatus()
    } finally {
      try { fs.rmSync(temporary, { recursive: true, force: true }) } catch {}
      try { fs.rmSync(archive, { force: true }) } catch {}
    }
  }
  async stop() {
    if (this.backend && this.backend.exitCode === null && this.backend.pid) {
      // Target only the child started by this instance, never an existing desktop/server.
      if (process.platform === 'win32') await execute('taskkill.exe', ['/pid', String(this.backend.pid), '/t', '/f']).catch(() => {})
      else this.backend.kill('SIGTERM')
    }
    if (this.nativePaths?.links) {
      for (const name of ['data']) { try { fs.unlinkSync(path.join(this.nativePaths.links, name)) } catch {} }
      try { fs.rmdirSync(this.nativePaths.links) } catch {}
    }
  }
}
module.exports = { PortableRuntime, freePort, readJson, writeJson, execute, nativeDataPaths, detectCs2Executable, downloadFile }
