import { reactive } from 'vue'
import { API, mapName } from '../lib/presentation'
import { readPovFavorites, samePovFavorite } from '../lib/povFavorites'

const state = reactive({ working: false, operation: '', message: '', status: '', progress: null, downloadUrl: '', fileName: '', matchId: null, pendingFavorites: [] })
let lastExport = null
async function responseData(response) {
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || `请求失败 (${response.status})`)
  return data
}
async function waitJob(id) {
  for (let i = 0; i < 4800; i++) {
    const job = await responseData(await fetch(`${API}/match-packages/jobs/${id}`))
    state.message = job.message
    if (job.status === 'failed') throw new Error(job.message)
    if (job.status === 'completed') return job
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error('处理仍在后台进行，请稍后检查比赛列表')
}
function reset(operation) {
  Object.assign(state, { working: true, operation, message: '', status: 'working', progress: null, downloadUrl: '', fileName: '', matchId: null, pendingFavorites: [] })
}
function mergeFavorites() {
  const current = readPovFavorites(localStorage.getItem('cs2-pov-favorites'))
  for (const incoming of state.pendingFavorites) {
    if (!current.some(existing => samePovFavorite(existing, incoming))) current.push(incoming)
  }
  // Importing never truncates existing bookmarks or overwrites local notes.
  localStorage.setItem('cs2-pov-favorites', JSON.stringify(current))
  state.pendingFavorites = []
  window.dispatchEvent(new Event('cs2-favorites-changed'))
}
async function exportMatch(id, scope = 'match') {
  if (state.working || !id) return
  state.working = true
  try {
    const favorites = readPovFavorites(localStorage.getItem('cs2-pov-favorites')).filter(item => Number(item?.matchId) === Number(id)).map(item => ({ ...item, title: item.title || `${mapName(item.map)} · 第 ${item.round} 回合` }))
    const recordings = await responseData(await fetch(`${API}/pov/exports?matchId=${id}`))
    const key = JSON.stringify({ id: Number(id), scope, favorites, recordings: recordings.map(job => ({ id: job.jobId, createdAt: job.createdAt, files: job.files })).sort((a,b) => String(a.id).localeCompare(String(b.id))) })
    if (lastExport?.key === key && !window.confirm('这个范围的比赛包已经生成过。是否重新打包？取消可继续使用原下载文件。')) {
      Object.assign(state, lastExport.result)
      return
    }
    reset('export')
    state.message = '正在准备比赛包'
    const started = await responseData(await fetch(`${API}/matches/${id}/package`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorites, scope }) }))
    const job = await waitJob(started.jobId)
    const base = API.replace(/\/api$/, '')
    state.downloadUrl = `${base}${job.downloadUrl}`
    state.fileName = job.fileName
    state.message = `${scope === 'favorites' ? '收藏包' : '整场比赛包'}已就绪 · ${job.viewCount ?? job.povCount} 个视角 · ${(job.bytes / 1024 / 1024).toFixed(1)} MB${job.missingViews ? ` · ${job.missingViews} 个收藏视角尚未生成` : ''}`
    state.status = 'completed'
    lastExport = { key, result: { operation: 'export', downloadUrl: state.downloadUrl, fileName: state.fileName, message: state.message, status: 'completed', matchId: null, pendingFavorites: [] } }
  } catch (error) { state.status = 'failed'; state.message = error.message }
  finally { state.working = false }
}
function upload(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API}/match-packages/import`)
    xhr.upload.onprogress = event => { if (event.lengthComputable) { state.progress = Math.round(event.loaded / event.total * 100); state.message = `正在上传比赛包 · ${state.progress}%` } }
    xhr.onerror = () => reject(new Error('上传中断，请检查后端连接'))
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText)
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.message || '导入请求失败')
        resolve(data)
      } catch (error) { reject(error) }
    }
    const data = new FormData(); data.append('file', file); xhr.send(data)
  })
}
async function importMatch(file) {
  if (state.working || !file) return
  if (!file.name.toLowerCase().endsWith('.csdemo') || file.size > 8 * 1024 ** 3) { state.status = 'failed'; state.message = '请选择 8GB 以内的 .csdemo 比赛包'; return }
  reset('import')
  try {
    state.message = '正在上传比赛包'
    const started = await upload(file)
    state.progress = null
    const job = await waitJob(started.jobId)
    state.matchId = job.matchId
    state.pendingFavorites = job.favorites || []
    try { mergeFavorites(); state.message = job.message }
    catch { state.message = '比赛和 POV 已导入，收藏保存失败，请重试合并收藏' }
    state.status = 'completed'
    // Imported rosters can contain SteamIDs that were not present in the
    // current avatar cache. Refresh image URLs after the backend's avatar
    // refresh job has been queued so mounted player cards retry them.
    localStorage.setItem('cs2-avatar-refresh', String(Date.now()))
    window.dispatchEvent(new Event('cs2-avatars-refreshed'))
    window.dispatchEvent(new CustomEvent('cs2-match-imported', { detail: job.matchId }))
  } catch (error) { state.status = 'failed'; state.message = error.message }
  finally { state.progress = null; state.working = false }
}
export const useMatchPackages = () => ({ state, exportMatch, importMatch, mergeFavorites })
