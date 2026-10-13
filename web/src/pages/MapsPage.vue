<!-- 地图统计页：聚合正式回合的 CT/T 胜率并生成对比图表。 -->
<script setup>
import { computed, onMounted } from 'vue'
import BaseChart from '../components/BaseChart.vue'
import { useDemoData } from '../composables/useDemoData'
import { mapName } from '../lib/presentation'
import { axisStyle, tooltipStyle } from '../lib/echarts'

const { globalMaps, loading, portalLoading, error, load, loadAllAnalytics } = useDemoData()
onMounted(async () => { await load(); await loadAllAnalytics() })
const mapChartOption = computed(() => ({
  color: ['#4f93ee', '#e8a844'],
  tooltip: { ...tooltipStyle, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: '#26313655' } }, formatter: params => { const item = globalMaps.value[params?.[0]?.dataIndex]; if (!item) return ''; return `<b>${mapName(item.map)}</b><br/>比赛场次　${item.matches} 场<br/>正式回合　${item.rounds} 回合<br/><span style="color:#4f93ee">●</span> CT 胜率　${item.ctWinRate}%（${item.ctWins} 回合）<br/><span style="color:#e8a844">●</span> T 胜率　 ${item.tWinRate}%（${item.tWins} 回合）` } },
  legend: { top: 8, left: 'center', data: ['CT 胜率', 'T 胜率'], itemWidth: 22, itemHeight: 10, itemGap: 28, textStyle: { color: '#a8b0b4', fontSize: 12 } },
  grid: { left: 40, right: 32, top: 72, bottom: 54, containLabel: true },
  xAxis: { ...axisStyle, type: 'category', data: globalMaps.value.map(item => mapName(item.map)), axisLabel: { color: '#aab2b6', interval: 0, margin: 18, fontSize: 12 }, axisLine: { lineStyle: { color: '#3a4448' } } },
  yAxis: { ...axisStyle, type: 'value', name: '胜率', nameGap: 20, min: 0, max: 100, interval: 20, axisLabel: { color: '#899397', margin: 12, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#2a3438', type: 'dashed' } } },
  series: [
    { name: 'CT 胜率', type: 'bar', data: globalMaps.value.map(item => item.ctWinRate), barMaxWidth: 42, barGap: '18%', barCategoryGap: '62%', itemStyle: { borderRadius: [7, 7, 2, 2] }, label: { show: true, position: 'top', distance: 10, color: '#91bcf6', fontWeight: 600, formatter: '{c}%' }, emphasis: { focus: 'series' } },
    { name: 'T 胜率', type: 'bar', data: globalMaps.value.map(item => item.tWinRate), barMaxWidth: 42, itemStyle: { borderRadius: [7, 7, 2, 2] }, label: { show: true, position: 'top', distance: 10, color: '#f1bf6c', fontWeight: 600, formatter: '{c}%' }, emphasis: { focus: 'series' } }
  ]
}))
</script>

<template><main class="portal-page"><div v-if="loading" class="state">正在读取比赛数据…</div><div v-else-if="error" class="state error">{{ error }}</div><template v-else><section class="portal-hero"><div><div class="eyebrow">MAP POOL</div><h1>地图</h1><p>按正式回合统计各地图 CT 与 T 的胜率</p></div><strong>{{ globalMaps.length }}</strong></section><div v-if="portalLoading" class="state">正在汇总地图数据…</div><template v-else><section class="chart-card standalone-chart map-winrate-card"><div class="chart-title"><div><small>SIDE WIN RATE</small><h2>地图 CT / T 胜率对比</h2></div><span>仅统计正式 round_end 回合</span></div><BaseChart :option="mapChartOption" height="470px" /></section></template></template></main></template>
