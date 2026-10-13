const { app, BrowserWindow, dialog, Menu, shell, session, ipcMain } = require('electron')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { resolveBackendJar } = require('./backend-build.cjs')
const { PortableUpdater, githubFetch } = require('./updater.cjs')
const releaseConfig = require('./release-config.json')
let updater = null
let installingUpdate = false

let BACKEND_PORT = Number(process.env.BACKEND_PORT || 8091)
let backend = null
let backendOwned = false
let portable = null
let quitting = false
let quitChecking = false
const pendingUploads = new Set()
const portableBuild = fs.existsSync(path.join(process.resourcesPath, 'portable.json'))
const packagedData = path.join(path.dirname(app.getPath('exe')), 'data')
// A dir build has its SQLite data under resources/project/data.  Reuse it
// until the user creates a sibling data directory, so adding the portable
// runtime back to an existing unpacked client does not start with an empty DB.
const portableData = process.env.CS2_PORTABLE_DATA || (fs.existsSync(packagedData) ? packagedData : path.join(process.resourcesPath, 'project', 'data'))
if (portableBuild) {
  app.setName('CS2 Cam')
  fs.mkdirSync(portableData, { recursive: true })
  app.setPath('userData', path.join(portableData, 'desktop'))
}
const ownsInstanceLock = app.requestSingleInstanceLock()
if (!ownsInstanceLock) app.quit()
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0]
  if (window) { if (window.isMinimized()) window.restore(); window.focus() }
})

// Replay is designed around a 1440x960 content area. Electron's zoom factor
// keeps that composition intact while fitting smaller desktop windows.
const DESIGN_WIDTH = 1440
const DESIGN_HEIGHT = 960

function updateWindowZoom(window) {
  const [width, height] = window.getContentSize()
  const scale = Math.max(0.6, Math.min(1, width / DESIGN_WIDTH, height / DESIGN_HEIGHT))
  window.webContents.setZoomFactor(scale)
}

function projectRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'project')
    : path.resolve(__dirname, '..')
}

function loadRuntimeEnv(root) {
  const candidates = [
    path.join(app.getPath('userData'), '.env'),
    path.join(root, '.env'),
  ]
  const file = candidates.find(candidate => fs.existsSync(candidate))
  if (!file) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1] in process.env) continue
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}

function jarPath(root) {
  return resolveBackendJar(root, process.env.CS2_SERVER_JAR)
}

function requestHealth() {
  return requestJson('/api/health/db').then(value => value.status === 'ok' && value.database === 'csdemo' && value.engine === 'sqlite' && (!process.env.CS2_DATABASE || path.resolve(value.file || '') === path.resolve(process.env.CS2_DATABASE))).catch(() => false)
}

