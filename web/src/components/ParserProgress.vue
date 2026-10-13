<!-- 全局解析进度条：离开解析页面后仍展示后台上传队列状态。 -->
<script setup>
import { useParserJobs } from '../composables/useParserJobs'
const { jobs, running, summary, progress } = useParserJobs()
</script>

<template><RouterLink v-if="jobs.length" to="/parser" class="global-parser-progress motion-progress" :class="{running}"><div><b>{{ running ? `正在检测/解析 ${summary.active} 个 Demo` : `处理完成 ${summary.done + summary.skipped}/${summary.total}` }}</b><span>{{ summary.skipped ? `${summary.skipped} 个跳过 · ` : '' }}{{ summary.failed ? `${summary.failed} 个失败 · ` : '' }}{{ progress }}%</span></div><i><em :style="{width:progress+'%'}"></em></i></RouterLink></template>
