<!-- ECharts 通用包装组件：统一自动缩放行为并由调用方传入图表配置。 -->
<script setup>
import { computed } from 'vue'
import { activeTheme } from '../lib/theme'
import textPalette from '../lib/chartPalette.json'
import VChart from 'vue-echarts'
import '../lib/echarts'

const props = defineProps({
  option: { type: Object, required: true },
  height: { type: String, default: '360px' }
})
function adapt(value, key = '') {
  if (Array.isArray(value)) return value.map(item => adapt(item, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, adapt(v,k)]))
  if (activeTheme.value === 'light' && typeof value === 'string') {
    if (key === 'backgroundColor' && /^#[0-3]/i.test(value)) return '#fafaf5'
    if (key === 'borderColor') return '#c7cbc0'
    if (key === 'color' && /^#[0-9a-f]{6}$/i.test(value)) {
      const rgb=[1,3,5].map(index=>parseInt(value.slice(index,index+2),16))
      if (Math.max(...rgb)-Math.min(...rgb)<50 && (rgb[0]+rgb[1]+rgb[2])/3>120) return '#62695c'
    }
    if (key === 'color') return textPalette[value] || ({'#899397':'#62695c','#364044':'#bec4b5','#283034':'#dde0d5','#e5e9ea':'#20231e'})[value] || value
  }
  return value
}
const themedOption = computed(() => {
  const value = adapt(props.option)
  return activeTheme.value === 'light' ? { ...value, textStyle:{...value.textStyle,color:'#20231e'}, legend: { ...value.legend, textStyle:{...value.legend?.textStyle,color:'#62695c'} } } : value
})
</script>

<template><VChart class="echart" :option="themedOption" autoresize :style="{height}" /></template>
