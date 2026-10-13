<!-- 武器统计页：汇总所有已加载比赛的规范化武器击杀与爆头数据。 -->
<script setup>
import { computed, onMounted } from 'vue'
import BaseChart from '../components/BaseChart.vue'
import { useDemoData } from '../composables/useDemoData'
import { weaponName } from '../lib/presentation'
import { axisStyle, tooltipStyle } from '../lib/echarts'

const { globalWeapons, loading, portalLoading, error, load, loadAllAnalytics } = useDemoData()
onMounted(async () => { await load(); await loadAllAnalytics() })
const weaponOption = computed(() => {
  const rows = globalWeapons.value.slice(0, 6).reverse()
  return {
    color: ['#c6ca4c', '#f4c65d'], tooltip: { ...tooltipStyle, trigger: 'axis' },
    legend: { data: ['非爆头', '爆头'], textStyle: { color: '#899397' } },
    grid: { left: 30, right: 30, top: 42, bottom: 20, containLabel: true },
    xAxis: { ...axisStyle, type: 'value' }, yAxis: { ...axisStyle, type: 'category', data: rows.map(item => weaponName(item.weapon)) },
    series: [{ name: '非爆头', type: 'bar', stack: 'kills', data: rows.map(item => Math.max(0, item.kills - item.headshots)), barWidth: 13 }, { name: '爆头', type: 'bar', stack: 'kills', data: rows.map(item => item.headshots), itemStyle: { borderRadius: [0, 5, 5, 0] } }]
  }
})
</script>

<template><main class="portal-page"><div v-if="loading" class="state">正在读取比赛数据…</div><div v-else-if="error" class="state error">{{ error }}</div><template v-else><section class="portal-hero"><div><div class="eyebrow">WEAPON DATABASE</div><h1>武器</h1><p>汇总所有已解析比赛的有效击杀</p></div><strong>{{ globalWeapons.length }}</strong></section><div v-if="portalLoading" class="state">正在汇总武器数据…</div><template v-else><section class="chart-card standalone-chart"><div class="chart-title"><div><small>TOP 6 WEAPON KILLS</small><h2>武器击杀构成</h2></div><span>击杀数前 6 · 绿色非爆头 · 黄色爆头</span></div><BaseChart :option="weaponOption" height="360px" /></section><section class="card portal-card"><div class="weapon-list"><div v-for="(weapon,index) in globalWeapons" :key="weapon.weapon" class="weapon-row"><strong>{{ index+1 }}</strong><b>{{ weaponName(weapon.weapon) }}</b><span><i :style="{width:(weapon.kills/(globalWeapons[0]?.kills||1)*100)+'%'}"></i></span><em>{{ weapon.kills }} 击杀</em><small>{{ weapon.headshots }} 爆头</small></div></div></section></template></template></main></template>