function requestJson(route) {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${BACKEND_PORT}${route}`, response => {
      let body = ''
      response.on('data', data => { body += data })
      response.on('end', () => {
        try { if (response.statusCode !== 200) throw new Error(`HTTP ${response.statusCode}`); resolve(JSON.parse(body)) }
        catch (error) { reject(error) }
      })
    })
    request.on('error', reject)
    request.setTimeout(1500, () => request.destroy(new Error('本地服务响应超时')))
  })
}

async function waitForBackend(timeoutMs = 30000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (portable?.startError) throw portable.startError
    if (portable?.backend && portable.backend.exitCode !== null) throw new Error('后端已退出，请查看 data/logs/backend.log')
    if (await requestHealth()) return true
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return false
}

function startBackend(root) {
  const jar = jarPath(root)
  if (!fs.existsSync(jar)) throw new Error(`找不到 Spring Boot 程序：${jar}`)
  const child = spawn(process.env.CS2_JAVA || 'java', [
    '-jar', jar, `--server.port=${BACKEND_PORT}`,
  ], {
    // DemoService resolves the parser root as parent(user.dir). Keep the
    // working directory at project/server so that parent(user.dir) is the
    // packaged project directory, just like the repository's start script.
    cwd: path.join(root, 'server'),
    env: { ...process.env, SERVER_PORT: String(BACKEND_PORT) },
    windowsHide: true,
    stdio: 'ignore',
  })
  backend = child
  backendOwned = true
  child.on('error', error => console.error('[desktop] backend start failed', error))
  child.on('exit', (code, signal) => {
    if (backend === child) backend = null
    if (code && app.isReady()) console.error(`[desktop] backend exited: ${code || signal}`)
  })
}

function stopBackend() {
  if (!backend || !backendOwned || backend.killed) return
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(backend.pid), '/t', '/f'], { windowsHide: true })
  else backend.kill('SIGTERM')
  backend = null
}

async function createWindow() {
  const root = projectRoot()
  if (portableBuild && !portable) {
    const { PortableRuntime } = require('./portable-runtime.cjs')
    portable = new PortableRuntime(process.resourcesPath, portableData)
    await portable.start()
    BACKEND_PORT = portable.port
  } else if (!portableBuild) {
    loadRuntimeEnv(root)
    process.env.CS2_DATABASE = path.resolve(root, process.env.CS2_DATABASE || 'data/csdemo.sqlite3')
    if (!(await requestHealth())) {
      // Preserve an older development server; select another port if it responds.
      if (await requestJson('/api/health/db').then(() => true).catch(() => false)) {
        const { freePort } = require('./portable-runtime.cjs')
        BACKEND_PORT = await freePort()
      }
      startBackend(root)
    }
    else console.log(`[desktop] Reusing backend on port ${BACKEND_PORT}; restart it to activate a new backend build.`)
  }
  if (!(await waitForBackend())) {
    await dialog.showMessageBox({
      type: 'error', title: 'CS2 Cam 启动失败',
      message: '本地后端未能启动。',
      detail: portableBuild ? '请查看 data/logs 中的启动日志，然后重试。' : '请确认 Java 和 SQLite 数据文件可用，然后重试。',
    })
    app.quit()
    return
  }
  if(!updater){
    updater=new PortableUpdater({appRoot:path.dirname(app.getPath('exe')),data:portableBuild?portableData:app.getPath('userData'),currentVersion:app.getVersion(),available:portableBuild,fetcher:githubFetch})
    updater.on('change',state=>{for(const window of BrowserWindow.getAllWindows())if(!window.isDestroyed())window.webContents.send('updates:changed',state)})
    if(portableBuild&&process.env.CS2_DESKTOP_SMOKE!=='1')updater.start()
  }
  const window = new BrowserWindow({
    width: 1600, height: 900, minWidth: 820, minHeight: 620,
    title: 'CS2 Cam',
    icon: path.join(__dirname, 'assets', 'app-icon.ico'),
    backgroundColor: '#191a19',
    show: process.env.CS2_DESKTOP_SMOKE !== '1',
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs'), additionalArguments: [`--csdemo-api-port=${BACKEND_PORT}`] },
  })
  window.on('resize', () => updateWindowZoom(window))
  window.webContents.setWindowOpenHandler(({url})=>{try{if(['github.com','space.bilibili.com'].includes(new URL(url).hostname))shell.openExternal(url)}catch{}return {action:'deny'}})
  window.on('close', event => {
    if (portable && !quitting) { event.preventDefault(); app.quit() }
  })
  window.webContents.on('did-finish-load', () => updateWindowZoom(window))
  await window.loadFile(path.join(root, 'web', 'dist', 'index.html'))
  if (portable) installPortableMenu()
  if (portable && process.env.CS2_DESKTOP_SMOKE !== '1' && !fs.existsSync(portable.env.CS2_EXE || '')) {
    const result = await dialog.showMessageBox(window, { type: 'info', message: '统计与回放已可使用。生成 POV 前需要选择 CS2。', detail: '软件已附带录制工具。请先设置你已安装的 cs2.exe，录制前启动 Steam 并关闭普通 CS2。', buttons: ['选择 CS2', '稍后设置'], defaultId: 0, cancelId: 1 })
    if (result.response === 0) await chooseRecordingPath('CS2_EXE', 'CS2', 'cs2.exe')
  }
  if (process.env.CS2_DESKTOP_SMOKE === '1') {
    await new Promise(resolve => setTimeout(resolve, 1800))
    const state = await window.webContents.executeJavaScript('({title: document.title, text: document.body.innerText, api: window.csdemoDesktop?.apiBase})')
    const rendererHealth = await window.webContents.executeJavaScript('fetch(window.csdemoDesktop.apiBase + "/health/db").then(response => response.json())')
    if (rendererHealth.status !== 'ok') throw new Error('桌面页面无法连接便携数据库')
    const savedStorage = await window.webContents.executeJavaScript('localStorage.getItem("csdemo-portable-smoke") || (localStorage.setItem("csdemo-portable-smoke", "persisted"), "created")')
    const matches = await requestJson('/api/matches')
    fs.writeFileSync(path.join(portableData, 'desktop-smoke.json'), JSON.stringify({ ...state, port: BACKEND_PORT, health: rendererHealth, storage: savedStorage, matches }, null, 2))
    const picture = await window.webContents.capturePage()
    fs.writeFileSync(path.join(portableData, 'desktop-smoke.png'), picture.toPNG())
    if (matches.length) {
      await window.loadFile(path.join(root, 'web', 'dist', 'index.html'), { hash: `/replay/${matches[0].id}` })
      await new Promise(resolve => setTimeout(resolve, 3500))
      const replayText = await window.webContents.executeJavaScript('document.body.innerText')
      fs.writeFileSync(path.join(portableData, 'desktop-replay-smoke.txt'), replayText)
      const replayPicture = await window.webContents.capturePage()
      fs.writeFileSync(path.join(portableData, 'desktop-replay-smoke.png'), replayPicture.toPNG())
    }
    app.quit()
  }
}

function portableSettings() {
  if (!portable) return { available: false, version: app.getVersion(), recording: {}, tools: [] }
  return { available: true, version: app.getVersion(), recording: portable.recordingSettings(), tools: portable.recordingStatus() }
}

async function chooseRecordingPath(key, label, expected, notify = true) {
  const result = await dialog.showOpenDialog({ title: `选择 ${label}`, properties: ['openFile'], filters: [{ name: expected, extensions: ['exe'] }] })
  if (result.canceled) return false
  const file = result.filePaths[0]
  if (path.basename(file).toLowerCase() !== expected.toLowerCase()) {
    if (notify) await dialog.showMessageBox({ type: 'error', message: `请选择 ${expected}。` }); return false
  }
  if (key === 'HLAE_EXE' && !fs.existsSync(path.join(path.dirname(file), 'x64', 'AfxHookSource2.dll'))) {
    if (notify) await dialog.showMessageBox({ type: 'error', message: 'HLAE 目录缺少 x64/AfxHookSource2.dll，请选择完整解压的 HLAE。' }); return false
  }
  portable.saveRecordingPath(key, file)
  if (notify) await dialog.showMessageBox({ type: 'info', message: `${label} 已设置。`, detail: '下一次录制任务会使用新路径。' })
  return true
}
function installPortableMenu() {
  const recording = portable.recordingSettings()
  const saveRecording = (key, value) => { portable.saveRecordingSetting(key, value); installPortableMenu() }
  const resolutions = [
    ['1920x1080', '1920 × 1080（全高清）'],
    ['1600x900', '1600 × 900（常用）'],
    ['1280x720', '1280 × 720（轻量）'],
  ]
  const speeds = [
    ['1', '1×（正常速度）'],
    ['2', '2×（快速录制）'],
    ['4', '4×（测试录制）'],
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '应用', submenu: [{ label: '打开数据文件夹', click: () => shell.openPath(portableData) }, { label: '打开启动日志', click: () => shell.openPath(path.join(portableData, 'logs')) }, { type: 'separator' }, { role: 'quit', label: '退出' }] },
    { label: 'POV 录制设置', submenu: [
      ...[['CS2_EXE', 'CS2', 'cs2.exe'], ['HLAE_EXE', 'HLAE', 'HLAE.exe'], ['FFMPEG_EXE', 'FFmpeg', 'ffmpeg.exe'], ['FFPROBE_EXE', 'FFprobe', 'ffprobe.exe']].map(([key, label, exe]) => ({ label: `选择 ${label}…`, click: () => chooseRecordingPath(key, label, exe) })),
      { label: 'HLAE 录制选项', submenu: [
        { label: '录制分辨率', submenu: resolutions.map(([value, label]) => ({ label, type: 'radio', checked: recording.resolution === value, click: () => saveRecording('resolution', value) })) },
        { label: '录制处理速度', submenu: speeds.map(([value, label]) => ({ label, type: 'radio', checked: recording.speed === value, click: () => saveRecording('speed', value) })) },
        { label: '录制码率', submenu: ['auto','8','12','20','30','50'].map(value => ({ label: value === 'auto' ? '自动（默认画质）' : `${value} Mbps`, type: 'radio', checked: (recording.bitrate || 'auto') === value, click: () => saveRecording('bitrate', value) })) },
        { type: 'separator' },
        { label: '隐藏 HUD', type: 'checkbox', checked: recording.hideHud, click: item => saveRecording('hideHud', item.checked) },
        { label: '显示观战透视（X-Ray）', type: 'checkbox', checked: recording.showXray, click: item => saveRecording('showXray', item.checked) },
      ] },
      { type: 'separator' }, { label: '检查录制环境', click: async () => {
        const status = portable.recordingStatus()
        await dialog.showMessageBox({ type: status.every(item => item.ready) ? 'info' : 'warning', message: status.every(item => item.ready) ? '录制工具路径已就绪' : '还有录制工具未设置', detail: status.map(item => `${item.key.replace('_EXE', '')}：${item.ready ? '已找到' : '未找到'}`).join('\n') + '\n\n录制前请启动 Steam 并手动关闭正在运行的 CS2。' })
      } },
    ] },
    { label: '视图', submenu: [{ role: 'reload', label: '刷新页面' }, { role: 'togglefullscreen', label: '全屏' }] },
  ]))
}
app.whenReady().then(() => {
  if (!ownsInstanceLock) return
  ipcMain.handle('updates:state',()=>updater?.snapshot()||{available:false,currentVersion:app.getVersion(),autoCheck:true,status:'idle',message:''})
  ipcMain.handle('updates:check',()=>updater?.check())
  ipcMain.handle('updates:auto-check',(_event,enabled)=>updater?.setAutoCheck(enabled))
  ipcMain.handle('updates:open-link',(_event,key)=>{
    const url={bilibili:releaseConfig.authorBilibili,github:releaseConfig.authorGithub,project:releaseConfig.homepage,releases:`${releaseConfig.homepage}/releases`}[key]
    if(!url)throw new Error('无效的项目链接')
    return shell.openExternal(url)
  })
  ipcMain.handle('updates:install',async()=>{
    if(!updater||!portableBuild)throw new Error('当前环境不支持在线更新')
    if(installingUpdate)throw new Error('正在处理更新，请稍候')
    installingUpdate=true
    try{
    const ensureIdle=async()=>{const activity=await requestJson('/api/desktop/activity');if(pendingUploads.size||Object.values(activity).some(value=>Number(value)>0))throw new Error('请等待解析、导入和录制任务完成后更新')}
    await ensureIdle()
    if(updater.state.status!=='ready')await updater.prepare()
    await ensureIdle()
    await updater.launchInstaller()
    app.quit()
    return {installing:true}
    }finally{installingUpdate=false}
  })
  ipcMain.removeHandler('settings:get')
  ipcMain.removeHandler('settings:set-recording')
  ipcMain.removeHandler('settings:choose-path')
  ipcMain.removeHandler('settings:install-tools')
  ipcMain.removeHandler('settings:open-recording-cfg')
  ipcMain.handle('settings:open-recording-cfg', async () => {
    if (!portable) throw new Error('当前运行环境不支持录制 CFG')
    const file = portable.recordingCfgFile()
    await new Promise((resolve, reject) => {
      const editor = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe'), [file], { detached: true, stdio: 'ignore' })
      editor.once('error', reject)
      editor.once('spawn', () => { editor.unref(); resolve() })
    })
    return { path: file }
  })
  ipcMain.handle('settings:get', () => portableSettings())
  ipcMain.handle('settings:set-recording', (_event, key, value) => {
    if (!portable) throw new Error('当前运行环境不支持桌面设置')
    const allowed = { resolution: ['1920x1080', '1600x900', '1280x720'], speed: ['1', '2', '4'], bitrate: ['auto', '8', '12', '20', '30', '50'], hideHud: [true, false], showXray: [true, false] }
    if (!(key in allowed) || !allowed[key].includes(value)) throw new Error('无效的 HLAE 设置')
    portable.saveRecordingSetting(key, value)
    installPortableMenu()
    return portableSettings()
  })
  ipcMain.handle('settings:choose-path', async (_event, key) => {
    if (!portable) throw new Error('当前运行环境不支持桌面设置')
    const config = { CS2_EXE: ['CS2', 'cs2.exe'], HLAE_EXE: ['HLAE', 'HLAE.exe'], FFMPEG_EXE: ['FFmpeg', 'ffmpeg.exe'], FFPROBE_EXE: ['FFprobe', 'ffprobe.exe'] }[key]
    if (!config) throw new Error('无效的工具路径')
    const changed = await chooseRecordingPath(key, config[0], config[1], false)
    return { ...portableSettings(), changed }
  })
  ipcMain.handle('settings:install-tools', async (_event, key) => {
    if (!portable) throw new Error('当前运行环境不支持在线安装')
    if (!['HLAE_EXE', 'FFMPEG_EXE'].includes(key)) throw new Error('无效的工具类型')
    await portable.installRecordingTool(key)
    return portableSettings()
  })
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://127.0.0.1/*'] }, (details, callback) => {
    if (details.method === 'POST' && /\/api\/demos(?:\?|$)/.test(details.url)) pendingUploads.add(details.id)
    callback({})
  })
  session.defaultSession.webRequest.onCompleted(details => pendingUploads.delete(details.id))
  session.defaultSession.webRequest.onErrorOccurred(details => pendingUploads.delete(details.id))
  return createWindow()
}).catch(async error => {
  if (process.env.CS2_DESKTOP_SMOKE === '1') {
    fs.writeFileSync(path.join(portableData, 'desktop-smoke-error.txt'), String(error.stack || error)); app.exitCode = 1
  } else await dialog.showMessageBox({ type: 'error', title: 'CS2 Cam 启动失败', message: error.message, detail: portableBuild ? '数据已保留。启动日志位于软件目录的 data/logs。' : '请检查本地运行环境。' })
  app.quit()
})
app.on('before-quit', event => {
  if (!portable) { stopBackend(); return }
  if (quitting) return
  event.preventDefault()
  if (quitChecking) return
  quitChecking = true
  ;(async () => {
    if (process.env.CS2_DESKTOP_SMOKE !== '1' && portable.backend?.exitCode === null) {
      const activity = await requestJson('/api/desktop/activity').catch(() => null)
      if (!activity || pendingUploads.size || Object.values(activity).some(value => Number(value) > 0)) {
        const result = await dialog.showMessageBox({ type: 'warning', message: activity ? '仍有解析、导入或录制任务正在运行。' : '暂时无法确认后台任务状态。', detail: '退出会中断任务。录制中的 CS2 实例也可能关闭，建议等待任务完成。', buttons: ['继续等待', '退出并中断'], defaultId: 0, cancelId: 0 })
        if (result.response !== 1) { quitChecking = false; return }
      }
    }
    quitting = true
    updater?.stop()
    await portable.stop()
    app.quit()
  })().catch(error => { console.error(error); quitting = true; app.quit() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
