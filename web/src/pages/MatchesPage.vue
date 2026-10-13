<!-- 比赛详情页：选择单场比赛并展示双方阵容、数据、高光、武器和残局。 -->
<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PlayerAvatar from '../components/PlayerAvatar.vue'
import MapIcon from '../components/MapIcon.vue'
import EndfieldIcon from '../components/EndfieldIcon.vue'
import BaseChart from '../components/BaseChart.vue'
import MatchPackageControls from '../components/MatchPackageControls.vue'
import { matchTime } from '../lib/matchDisplay'
import { useDemoData } from '../composables/useDemoData'
import { API, mapName, scoreTone, scoreValues, weaponName } from '../lib/presentation'
import { matchTitle, readMatchTitles, writeMatchTitles } from '../lib/matchTitles'
import { axisStyle, tooltipStyle } from '../lib/echarts'

const route = useRoute()
let editorScrollY = 0
function focusTitleEditor(element) { const input = element.querySelector('input'); if (input) { input.focus({ preventScroll: true }); input.select() }; window.scrollTo({ top: editorScrollY, behavior: 'auto' }) }
const router = useRouter()
const { matches, active, analytics, loading, analyticsLoading, error, load, selectMatch } = useDemoData()
const tab = ref('overview')
const analysisHeight = ref(0)
function retainAnalysisHeight(element) {
  if (element) analysisHeight.value = Math.max(analysisHeight.value, element.getBoundingClientRect().height)
}
const deleting = ref(false)
const matchTitles = ref(readMatchTitles())
const editingTitle = ref(false), titleDraft = ref('')
const selectedMap = ref('all')
const expandedPlayer = ref('')
const page = ref(1)
const pageSize = 8
const tabs = [['overview', '综合数据'], ['kills', '击杀分析'], ['highlights', '高光'], ['weapons', '武器统计'], ['clutches', '残局分析']]
const mapOptions = computed(() => [...new Set(matches.value.map(match => match.map))].sort())
const filteredMatches = computed(() => selectedMap.value === 'all' ? matches.value : matches.value.filter(match => match.map === selectedMap.value))
const pageCount = computed(() => Math.max(1, Math.ceil(filteredMatches.value.length / pageSize)))
const pagedMatches = computed(() => filteredMatches.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch(pageCount, count => { page.value = Math.min(page.value, count) })
watch(() => active.value?.id, id => {
  const index = filteredMatches.value.findIndex(match => match.id === id)
  if (index >= 0) page.value = Math.floor(index / pageSize) + 1
})
const players = computed(() => active.value?.players || [])
const displayTitle = match => matchTitle(match, matchTitles.value, mapName(match?.map))
function editTitle() { editorScrollY = window.scrollY; titleDraft.value = displayTitle(active.value); editingTitle.value = true; nextTick(() => window.scrollTo({ top: editorScrollY, behavior: 'auto' })) }
function saveTitle() {
  if (!active.value) return
  const id = String(active.value.id), next = titleDraft.value.trim(), titles = { ...matchTitles.value }
  if (next) titles[id] = next
  else delete titles[id]
  matchTitles.value = titles
  writeMatchTitles(titles)
  editingTitle.value = false
}
const refreshMatchTitles = () => { matchTitles.value = readMatchTitles() }
const closeTitleEditor = event => { if (editingTitle.value && !event?.target?.closest?.('.match-title-edit')) saveTitle() }
const imported = event => load(event.detail, true)
onMounted(() => { document.addEventListener('pointerdown', closeTitleEditor); window.addEventListener('cs2-match-imported', imported); window.addEventListener('cs2-match-titles-changed', refreshMatchTitles) })
onUnmounted(() => { document.removeEventListener('pointerdown', closeTitleEditor); window.removeEventListener('cs2-match-imported', imported); window.removeEventListener('cs2-match-titles-changed', refreshMatchTitles) })
const teamNumbers = computed(() => [...new Set(players.value.map(player => player.teamNumber).filter(value => value != null))].sort((a, b) => b - a))
const groups = computed(() => [{ name: 'A组', rows: players.value.filter(player => player.teamNumber === teamNumbers.value[0]) }, { name: 'B组', rows: players.value.filter(player => player.teamNumber === teamNumbers.value[1]) }])
const killRanking = computed(() => [...players.value].sort((a, b) => Number(b.kills || 0) - Number(a.kills || 0)))
const matchChartOption = computed(() => ({
  color: ['#c6ca4c', '#4c8de8'], tooltip: { ...tooltipStyle, trigger: 'axis' },
  legend: { data: ['击杀', 'ADR'], textStyle: { color: '#899397' } },
  grid: { left: 28, right: 38, top: 44, bottom: 54, containLabel: true },
  xAxis: { ...axisStyle, type: 'category', data: players.value.map(player => player.name), axisLabel: { color: '#899397', rotate: 24 } },
  yAxis: [{ ...axisStyle, type: 'value', name: '击杀' }, { ...axisStyle, type: 'value', name: 'ADR' }],
  series: [{ name: '击杀', type: 'bar', data: players.value.map(player => player.kills), barMaxWidth: 24, itemStyle: { borderRadius: [4, 4, 0, 0] } }, { name: 'ADR', type: 'line', yAxisIndex: 1, data: players.value.map(player => player.adr), symbolSize: 7, lineStyle: { width: 2 } }]
}))

watch(() => route.params.id, async id => {
  editingTitle.value = false
  await load(id)
  if (id) {
    await selectMatch(id)
    if (active.value && active.value.id !== Number(id)) await router.replace({ name: 'matches', params: { id: active.value.id } })
  }
  tab.value = 'overview'
}, { immediate: true })

function chooseMatch(match) {
  router.push({ name: 'matches', params: { id: match.id } })
}

function filterMatches() {
  page.value = 1
  if (!filteredMatches.value.some(match => match.id === active.value?.id) && filteredMatches.value[0]) chooseMatch(filteredMatches.value[0])
}

function openReplay() { router.push({ name: 'replay', params: { id: active.value.id } }) }
async function deleteCurrentMatch() { if (!active.value || deleting.value || !window.confirm('确定删除本场比赛及其录制文件吗？')) return; deleting.value=true; try { const r=await fetch(`${API}/matches/${active.value.id}`,{method:'DELETE'}); if(!r.ok) throw new Error('删除比赛失败'); const deletedId=active.value.id; matches.value=matches.value.filter(m=>m.id!==deletedId); active.value=null; const next=matches.value[0]; if(next) await router.replace({name:'matches',params:{id:next.id}}); else await router.replace({name:'matches'}); await load(null,true) } catch(e) { window.alert(e.message) } finally { deleting.value=false } }

function openPlayer(player) {
  router.push({ name: 'player-detail', params: { steamid: player.steamid } })
}
function togglePlayerRow(player) { expandedPlayer.value = expandedPlayer.value === String(player.steamid) ? '' : String(player.steamid) }
function expandedMetrics(player) {
  return [
    ['狙杀', player.sniperKills ?? '—'],
    ['残局次数', player.clutchCount ?? '—'],
    ['首杀', player.firstKills ?? '—'],
    ['闪光致盲', player.flashBlindCount ?? '—'],
    ['道具伤害', player.utilityDamage ?? '—'],
    ['投掷数', player.thrownCount ?? '—'],
    ['多杀回合', player.multiKillRounds ?? '—'],
    ['首死', player.firstDeaths ?? '—'],
  ]
}
</script>

<template>
  <div class="workspace">
    <aside class="match-sidebar paginated-sidebar"><div class="sidebar-head"><div><small>MATCH HISTORY</small><h3>比赛记录</h3></div><span>{{ filteredMatches.length }}</span></div><label class="map-filter"><span>地图筛选</span><select v-model="selectedMap" @change="filterMatches"><option value="all">全部地图</option><option v-for="map in mapOptions" :key="map" :value="map">{{ mapName(map) }}</option></select></label><div v-if="!filteredMatches.length&&!loading" class="empty-list">没有符合条件的比赛</div><Transition name="sidebar-slide" mode="out-in"><div :key="page" class="sidebar-matches"><button v-for="match in pagedMatches" :key="match.id" class="match-item" :class="{selected:active?.id===match.id}" @click="chooseMatch(match)"><MapIcon :map="match.map" :label="mapName(match.map)"/><span class="match-copy"><b>{{ mapName(match.map) }}</b><time :title="matchTime(match.date,match.dateSource)">{{ matchTime(match.date,match.dateSource) }}</time><em>{{ match.server||'未知服务器' }}</em></span><strong v-if="scoreValues(match.score).length===2" class="match-score"><span :class="scoreTone(match.score,0)">{{ scoreValues(match.score)[0] }}</span><i>:</i><span :class="scoreTone(match.score,1)">{{ scoreValues(match.score)[1] }}</span></strong><strong v-else>{{ match.score }}</strong></button></div></Transition><div class="sidebar-pagination" aria-label="比赛列表分页"><button :disabled="page===1" aria-label="上一页" @click="page--">‹</button><label>第 <select v-model.number="page" aria-label="选择页码"><option v-for="number in pageCount" :key="number" :value="number">{{ number }}</option></select> / {{ pageCount }} 页</label><button :disabled="page===pageCount" aria-label="下一页" @click="page++">›</button><small>每页 {{ pageSize }} 场 · 共 {{ filteredMatches.length }} 场</small></div></aside>
    <main>
      <Transition name="detail-slide" mode="out-in">
      <div :key="`${active?.id || 'empty'}`" class="match-detail-pane">
      <template v-if="active">
        <section class="hero">
          <div class="match-heading">
            <div class="eyebrow">MATCH OVERVIEW · {{ active.tickRate }} TICK</div>
            <div class="match-title-slot"><Transition name="title-editor" mode="out-in" @after-enter="focusTitleEditor"><div v-if="editingTitle" key="editor" class="match-title-edit"><input v-model="titleDraft" maxlength="120" aria-label="比赛记录标题" @keyup.enter="saveTitle" @keyup.esc="editingTitle=false"></div><h1 v-else key="title" class="editable-match-title" title="点击修改比赛标题" @click="editTitle">{{ displayTitle(active) }} <strong v-if="scoreValues(active.score).length===2" class="hero-score"><span :class="scoreTone(active.score,0)">{{ scoreValues(active.score)[0] }}</span><i>:</i><span :class="scoreTone(active.score,1)">{{ scoreValues(active.score)[1] }}</span></strong></h1></Transition></div>
            <p>{{ active.map }} <i>·</i> {{ matchTime(active.date,active.dateSource) }} <i>·</i> {{ active.server }}</p>
          </div>
          <span class="match-stream-label" aria-hidden="true">01 / MATCH DATA</span>
        </section>
        <div class="match-action-area" aria-label="比赛操作">
          <button class="ef-button ef-button--toolbar" @click="openReplay"><EndfieldIcon name="replay" :size="14" />2D 回放</button>
          <MatchPackageControls :match-id="active.id" :allow-import="false" />
          <button class="ef-button ef-button--danger delete-match" :disabled="deleting" @click="deleteCurrentMatch"><EndfieldIcon name="remove" :size="14" />{{ deleting ? '删除中…' : '删除比赛' }}</button>
        </div>
      </template>
      <div v-else class="empty-match-import"><p>还没有比赛记录，请先在解析 Demo 页面导入或解析比赛。</p><RouterLink class="ef-button ef-button--toolbar" to="/parser"><EndfieldIcon name="upload" :size="14" />前往解析 Demo</RouterLink></div>
      </div>
      </Transition>
      <div class="tabs" aria-label="比赛统计分类"><button type="button" v-for="item in tabs" :key="item[0]" :class="{selected:tab===item[0]}" :aria-pressed="tab===item[0]" @click="tab=item[0]">{{ item[1] }}</button></div>
      <div class="match-analysis-slot" :style="{ minHeight: analysisHeight + 'px' }">
      <Transition name="analysis-slide" mode="out-in" @before-leave="retainAnalysisHeight" @after-enter="retainAnalysisHeight" appear>
      <div :key="`${active?.id || 'empty'}-${tab}`" class="match-analysis-pane">
      <div v-if="loading" class="state">正在读取比赛数据…</div><div v-else-if="error" class="state error">{{ error }}</div>
      <template v-else-if="active&&tab==='overview'"><section class="card"><div class="card-head"><h2>玩家表现</h2><span>点击卡片展开当局数据；点击头像进入玩家个人数据</span></div><div class="table"><div class="tr th"><span>玩家</span><span>K / A / D</span><span>ADR</span><span>爆头率</span><span>爆头</span><span>Rating</span><span>WE ⓘ</span></div><template v-for="(group,groupIndex) in groups" :key="group.name"><div class="team-title"><strong>{{ group.name }}</strong><b v-if="scoreValues(active.score).length===2">{{ scoreValues(active.score)[groupIndex] }}</b></div><template v-for="(player,index) in group.rows" :key="player.steamid"><div class="tr player-link" :class="{expanded:expandedPlayer===String(player.steamid)}" role="button" tabindex="0" @click="togglePlayerRow(player)" @keydown.enter.prevent="togglePlayerRow(player)"><span class="player"><em :class="{gold:index===0}">{{ index+1 }}</em><span class="player-avatar-link" title="打开玩家个人数据" @click.stop="openPlayer(player)"><PlayerAvatar :steamid="player.steamid" :name="player.name"/></span><b>{{ player.name }}</b></span><span>{{ player.kills }} / {{ player.assists }} / {{ player.deaths }}</span><span :class="{green:player.adr>=100,red:player.adr<60}">{{ player.adr }}</span><span>{{ player.hs }}%</span><span>{{ player.aim }}</span><span class="rating">{{ Number(player.rating||0).toFixed(2) }}</span><span>{{ Number(player.we || 0).toFixed(1) }}</span></div><Transition name="player-expand"><div v-if="expandedPlayer===String(player.steamid)" class="player-expanded"><div v-for="metric in expandedMetrics(player)" :key="metric[0]"><b>{{ metric[1] }}</b><small>{{ metric[0] }}</small></div></div></Transition></template></template></div></section></template>
      <template v-else-if="active&&tab==='kills'"><section class="card match-chart"><div class="card-head"><h2>击杀与 ADR</h2><span>本场10名玩家</span></div><BaseChart :option="matchChartOption" height="330px" /></section><section class="card analysis-card"><div class="card-head"><h2>击杀分析</h2><span>正式比赛区间 · 三杀及以上计入多杀回合</span></div><div class="ranking"><div v-for="(player,index) in killRanking" :key="player.steamid" class="rank-row player-link" role="link" tabindex="0" @click="openPlayer(player)" @keydown.enter="openPlayer(player)"><strong>{{ index+1 }}</strong><PlayerAvatar :steamid="player.steamid" :name="player.name"/><b>{{ player.name }}</b><div><small>击杀</small><em>{{ player.kills }}</em></div><div><small>爆头</small><em>{{ player.aim }}</em></div><div><small>爆头率</small><em>{{ player.hs }}%</em></div><div><small>多杀回合</small><em>{{ player.multiKillRounds||0 }}</em></div></div></div></section></template>
      <section v-else-if="active&&tab==='highlights'" class="card analysis-card"><div class="card-head"><h2>多杀高光</h2><span>单回合至少完成 3 次击杀</span></div><div v-if="analyticsLoading" class="panel-empty">正在加载…</div><div v-else class="highlight-grid"><RouterLink v-for="item in analytics.highlights" :key="item.steamid+'-'+item.round" class="highlight" :to="{name: 'replay', params: {id: active.id}, query: {round: item.round}}" :aria-label="`${item.player}，第 ${item.round} 回合，打开 2D 回放`"><span>R{{ item.round }}</span><div><b>{{ item.player }}</b></div><strong>{{ item.kills }}K</strong></RouterLink><div v-if="!analytics.highlights?.length" class="panel-empty">没有三杀及以上高光数据</div></div></section>
      <section v-else-if="active&&tab==='weapons'" class="card analysis-card"><div class="card-head"><h2>武器统计</h2><span>按击杀数排序</span></div><div class="weapon-list"><div v-for="(weapon,index) in analytics.weapons" :key="weapon.weapon" class="weapon-row"><strong>{{ index+1 }}</strong><b>{{ weaponName(weapon.weapon) }}</b><span><i :style="{width:(weapon.kills/(analytics.weapons[0]?.kills||1)*100)+'%'}"></i></span><em>{{ weapon.kills }} 击杀</em><small>{{ weapon.headshots }} 爆头</small></div><div v-if="!analytics.weapons?.length" class="panel-empty">没有武器数据</div></div></section>
      <section v-else-if="active&&tab==='clutches'" class="card analysis-card"><div class="card-head"><h2>残局分析</h2><span>成为最后一名存活队员并赢下该回合</span></div><div v-if="analyticsLoading" class="panel-empty">正在加载…</div><div v-else class="highlight-grid"><RouterLink v-for="item in analytics.clutches" :key="item.steamid+'-'+item.round" class="highlight clutch" :to="{name: 'replay', params: {id: active.id}, query: {round: item.round}}" :aria-label="`${item.player}，第 ${item.round} 回合，打开 2D 回放`"><span>R{{ item.round }}</span><div><b>{{ item.player }}</b></div><strong>1v{{ item.x }}</strong></RouterLink><div v-if="!analytics.clutches?.length" class="panel-empty">没有可确认的残局获胜数据</div></div></section>
      </div>
      </Transition>
      </div>
    </main>
  </div>
</template>

<style scoped>
.highlight { color: var(--color-text-primary); text-decoration: none; cursor: pointer; }
.highlight:hover { border-color: var(--color-brand); background: var(--color-control-hover); }
.highlight:focus-visible { outline: 2px solid var(--color-brand); outline-offset: 2px; }
.player-link.expanded { background: color-mix(in srgb, var(--color-brand) 8%, transparent); }
.team-title { display:flex; align-items:center; justify-content:space-between; }
.team-title b { color:var(--color-brand); font:700 18px 'Barlow Condensed'; letter-spacing:.4px; }
.player-avatar-link { display:inline-flex; cursor:pointer; border-radius:50%; }
.player-avatar-link:hover { outline:2px solid var(--color-brand); outline-offset:2px; }
.player-expanded { grid-column:1/-1; display:grid; grid-template-columns:repeat(8,minmax(0,1fr)); gap:8px; padding:12px 18px 14px 52px; background:#171d1d; border-top:1px solid var(--color-border); border-bottom:1px solid var(--color-border); transform-origin:top; }
.player-expand-enter-active,.player-expand-leave-active { overflow:hidden; transition:opacity 180ms var(--motion-ease-standard), transform 220ms var(--motion-ease-standard), max-height 220ms var(--motion-ease-standard), padding 220ms var(--motion-ease-standard); max-height:180px; }
.player-expand-enter-from,.player-expand-leave-to { opacity:0; transform:translateY(-8px) scaleY(.96); max-height:0; padding-top:0; padding-bottom:0; }
.player-expanded>div { min-width:0; padding:8px 10px; background:#202827; text-align:center; }
.player-expanded b { display:block; color:var(--color-brand); font:700 18px 'Barlow Condensed'; }
.player-expanded small { display:block; margin-top:3px; color:var(--color-text-secondary); font-size:10px; }
.match-copy time { font-size: 11px; line-height: 1.5; color: var(--color-text-secondary); white-space: normal; overflow-wrap: anywhere; letter-spacing: 0; }
.match-heading { min-width: 0; flex:1; }
.match-heading h1{margin-bottom:8px}
.editable-match-title{cursor:text}.editable-match-title:hover{color:var(--color-brand)}
.match-title-slot{position:relative;height:clamp(58px,5vw,82px);margin:0 0 8px;}
.match-title-edit{position:absolute;z-index:2;inset:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;height:100%;margin:0;box-sizing:border-box}
.match-title-edit input{flex:1 1 auto;width:100%;min-width:0;height:100%;box-sizing:border-box;background:var(--color-page-bg);border:1px solid var(--color-border);color:var(--color-text-primary);padding:0 4px;border-radius:2px;font:inherit;font-size:clamp(38px,4vw,56px);line-height:1.05;font-weight:700}
.editable-match-title{height:100%;min-height:0;box-sizing:border-box;display:flex;align-items:center;margin:0}
.edit-match-title{padding:3px 7px;font-size:10px}
.match-stream-label { flex: none; align-self: flex-start; color: #77796f; font-size: 9px; letter-spacing: 1.6px; padding-top: 3px; }
.match-action-area { display: flex; align-items: flex-start; gap: 8px; margin: 22px 5% 0; min-width: 0; }
.match-action-area .package-controls { flex: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.match-action-area :deep(.package-buttons), .match-action-area :deep(.package-status) { justify-content: flex-start; }
.match-action-area :deep(.package-buttons) { flex: none; }
.match-action-area :deep(.package-status) { flex: 1; min-width: 260px; max-width: none; margin: 0; padding: 8px 10px; justify-content: flex-start; background: #20251f; border: 1px solid var(--color-border); border-left: 2px solid var(--color-brand); color: var(--color-text-primary); }
.match-action-area :deep(.package-status .ef-button) { margin-left: auto; white-space: nowrap; }
.match-action-area .delete-match { margin-left: auto; }
.empty-match-import { margin: 26px 5%; }
@media (max-width: 1000px) { .match-stream-label { display: none; } }
@media (max-width: 700px) {
  .match-action-area { flex-wrap: wrap; margin: 20px 3% 0; }
  .match-action-area .package-controls { flex: 1 1 100%; order: 3; }
  .match-action-area .delete-match { order: 2; }
}
</style>
