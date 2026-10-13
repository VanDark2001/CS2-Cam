<!-- ECharts 通用包装组件：统一自动缩放行为并由调用方传入图表配置。 -->
<script setup>
import VChart from 'vue-echarts'
import '../lib/echarts'

defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '360px' }
})
</script>

<template><VChart class="echart" :option="option" autoresize :style="{height}" /></template>
