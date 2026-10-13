<!-- 玩家列表页：展示按 SteamID 跨比赛合并后的个人数据。 -->
<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import PlayerAvatar from '../components/PlayerAvatar.vue'
import { useDemoData } from '../composables/useDemoData'
const { matches, globalPlayers, loading, error, load } = useDemoData()
const page = ref(1)
const pageSize = 12
const pageCount = computed(() => Math.max(1, Math.ceil(globalPlayers.value.length / pageSize)))
const pagedPlayers = computed(() => globalPlayers.value.slice((page.value - 1) * pageSize, page.value * pageSize))
watch(pageCount, count => { page.value = Math.min(page.value, count) })
onMounted(() => load())
</script>

<template><main class="portal-page"><div v-if="loading" class="state">正在读取比赛数据…</div><div v-else-if="error" class="state error">{{ error }}</div><template v-else><section class="portal-hero"><div><div class="eyebrow">PLAYER DATABASE</div><h1>玩家</h1><p>按 SteamID 合并最近 {{ matches.length }} 场比赛的数据</p></div><strong>{{ globalPlayers.length }}</strong></section><section class="card portal-card"><Transition name="list-slide" mode="out-in"><div :key="page" class="portal-table player-summary"><div class="portal-row portal-th"><span>#</span><span>玩家</span><span>场次</span><span>K / A / D</span><span>平均 ADR</span><span>爆头率</span><span>平均 Rating</span></div><RouterLink v-for="(player,index) in pagedPlayers" :key="player.steamid" :to="{ name: 'player-detail', params: { steamid: player.steamid } }" class="portal-row player-link"><span>{{ (page-1)*pageSize+index+1 }}</span><span class="player"><PlayerAvatar :steamid="player.steamid" :name="player.name"/><b>{{ player.name }}</b></span><span>{{ player.matches }}</span><span>{{ player.kills }} / {{ player.assists }} / {{ player.deaths }}</span><span>{{ player.adr }}</span><span>{{ player.hs }}%</span><span>{{ player.rating }}</span></RouterLink></div></Transition><div class="portal-pagination" aria-label="玩家列表分页"><button :disabled="page===1" @click="page--" aria-label="上一页">‹</button><span>第 {{ page }} / {{ pageCount }} 页 · 每页 {{ pageSize }} 人</span><button :disabled="page===pageCount" @click="page++" aria-label="下一页">›</button></div></section></template></main></template>
