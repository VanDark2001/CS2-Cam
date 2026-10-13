<!-- Demo 解析页：管理批量文件队列、并发数、任务状态和失败原因。 -->
<script setup>
import { useParserJobs } from '../composables/useParserJobs'
import MatchPackageControls from '../components/MatchPackageControls.vue'
import { useMatchPackages } from '../composables/useMatchPackages'
const { jobs, running, concurrency, summary, sizeLabel, addFiles, removeJob, startBatch } = useParserJobs()
const { importMatch } = useMatchPackages()

function splitFiles(fileList) {
  const demos = [], packages = []
  for (const file of fileList || []) (String(file.name || '').toLowerCase().endsWith('.csdemo') ? packages : demos).push(file)
  if (packages.length) importMatch(packages[0])
  addFiles(demos)
}
function chooseFiles(event) { splitFiles(event.target.files); event.target.value = '' }
function dropFiles(event) { splitFiles(event.dataTransfer?.files) }
</script>

<template>
  <main class="portal-page parser-page">
    <section class="portal-hero" data-motion="reveal"><div><div class="eyebrow">DEMO INGEST CONSOLE</div><h1>Demo 解析后台</h1><p>批量上传、并发解析，统计写入 SQLite；保留 Demo 供后续 POV 录制</p></div><strong>{{ summary.total }}</strong></section>
    <section class="parser-grid" data-motion="reveal">
      <div class="parser-control card"><label class="batch-drop" @dragover.prevent @drop.prevent="dropFiles"><input type="file" accept=".dem,.zip,.csdemo" multiple :disabled="running" @change="chooseFiles"><span>⇧</span><b>选择或拖入 Demo / 比赛包</b><small>支持 .dem、仅含一个 Demo 的 .zip，或 .csdemo 比赛包；Demo 单文件最大 512MB</small></label><div class="concurrency"><div><b>并发解析数</b><small>同时启动的 Python 解析进程</small></div><select aria-label="并发解析数" v-model="concurrency" :disabled="running"><option :value="1">1 个</option><option :value="2">2 个</option><option :value="3">3 个</option></select></div><button class="primary ef-button ef-button--primary" :disabled="running||!jobs.length" @click="startBatch">{{ running ? `解析中（${summary.active} 个运行）` : `开始解析 ${jobs.length} 个 Demo` }}</button></div>
      <div class="parser-summary"><article><small>队列</small><strong>{{ summary.total }}</strong></article><article><small>成功</small><strong>{{ summary.done }}</strong></article><article><small>跳过</small><strong>{{ summary.skipped }}</strong></article><article><small>失败</small><strong>{{ summary.failed }}</strong></article></div>
    </section>
    <section class="card parser-queue" data-motion="reveal"><div class="card-head"><div><h2>解析与导入队列</h2><span>Demo 进入解析队列；比赛包直接导入并在这里显示进度</span></div><MatchPackageControls :allow-import="false" /></div><div v-if="!jobs.length" class="panel-empty">尚未选择 Demo 文件</div><div v-for="job in jobs" :key="job.id" class="parser-job"><span class="job-state" :class="job.status">{{ job.status === 'success' ? '✓' : job.status === 'skipped' ? '↷' : job.status === 'failed' ? '!' : job.status === 'uploading' ? '↻' : '…' }}</span><div><b>{{ job.file.name }}</b><small>{{ sizeLabel(job.file.size) }}</small><p v-if="job.status==='failed'" class="job-error">失败原因：{{ job.message }}</p><p v-else class="job-message">{{ job.message }}</p></div><span class="job-label" :class="job.status">{{ { queued: '等待中', uploading: '检测/解析中', success: '成功', skipped: '已跳过', failed: '失败' }[job.status] }}</span><button class="ef-button ef-button--danger ef-button--icon" :aria-label="`移除 ${job.file.name}`" :disabled="running" @click="removeJob(job.id)">×</button></div></section>
  </main>
</template>

