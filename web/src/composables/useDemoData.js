// 比赛数据中心：管理列表、当前比赛、单场分析缓存和跨比赛聚合结果。
import { computed, ref } from 'vue'
import { API } from '../lib/presentation'

// 模块级响应式状态由所有页面共享，切换路由不会重复请求比赛列表。
const matches = ref([])
const active = ref(null)
const analytics = ref({ weapons: [], rounds: [], highlights: [], clutches: [] })
const allAnalytics = ref({})
const loading = ref(false)
const analyticsLoading = ref(false)
const portalLoading = ref(false)
const error = ref('')
let loaded = false

if (typeof window !== 'undefined') window.addEventListener('cs2-database-cleared', () => {
  matches.value = []
  active.value = null
  analytics.value = { weapons: [], rounds: [], highlights: [], clutches: [] }
  allAnalytics.value = {}
  loaded = true
  error.value = '数据库已清空，请先上传 Demo。'
})

async function load(preferredId = null, force = false) {
  // 普通路由切换复用已加载列表；导入完成后通过 force 主动刷新。
  if (loaded && !force) {
    if (preferredId != null) await selectMatch(preferredId)
    return
  }
  loading.value = true
  error.value = ''
  try {
    const response = await fetch(`${API}/matches`)
    if (!response.ok) throw Error(`HTTP ${response.status}`)
    matches.value = await response.json()
    allAnalytics.value = {}
    loaded = true
    const id = preferredId == null ? null : Number(preferredId)
    active.value = matches.value.find(match => match.id === id) || matches.value[0] || null
    if (active.value) loadAnalytics(active.value.id)
    else error.value = '数据库中还没有比赛，请先上传 Demo。'
  } catch (exception) {
    error.value = `数据加载失败：${exception.message}`
  } finally {
    loading.value = false
  }
}

async function loadAnalytics(matchId) {
  // 单场分析独立加载，使比赛主体无需等待复杂统计查询。
  if (!matchId) return
  analyticsLoading.value = true
  try {
    const response = await fetch(`${API}/matches/${matchId}/analytics`)
    const data = response.ok ? await response.json() : { weapons: [], rounds: [], highlights: [], clutches: [], roundCount: 0 }
    analytics.value = data
    allAnalytics.value = { ...allAnalytics.value, [matchId]: data }
  } catch {
    analytics.value = { weapons: [], rounds: [], highlights: [], clutches: [], roundCount: 0 }
  } finally {
    analyticsLoading.value = false
  }
}

async function selectMatch(id) {
  // 优先复用已缓存的单场分析，避免侧栏来回切换产生重复请求。
  const match = matches.value.find(item => item.id === Number(id)) || matches.value[0] || null
  if (!match) return
  active.value = match
  if (allAnalytics.value[match.id]) analytics.value = allAnalytics.value[match.id]
  else await loadAnalytics(match.id)
}

async function loadAllAnalytics() {
  // 门户统计依赖所有比赛的明细；只补齐尚未进入本地缓存的比赛。
  const missing = matches.value.filter(match => !allAnalytics.value[match.id])
  if (!missing.length) return
  portalLoading.value = true
  try {
    const entries = await Promise.all(missing.map(async match => {
      const response = await fetch(`${API}/matches/${match.id}/analytics`)
      return [match.id, response.ok ? await response.json() : { weapons: [], rounds: [], highlights: [], clutches: [], roundCount: 0 }]
    }))
    allAnalytics.value = { ...allAnalytics.value, ...Object.fromEntries(entries) }
  } finally {
    portalLoading.value = false
  }
}

const globalPlayers = computed(() => {
  // SteamID 是跨比赛合并玩家的唯一身份，昵称始终采用最近遍历到的值。
  const result = new Map()
  for (const match of matches.value) for (const player of match.players || []) {
    const item = result.get(player.steamid) || { steamid: player.steamid, name: player.name, matches: 0, kills: 0, assists: 0, deaths: 0, headshots: 0, adrTotal: 0, ratingTotal: 0 }
    item.name = player.name
    item.matches++
    item.kills += Number(player.kills || 0)
    item.assists += Number(player.assists || 0)
    item.deaths += Number(player.deaths || 0)
    item.headshots += Number(player.aim || 0)
    item.adrTotal += Number(player.adr || 0)
    item.ratingTotal += Number(player.rating || 0)
    result.set(player.steamid, item)
  }
  return [...result.values()].map(item => ({ ...item, adr: (item.adrTotal / item.matches).toFixed(1), rating: (item.ratingTotal / item.matches).toFixed(2), hs: item.kills ? (item.headshots * 100 / item.kills).toFixed(1) : '0.0' })).sort((a, b) => b.kills - a.kills)
})

const globalWeapons = computed(() => {
  // 后端已完成武器归一化，前端只按规范化后的 weapon 键求和。
  const result = new Map()
  for (const data of Object.values(allAnalytics.value)) for (const weapon of data.weapons || []) {
    const item = result.get(weapon.weapon) || { weapon: weapon.weapon, kills: 0, headshots: 0 }
    item.kills += Number(weapon.kills || 0)
    item.headshots += Number(weapon.headshots || 0)
    result.set(weapon.weapon, item)
  }
  return [...result.values()].sort((a, b) => b.kills - a.kills)
})

const globalMaps = computed(() => {
  // 地图胜率按正式回合数计算，不能用比赛场数或玩家击杀数推导。
  const result = new Map()
  for (const match of matches.value) {
    const item = result.get(match.map) || { map: match.map, matches: 0, rounds: 0, kills: 0, ctWins: 0, tWins: 0, latest: match.date }
    item.matches++
    item.rounds += Number(allAnalytics.value[match.id]?.roundCount || 0)
    item.kills += (match.players || []).reduce((sum, player) => sum + Number(player.kills || 0), 0)
    item.ctWins += Number(allAnalytics.value[match.id]?.ctWins || 0)
    item.tWins += Number(allAnalytics.value[match.id]?.tWins || 0)
    if (String(match.date) > String(item.latest)) item.latest = match.date
    result.set(match.map, item)
  }
  return [...result.values()].map(item => ({ ...item, ctWinRate: item.ctWins + item.tWins ? +(item.ctWins * 100 / (item.ctWins + item.tWins)).toFixed(1) : 0, tWinRate: item.ctWins + item.tWins ? +(item.tWins * 100 / (item.ctWins + item.tWins)).toFixed(1) : 0 })).sort((a, b) => b.matches - a.matches || b.rounds - a.rounds)
})

// 汇总值只基于后端去重后的比赛列表及其分析缓存。
const globalSummary = computed(() => ({
  matches: matches.value.length,
  players: globalPlayers.value.length,
  kills: matches.value.reduce((sum, match) => sum + (match.players || []).reduce((total, player) => total + Number(player.kills || 0), 0), 0),
  rounds: Object.values(allAnalytics.value).reduce((sum, item) => sum + Number(item.roundCount || 0), 0),
  highlights: Object.values(allAnalytics.value).reduce((sum, item) => sum + Number(item.highlights?.length || 0), 0),
  clutches: Object.values(allAnalytics.value).reduce((sum, item) => sum + Number(item.clutches?.length || 0), 0)
}))

export function useDemoData() {
  return { matches, active, analytics, allAnalytics, loading, analyticsLoading, portalLoading, error, globalPlayers, globalWeapons, globalMaps, globalSummary, load, selectMatch, loadAllAnalytics }
}
