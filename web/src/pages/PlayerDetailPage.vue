<!-- 玩家详情页：按 SteamID 汇总个人比赛、阵营回合、残局、地图、武器和队友。 -->
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import MapIcon from '../components/MapIcon.vue'
import PlayerAvatar from '../components/PlayerAvatar.vue'
import { useDemoData } from '../composables/useDemoData'
import { API, mapName, scoreTone, scoreValues, weaponName } from '../lib/presentation'

const route = useRoute()
const { matches, loading, error, load } = useDemoData()
const steamid = computed(() => String(route.params.steamid || ''))
const weapons = ref([])
const profileStats = ref({
  rounds: 0,
  roundWins: 0,
  roundWinRate: 0,
  sides: { ct: { rounds: 0, wins: 0, losses: 0, winRate: 0 }, t: { rounds: 0, wins: 0, losses: 0, winRate: 0 } },
  clutches: { attempts: 0, wins: 0, losses: 0, winRate: 0, breakdown: [] }
})
const profileLoading = ref(false)

const appearances = computed(() => matches.value.flatMap(match => {
  const player = (match.players || []).find(item => String(item.steamid) === steamid.value)
  return player ? [{ match, player }] : []
}))
const player = computed(() => appearances.value[0]?.player || null)

function matchOutcome(row) {
  const scores = scoreValues(row.match.score)
  if (scores.length !== 2 || scores[0] === scores[1]) return 'draw'
  const playerScore = Number(row.player.teamNumber) === 3 ? scores[0] : scores[1]
  const opponentScore = Number(row.player.teamNumber) === 3 ? scores[1] : scores[0]
  return playerScore > opponentScore ? 'win' : 'loss'
}

const favoriteTeammates = computed(() => {
  const teammates = new Map()
  for (const { match, player: current } of appearances.value) for (const candidate of match.players || []) {
    if (String(candidate.steamid) === steamid.value || candidate.teamNumber !== current.teamNumber) continue
    const item = teammates.get(candidate.steamid) || { steamid: candidate.steamid, name: candidate.name, matches: 0 }
    item.name = candidate.name
    item.matches++
    teammates.set(candidate.steamid, item)
  }
  return [...teammates.values()].sort((a, b) => b.matches - a.matches || a.name.localeCompare(b.name)).slice(0, 3)
})

const summary = computed(() => {
  const rows = appearances.value
  const total = key => rows.reduce((sum, row) => sum + Number(row.player[key] || 0), 0)
  const kills = total('kills')
  const deaths = total('deaths')
  const headshots = total('aim')
  const outcomes = rows.map(matchOutcome)
  return {
    matches: rows.length,
    wins: outcomes.filter(value => value === 'win').length,
    losses: outcomes.filter(value => value === 'loss').length,
    draws: outcomes.filter(value => value === 'draw').length,
    kills,
    deaths,
    assists: total('assists'),
    kd: deaths ? (kills / deaths).toFixed(2) : kills.toFixed(2),
    adr: rows.length ? (total('adr') / rows.length).toFixed(1) : '0.0',
    hs: kills ? (headshots * 100 / kills).toFixed(1) : '0.0',
    rating: rows.length ? (total('rating') / rows.length).toFixed(2) : '0.00'
  }
})

const mapPool = computed(() => {
  const result = new Map()
  for (const row of appearances.value) {
    const key = row.match.map || 'unknown'
    const item = result.get(key) || { map: key, matches: 0, kills: 0, deaths: 0, adr: 0, rating: 0 }
    item.matches++
    item.kills += Number(row.player.kills || 0)
    item.deaths += Number(row.player.deaths || 0)
    item.adr += Number(row.player.adr || 0)
    item.rating += Number(row.player.rating || 0)
    result.set(key, item)
  }
  return [...result.values()].map(item => ({
    ...item,
    adr: (item.adr / item.matches).toFixed(1),
    rating: (item.rating / item.matches).toFixed(2),
    kd: item.deaths ? (item.kills / item.deaths).toFixed(2) : item.kills.toFixed(2)
  })).sort((a, b) => b.matches - a.matches || b.rating - a.rating)
})

async function loadProfile() {
  const requestedSteamid = steamid.value
  profileLoading.value = true
  try {
    const [weaponsResponse, statsResponse] = await Promise.all([
      fetch(`${API}/players/${requestedSteamid}/weapons`),
      fetch(`${API}/players/${requestedSteamid}/stats`)
    ])
    if (requestedSteamid !== steamid.value) return
    weapons.value = weaponsResponse.ok ? await weaponsResponse.json() : []
    if (statsResponse.ok) profileStats.value = await statsResponse.json()
  } catch {
    if (requestedSteamid === steamid.value) weapons.value = []
  } finally {
    if (requestedSteamid === steamid.value) profileLoading.value = false
  }
}

