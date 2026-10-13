<!-- 全局统计页：展示比赛、回合、击杀、高光和排行榜等汇总指标。 -->
<script setup>
import { computed, onMounted } from 'vue'
import BaseChart from '../components/BaseChart.vue'
import PlayerAvatar from '../components/PlayerAvatar.vue'
import { useDemoData } from '../composables/useDemoData'
import { mapName } from '../lib/presentation'
import { axisStyle, tooltipStyle } from '../lib/echarts'

const { globalPlayers, globalMaps, globalSummary, loading, portalLoading, error, load, loadAllAnalytics } = useDemoData()
onMounted(async () => { await load(); await loadAllAnalytics() })

const playerOption = computed(() => {
  const rows = globalPlayers.value.slice(0, 10).reverse()
  return {
    color: ['#c6ca4c', '#f4c65d'],
    tooltip: { ...tooltipStyle, trigger: 'axis' },
    legend: { data: ['击杀', '平均 ADR'], textStyle: { color: '#899397' }, top: 4 },
    grid: { left: 44, right: 48, top: 42, bottom: 24, containLabel: true },
    xAxis: [{ ...axisStyle, type: 'value', name: '击杀' }, { ...axisStyle, type: 'value', name: 'ADR', position: 'top' }],
    yAxis: { ...axisStyle, type: 'category', data: rows.map(item => item.name) },
    series: [
      { name: '击杀', type: 'bar', barWidth: 12, data: rows.map(item => item.kills), itemStyle: { borderRadius: [0, 5, 5, 0] } },
      { name: '平均 ADR', type: 'line', xAxisIndex: 1, data: rows.map(item => Number(item.adr)), symbolSize: 7, lineStyle: { width: 2 } }
    ]
  }
})

const mapOption = computed(() => ({
  color: ['#c6ca4c', '#4c8de8', '#f4c65d', '#f06b78', '#8f71e8', '#55b7c8'],
  tooltip: { ...tooltipStyle, trigger: 'item', formatter: '{b}<br/>比赛：{c} 场（{d}%）' },
  legend: { bottom: 4, textStyle: { color: '#899397' } },
  series: [{ type: 'pie', radius: ['45%', '68%'], center: ['50%', '44%'], label: { color: '#b9c1c4', formatter: '{b}\n{c}场' }, data: globalMaps.value.map(item => ({ name: mapName(item.map), value: item.matches })) }]
}))
</script>

<template>
  <main class="portal-page">
    <div v-if="loading" class="state">正在读取比赛数据…</div><div v-else-if="error" class="state error">{{ error }}</div>
    <template v-else><section class="portal-hero"><div><div class="eyebrow">GLOBAL OVERVIEW</div><h1>统计</h1><p>已解析 Demo 的总体数据</p></div></section><div v-if="portalLoading" class="state">正在计算总体统计…</div>
      <template v-else>
        <section class="metric-grid"><article><small>比赛</small><strong>{{ globalSummary.matches }}</strong></article><article><small>玩家</small><strong>{{ globalSummary.players }}</strong></article><article><small>正式回合</small><strong>{{ globalSummary.rounds }}</strong></article><article><small>有效击杀</small><strong>{{ globalSummary.kills }}</strong></article><article><small>多杀高光</small><strong>{{ globalSummary.highlights }}</strong></article><article><small>残局获胜</small><strong>{{ globalSummary.clutches }}</strong></article></section>
        <section class="chart-grid"><article class="chart-card chart-wide"><div class="chart-title"><div><small>PLAYER PERFORMANCE</small><h2>击杀与 ADR</h2></div><span>跨场前10名</span></div><BaseChart :option="playerOption" height="410px" /></article><article class="chart-card"><div class="chart-title"><div><small>MAP SHARE</small><h2>地图分布</h2></div><span>按比赛场次</span></div><BaseChart :option="mapOption" height="410px" /></article></section>
        <section class="card portal-card"><div class="card-head"><h2>击杀榜</h2><span>跨场 SteamID 汇总</span></div><div class="leader-grid"><div v-for="(player,index) in globalPlayers.slice(0,10)" :key="player.steamid"><em>{{ index+1 }}</em><PlayerAvatar :steamid="player.steamid" :name="player.name"/><b>{{ player.name }}</b><strong>{{ player.kills }}</strong><small>击杀</small></div></div></section>
      </template>
    </template>
  </main>
</template>
