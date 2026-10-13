// Demo 任务队列：负责文件去重、受控并发上传、状态汇总和完成后刷新数据。
import { computed, ref } from 'vue'
import { API } from '../lib/presentation'
import { useDemoData } from './useDemoData'

// Keep the store on the browser global as well as module scope. This prevents
// a lazy route chunk and the global progress component from getting separate
// queues after navigation or a development chunk reload.
const parserStore = globalThis.__cs2DemoParserStore || (globalThis.__cs2DemoParserStore = { jobs: ref([]), running: ref(false), concurrency: ref(1) })
const { jobs, running, concurrency } = parserStore
const summary = computed(() => ({ total: jobs.value.length, done: jobs.value.filter(job => job.status === 'success').length, skipped: jobs.value.filter(job => job.status === 'skipped').length, failed: jobs.value.filter(job => job.status === 'failed').length, active: jobs.value.filter(job => job.status === 'uploading').length }))
const progress = computed(() => summary.value.total ? Math.round((summary.value.done + summary.value.skipped + summary.value.failed) * 100 / summary.value.total) : 0)

function sizeLabel(bytes) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }
function isDemoInput(file) { const name = String(file?.name || '').toLowerCase(); return name.endsWith('.dem') || name.endsWith('.zip') }
function addFiles(fileList) {
  // 浏览器端使用名称、大小和修改时间过滤本次队列中的重复选择。
  if (running.value) return
  const known = new Set(jobs.value.map(job => `${job.file.name}:${job.file.size}:${job.file.lastModified}`))
  for (const file of fileList || []) {
    if (!isDemoInput(file)) continue
    const key = `${file.name}:${file.size}:${file.lastModified}`
    if (!known.has(key)) { jobs.value.push({ id: crypto.randomUUID(), file, status: 'queued', message: '等待解析' }); known.add(key) }
  }
}
function removeJob(id) { if (!running.value) jobs.value = jobs.value.filter(job => job.id !== id) }
async function parseJob(job) {
  // 后端在一个请求内完成上传、解析和临时文件清理，前端只维护任务状态。
  job.status = 'uploading'; job.message = '正在上传并解析'
  const body = new FormData(); body.append('file', job.file); body.append('recordedAt', String(job.file.lastModified || 0))
  try {
    const response = await fetch(`${API}/demos`, { method: 'POST', body }); const result = await response.json().catch(() => ({}))
    if (!response.ok) throw Error(result.message || `HTTP ${response.status}`)
    if (result.status === 'skipped') { job.status = 'skipped'; job.message = result.message || '数据库已存在，已跳过' }
    else { job.status = 'success'; job.message = '已写入 SQLite' }
  } catch (exception) { job.status = 'failed'; job.message = exception.message || '解析失败' }
}
async function startBatch() {
  if (running.value || !jobs.value.length) return
  const pending = jobs.value.filter(job => !['success','skipped'].includes(job.status)); pending.forEach(job => { job.status = 'queued'; job.message = '等待解析' }); running.value = true
  // 多个 worker 共用单调递增游标，限制并发量且保证每个任务只被领取一次。
  let cursor = 0; const worker = async () => { while (cursor < pending.length) await parseJob(pending[cursor++]) }
  await Promise.all(Array.from({ length: Math.min(Number(concurrency.value), pending.length) }, worker)); running.value = false
  // DemoService refreshes its match snapshot asynchronously after parsing.
  // Poll briefly so the current page sees the new match without a manual reload.
  const data = useDemoData()
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise(resolve => setTimeout(resolve, attempt ? 600 : 250))
    await data.load(null, true)
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('cs2-demo-parsed'))
}

export function useParserJobs() { return { jobs, running, concurrency, summary, progress, sizeLabel, addFiles, removeJob, startBatch } }