onMounted(async () => { await load(); await loadProfile() })
watch(steamid, loadProfile)
</script>

<template>
  <main class="portal-page player-detail-page">
    <div v-if="loading" class="state">正在读取比赛数据…</div>
    <div v-else-if="error" class="state error">{{ error }}</div>
    <div v-else-if="!player" class="state error">找不到 SteamID 为 {{ steamid }} 的玩家。</div>
    <template v-else>
      <section class="player-profile">
        <RouterLink to="/players" class="back-link">← 返回玩家列表</RouterLink>
        <div class="player-identity">
          <PlayerAvatar :steamid="steamid" :name="player.name" />
          <div><div class="eyebrow">PLAYER PROFILE</div><h1>{{ player.name }}</h1><p>SteamID · {{ steamid }}</p></div>
        </div>
        <div class="profile-record">
          <small>比赛战绩</small><strong>{{ summary.wins }}<i>胜</i> {{ summary.losses }}<i>负</i></strong>
          <span v-if="summary.draws">另有 {{ summary.draws }} 场平局</span><span v-else>共 {{ summary.matches }} 场比赛</span>
        </div>
      </section>

      <section class="metric-grid player-metrics">
        <article><small>比赛</small><strong>{{ summary.matches }}</strong><span>{{ summary.wins }} 胜 · {{ summary.losses }} 负</span></article>
        <article><small>K / A / D</small><strong>{{ summary.kills }} / {{ summary.assists }} / {{ summary.deaths }}</strong><span>K/D {{ summary.kd }}</span></article>
        <article><small>平均 ADR</small><strong>{{ summary.adr }}</strong><span>正式回合有效伤害</span></article>
        <article><small>爆头率</small><strong>{{ summary.hs }}%</strong><span>{{ summary.kills }} 次有效击杀</span></article>
        <article><small>平均 Rating</small><strong>{{ summary.rating }}</strong><span>自定义近似 Rating</span></article>
        <article><small>回合胜率</small><strong>{{ profileStats.roundWinRate }}%</strong><span>{{ profileStats.roundWins }} / {{ profileStats.rounds }} 回合</span></article>
      </section>

      <section class="player-tactical-grid">
        <article class="card tactical-card side-card">
          <div class="card-head"><div><small>SIDE PERFORMANCE</small><h2>阵营表现</h2></div><span></span></div>
          <div v-if="profileLoading" class="panel-empty">正在统计正式回合…</div>
          <div v-else class="side-performance">
            <div class="round-rate" :style="{ '--rate': `${profileStats.roundWinRate * 3.6}deg` }"><div><strong>{{ profileStats.roundWinRate }}%</strong><small>总回合胜率</small></div></div>
            <div class="side-lines">
              <div class="side-line ct-side">
                <div><b>CT</b><span>防守方</span></div><strong>{{ profileStats.sides.ct.winRate }}%</strong>
                <small>{{ profileStats.sides.ct.wins }} 胜 / {{ profileStats.sides.ct.losses }} 负 · {{ profileStats.sides.ct.rounds }} 回合</small>
                <i><em :style="{ width: `${profileStats.sides.ct.winRate}%` }"></em></i>
              </div>
              <div class="side-line t-side">
                <div><b>T</b><span>进攻方</span></div><strong>{{ profileStats.sides.t.winRate }}%</strong>
                <small>{{ profileStats.sides.t.wins }} 胜 / {{ profileStats.sides.t.losses }} 负 · {{ profileStats.sides.t.rounds }} 回合</small>
                <i><em :style="{ width: `${profileStats.sides.t.winRate}%` }"></em></i>
              </div>
            </div>
          </div>
        </article>

        <article class="card tactical-card clutch-card">
          <div class="card-head"><div><small>CLUTCH PERFORMANCE</small><h2>残局表现</h2></div><span>进入 1vX 后的正式回合</span></div>
          <div v-if="profileLoading" class="panel-empty">正在回放残局数据…</div>
          <div v-else class="clutch-performance">
            <div class="clutch-rate"><span>残局胜率</span><strong>{{ profileStats.clutches.winRate }}%</strong><small>{{ profileStats.clutches.wins }} 次成功 / {{ profileStats.clutches.attempts }} 次尝试</small></div>
            <dl><div><dt>成功残局</dt><dd>{{ profileStats.clutches.wins }}</dd></div><div><dt>失败残局</dt><dd>{{ profileStats.clutches.losses }}</dd></div><div><dt>残局尝试</dt><dd>{{ profileStats.clutches.attempts }}</dd></div></dl>
            <div v-if="profileStats.clutches.breakdown?.length" class="clutch-breakdown"><span v-for="item in profileStats.clutches.breakdown" :key="item.x"><b>1v{{ item.x }}</b><strong>{{ item.winRate }}%</strong><small>{{ item.wins }}/{{ item.attempts }}</small></span></div>
            <div v-else class="clutch-empty">暂无可确认的残局尝试</div>
          </div>
        </article>
      </section>

      <section class="profile-insights">
        <article class="card profile-panel">
          <div class="card-head"><div><small>MAP POOL</small><h2>个人地图池</h2></div><span>按出场次数排列</span></div>
          <div class="personal-map-list"><div v-for="(item, index) in mapPool" :key="item.map" class="personal-map"><MapIcon :map="item.map" :label="mapName(item.map)" /><div><b>{{ mapName(item.map) }}</b><small>{{ item.matches }} 场 · K/D {{ item.kd }}</small></div><dl><div><dt>ADR</dt><dd>{{ item.adr }}</dd></div><div><dt>Rating</dt><dd>{{ item.rating }}</dd></div></dl><em v-if="index === 0">常用</em></div></div>
        </article>
        <article class="card profile-panel">
          <div class="card-head"><div><small>ARSENAL</small><h2>擅长武器</h2></div><span>正式回合有效击杀</span></div>
          <div v-if="profileLoading" class="panel-empty">正在统计武器数据…</div>
          <div v-else class="personal-weapon-list"><div v-for="(item, index) in weapons" :key="item.weapon"><strong>{{ index + 1 }}</strong><div><b>{{ weaponName(item.weapon) }}</b><span><i :style="{ width: `${item.kills / (weapons[0]?.kills || 1) * 100}%` }"></i></span></div><em>{{ item.kills }} 杀</em><small>{{ item.kills ? (item.headshots * 100 / item.kills).toFixed(0) : 0 }}% HS</small></div><div v-if="!weapons.length" class="panel-empty">暂无有效武器数据</div></div>
        </article>
      </section>

      <section class="card teammate-card">
        <div class="card-head"><h2>最常同玩的好友</h2><span>按同队共同参赛次数排序 · SteamID 匹配</span></div>
        <div v-if="favoriteTeammates.length" class="teammate-grid"><RouterLink v-for="(teammate, index) in favoriteTeammates" :key="teammate.steamid" :to="{ name: 'player-detail', params: { steamid: teammate.steamid } }"><em>{{ index + 1 }}</em><PlayerAvatar :steamid="teammate.steamid" :name="teammate.name" /><div><b>{{ teammate.name }}</b><small>共同参赛 {{ teammate.matches }} 场</small></div></RouterLink></div>
        <div v-else class="panel-empty">暂无可确认的同队记录</div>
      </section>

      <section class="card portal-card">
        <div class="card-head"><h2>比赛记录</h2><span>共 {{ summary.matches }} 场 · {{ summary.wins }} 胜 {{ summary.losses }} 负<span v-if="summary.draws"> {{ summary.draws }} 平</span></span></div>
        <div class="portal-table match-performance">
          <div class="portal-row portal-th"><span>地图</span><span>比赛 / 日期</span><span>结果</span><span>比分</span><span>K / A / D</span><span>ADR</span><span>爆头率</span><span>Rating</span></div>
          <RouterLink v-for="row in appearances" :key="row.match.id" :to="{ name: 'matches', params: { id: row.match.id } }" class="portal-row player-link"><MapIcon :map="row.match.map" :label="mapName(row.match.map)" /><span><b>{{ mapName(row.match.map) }}</b><small>{{ row.match.date }}</small></span><strong class="match-outcome" :class="matchOutcome(row)">{{ matchOutcome(row) === 'win' ? '胜' : matchOutcome(row) === 'loss' ? '负' : '平' }}</strong><span class="detail-score"><template v-if="scoreValues(row.match.score).length === 2"><b :class="scoreTone(row.match.score, 0)">{{ scoreValues(row.match.score)[0] }}</b> : <b :class="scoreTone(row.match.score, 1)">{{ scoreValues(row.match.score)[1] }}</b></template><template v-else>{{ row.match.score }}</template></span><span>{{ row.player.kills }} / {{ row.player.assists }} / {{ row.player.deaths }}</span><span>{{ row.player.adr }}</span><span>{{ row.player.hs }}%</span><span>{{ Number(row.player.rating || 0).toFixed(2) }}</span></RouterLink>
        </div>
      </section>
    </template>
  </main>
</template>
