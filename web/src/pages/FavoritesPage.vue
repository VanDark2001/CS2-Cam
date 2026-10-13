<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { API, mapName } from '../lib/presentation'
import { matchTime } from '../lib/matchDisplay'
import { readPovFavorites } from '../lib/povFavorites'
import { favoritePovStatus } from '../lib/povAvailability'
import { matchTitle, readMatchTitles, writeMatchTitles } from '../lib/matchTitles'
import { useDemoData } from '../composables/useDemoData'
import MapIcon from '../components/MapIcon.vue'
import EndfieldIcon from '../components/EndfieldIcon.vue'
import MatchPackageControls from '../components/MatchPackageControls.vue'

let editorScrollY = 0
function focusTitleEditor(element) { const input = element.querySelector('input'); if (input) { input.focus({ preventScroll: true }); input.select() }; window.scrollTo({ top: editorScrollY, behavior: 'auto' }) }
const router = useRouter(), { matches, loading, error, load } = useDemoData()
const favorites = ref(readPovFavorites(localStorage.getItem('cs2-pov-favorites')))
const matchTitles = ref(readMatchTitles())
const selectedMatch = ref(null), editing = ref(null), drafts = ref({}), busy = ref(null), notice = ref('')
const povs = ref([]), povLoading = ref(false), povError = ref(''), page = ref(1), pageSize = 5, matchPage = ref(1), matchPageSize = 8
const editingMatchTitle = ref(false), matchTitleDraft = ref('')
let mounted = true
const groups = computed(() => {
  const grouped = new Map()
  for (const item of favorites.value) {
    if (!item || typeof item !== 'object') continue
    const id = String(item.matchId)
    if (!grouped.has(id)) {
      const match = matches.value.find(match => String(match.id) === id)
      grouped.set(id, { id, map: match?.map || item.map, date: match?.date || item.matchDate, dateSource: match?.dateSource || item.dateSource || (item.matchDate ? 'legacy' : null), server: match?.server || item.matchServer, score: match?.score, available: Boolean(match), items: [] })
    }
    grouped.get(id).items.push(item)
  }
  return [...grouped.values()]
})
const current = computed(() => groups.value.find(group => group.id === String(selectedMatch.value)) || groups.value[0])
const count = computed(() => groups.value.reduce((sum, group) => sum + group.items.length, 0))
const pageCount = computed(() => Math.max(1, Math.ceil((current.value?.items?.length || 0) / pageSize)))
const matchPageCount = computed(() => Math.max(1, Math.ceil(groups.value.length / matchPageSize)))
const pagedGroups = computed(() => groups.value.slice((matchPage.value - 1) * matchPageSize, matchPage.value * matchPageSize))
const pagedItems = computed(() => (current.value?.items || []).slice((page.value - 1) * pageSize, page.value * pageSize))
const playerNames = item => Array.isArray(item.players) ? item.players.map(player => player?.name || player?.steamid).filter(Boolean).join('、') : '未记录玩家'
const displayMatchTitle = group => matchTitle(group, matchTitles.value, mapName(group?.map))
function persist() { localStorage.setItem('cs2-pov-favorites', JSON.stringify(favorites.value)) }
function open(item) { router.push({ name: 'replay', params: { id: item.matchId }, query: { round: item.round } }) }
function remove(item) {
  const previous = favorites.value
  try { favorites.value = favorites.value.filter(row => row?.id !== item.id); persist() }
  catch { favorites.value = previous; notice.value = '收藏删除失败，请重试' }
}
const favoriteTitle = item => item.title || `${mapName(item.map || current.value?.map)} · 第 ${item.round} 回合`
const coverage = item => favoritePovStatus(item, povs.value)
function edit(item) { editorScrollY = window.scrollY; drafts.value[item.id] = { title: favoriteTitle(item), note: item.note || '' }; editing.value = item.id; nextTick(() => window.scrollTo({ top: editorScrollY, behavior: 'auto' })) }
function saveNote(item) {
  const previous = { title: item.title, note: item.note }
  try { item.title = drafts.value[item.id].title.trim() || favoriteTitle(item); item.note = drafts.value[item.id].note || ''; persist(); editing.value = null; notice.value = '' }
  catch { Object.assign(item, previous); notice.value = '收藏保存失败，请重试' }
}
function editMatchTitle() { editorScrollY = window.scrollY; matchTitleDraft.value = displayMatchTitle(current.value); editingMatchTitle.value = true; nextTick(() => window.scrollTo({ top: editorScrollY, behavior: 'auto' })) }
function saveMatchTitle() {
  const id = String(current.value?.id || '')
  if (!id) return
  const next = matchTitleDraft.value.trim()
  if (next) matchTitles.value = { ...matchTitles.value, [id]: next }
  else { const nextTitles = { ...matchTitles.value }; delete nextTitles[id]; matchTitles.value = nextTitles }
  writeMatchTitles(matchTitles.value)
  editingMatchTitle.value = false
}
async function loadPovs() {
  const id = current.value?.id
  if (!current.value?.available) return false
  povLoading.value = true; povError.value = ''
  try {
    const response = await fetch(`${API}/pov/exports?matchId=${id}`)
    if (!response.ok) throw new Error('POV 状态检查失败')
    const rows = await response.json()
    if (id === current.value?.id) povs.value = rows
    return true
  } catch (error) { if (id === current.value?.id) povError.value = error.message; return false }
  finally { if (id === current.value?.id) povLoading.value = false }
}
async function generate(item) {
  if (busy.value != null) return
  busy.value = item.id; notice.value = ''
  try {
    if (!await loadPovs()) throw new Error('未能确认已有 POV，请先重试检查')
    const status = coverage(item), force = status.total > 0 && !status.missing.length
    if (force && !window.confirm('这些玩家的 POV 已经生成。确定重新录制吗？已有视频会保留。')) return
    const response = await fetch(`${API}/pov/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...item, force, players: force ? item.players : status.missing }) })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message || '生成 POV 失败')
    if (data.status === 'completed') { notice.value = 'POV 已生成，无需重复录制'; return }
    notice.value = 'POV 录制中…'
    for (let i = 0; i < 720 && mounted; i++) {
      await new Promise(resolve => setTimeout(resolve, 2500))
      if (!mounted) break
      const result = await fetch(`${API}/pov/export/${data.jobId}`)
      if (!result.ok) throw new Error('录制状态检查失败，请稍后刷新')
      const job = await result.json()
      if (job.status === 'failed') throw new Error(job.message || 'POV 录制失败')
      if (job.status === 'completed') { await loadPovs(); notice.value = 'POV 已生成'; return }
    }
    if (mounted) notice.value = '录制仍在后台进行，请稍后刷新状态'
  } catch (exception) { notice.value = exception.message }
  finally { busy.value = null }
}
function refreshFavorites() { favorites.value = readPovFavorites(localStorage.getItem('cs2-pov-favorites')); page.value = 1; matchPage.value = Math.min(matchPage.value, matchPageCount.value) }
function changePage(next) { page.value = Math.max(1, Math.min(pageCount.value, next)) }
function changeMatchPage(next) { matchPage.value = Math.max(1, Math.min(matchPageCount.value, next)) }
function chooseMatch(id) { selectedMatch.value = id; const index = groups.value.findIndex(group => group.id === id); if (index >= 0) matchPage.value = Math.floor(index / matchPageSize) + 1 }
function closeEditors(event) { if (event?.target?.closest?.('.match-title-editor,.favorite-note')) return; if (editingMatchTitle.value) saveMatchTitle(); editing.value = null }
async function imported(event) { selectedMatch.value = String(event.detail); refreshFavorites(); await load(event.detail, true) }
function refreshMatchTitles() { matchTitles.value = readMatchTitles() }
onMounted(() => { load(); document.addEventListener('pointerdown', closeEditors); window.addEventListener('cs2-favorites-changed', refreshFavorites); window.addEventListener('cs2-match-imported', imported); window.addEventListener('cs2-match-titles-changed', refreshMatchTitles) })
watch(() => [current.value?.id, current.value?.available], () => { editingMatchTitle.value = false; editing.value = null; povs.value = []; page.value = 1; loadPovs() }, { immediate: true })
watch(pageCount, count => { page.value = Math.min(page.value, count) })
watch(matchPageCount, count => { matchPage.value = Math.min(matchPage.value, count) })
onUnmounted(() => { mounted = false; document.removeEventListener('pointerdown', closeEditors); window.removeEventListener('cs2-favorites-changed', refreshFavorites); window.removeEventListener('cs2-match-imported', imported); window.removeEventListener('cs2-match-titles-changed', refreshMatchTitles) })
</script>

<template>
  <main class="favorites-page">
    <header class="favorites-title" data-motion="reveal"><div class="favorites-heading"><h1>POV 录制</h1><span>{{groups.length}} 场比赛 · {{count}} 条收藏</span></div><MatchPackageControls scope="favorites" :match-id="current?.available ? current.id : null" /></header>
    <div v-if="notice" class="favorites-notice" role="status">{{notice}}</div>
    <div v-if="error" class="favorites-notice error" role="alert">{{error}} <button class="ef-button" @click="load(null,true)">重试</button></div>
    <div v-if="groups.length" class="favorites-shell" data-motion="reveal">
      <aside class="favorites-sidebar" aria-label="收藏比赛列表"><h2>比赛记录</h2><Transition name="sidebar-slide" mode="out-in"><div :key="matchPage" class="favorites-sidebar-matches"><button v-for="group in pagedGroups" :key="group.id" :class="{active:group.id===current?.id}" :aria-pressed="group.id===current?.id" @click="chooseMatch(group.id)"><MapIcon :map="group.map" :label="mapName(group.map)" /><span class="favorite-match-copy"><strong>{{displayMatchTitle(group)}}</strong><time>{{matchTime(group.date,group.dateSource)}}</time><small>{{group.items.length}} 条收藏 · 比赛 #{{group.id}}</small></span></button></div></Transition><div v-if="matchPageCount > 1" class="favorites-sidebar-pagination" aria-label="收藏比赛分页"><button class="ef-button ef-button--quiet" :disabled="matchPage===1" aria-label="上一页比赛" @click="changeMatchPage(matchPage-1)">‹</button><span>第 {{matchPage}} / {{matchPageCount}} 页</span><button class="ef-button ef-button--quiet" :disabled="matchPage===matchPageCount" aria-label="下一页比赛" @click="changeMatchPage(matchPage+1)">›</button></div><small v-if="groups.length" class="favorites-sidebar-count">每页 {{matchPageSize}} 场 · 共 {{groups.length}} 场</small></aside>
      <section class="favorites-content">
        <div class="favorite-match-heading"><MapIcon :map="current.map" :label="mapName(current.map)" /><div><div class="favorite-title-slot"><Transition name="title-editor" mode="out-in" @after-enter="focusTitleEditor"><div v-if="editingMatchTitle" key="editor" class="match-title-editor"><input v-model="matchTitleDraft" maxlength="120" aria-label="比赛记录标题" @keyup.enter="saveMatchTitle" @keyup.esc="editingMatchTitle=false" /></div><h2 v-else key="title" class="editable-match-title" title="点击修改比赛标题" @click="editMatchTitle">{{displayMatchTitle(current)}} <span v-if="current.score">{{current.score}}</span></h2></Transition></div><p>{{matchTime(current.date,current.dateSource)}} <span>· 比赛 #{{current.id}}</span></p></div><button class="ef-button" :disabled="!current.available" @click="router.push({name:'matches',params:{id:current.id}})"><EndfieldIcon name="matches" :size="14" />比赛详情</button></div>
        <div v-if="loading" class="favorites-notice">正在加载比赛信息…</div><div v-else-if="!current.available" class="favorites-notice">本机比赛记录不可用，已保留收藏与备注。</div>
        <div v-if="povError" class="favorites-notice error" role="alert">{{povError}} <button class="ef-button" @click="loadPovs">重试检查</button></div>
        <Transition name="favorites-list" mode="out-in"><div :key="`${current.id}-${page}`" class="favorites-list"><article v-for="item in pagedItems" :key="item.id" class="favorite-card" role="link" tabindex="0" @click="open(item)" @keydown.enter="open(item)">
          <div class="favorite-round-main"><h3>{{favoriteTitle(item)}}</h3><p class="favorite-players">{{playerNames(item)}}</p><small>{{mapName(current.map)}} · 第 {{item.round}} 回合<template v-if="current.server"> · {{current.server}}</template></small><p class="pov-readiness" :class="{complete:coverage(item).completed===coverage(item).total && coverage(item).total>0}">{{busy===item.id ? '录制中…' : povLoading ? '检查 POV…' : povError ? 'POV 状态未知' : coverage(item).completed===coverage(item).total && coverage(item).total>0 ? `POV 已生成 · ${coverage(item).total} 个视角` : coverage(item).completed ? `已生成 ${coverage(item).completed}/${coverage(item).total} 个视角` : 'POV 尚未生成'}}</p></div>
          <div class="favorite-note" @click.stop><div class="favorite-note-view"><Transition name="favorite-editor" mode="out-in" @after-enter="focusTitleEditor"><div v-if="editing===item.id" key="editor"><label :for="`title-${item.id}`">收藏名称</label><input :id="`title-${item.id}`" v-model="drafts[item.id].title" maxlength="200" aria-label="收藏名称"><label :for="`note-${item.id}`">备注</label><textarea :id="`note-${item.id}`" v-model="drafts[item.id].note" maxlength="20000" aria-label="收藏备注"></textarea><div class="favorite-note-actions"><button class="ef-button ef-button--accent" @click="saveNote(item)">保存收藏</button><button class="ef-button ef-button--quiet" @click="editing=null">取消</button></div></div><div v-else key="summary"><label>备注</label><p>{{item.note || '暂无备注'}}</p><button class="ef-button ef-button--quiet edit-note" @click="edit(item)"><EndfieldIcon name="edit" :size="13" />编辑收藏</button></div></Transition></div></div>
          <div class="favorite-card-actions" @click.stop><button class="ef-button ef-button--accent" :disabled="!current.available" @click="open(item)"><EndfieldIcon name="replay" :size="14" />打开回合</button><button class="ef-button" :disabled="busy!=null || !current.available || povLoading || !!povError" @click="generate(item)"><EndfieldIcon name="video" :size="14" />{{busy===item.id ? '生成中…' : coverage(item).total>0 && !coverage(item).missing.length ? '重新生成 POV' : coverage(item).completed ? '生成剩余 POV' : '生成 POV'}}</button><button class="ef-button ef-button--danger" aria-label="删除本条收藏" @click="remove(item)"><EndfieldIcon name="remove" :size="14" />删除收藏</button></div>
        </article></div></Transition><nav v-if="pageCount > 1" class="favorites-pagination" aria-label="收藏分页"><button class="ef-button ef-button--quiet" :disabled="page<=1" @click="changePage(page-1)">上一页</button><span>第 {{page}} / {{pageCount}} 页</span><button class="ef-button ef-button--quiet" :disabled="page>=pageCount" @click="changePage(page+1)">下一页</button></nav>
      </section>
    </div>
    <section v-else class="favorites-empty"><EndfieldIcon name="archive" :size="30" /><h2>还没有收藏</h2><button class="ef-button ef-button--accent" @click="router.push({name:'replay'})"><EndfieldIcon name="replay" :size="14" />打开 2D 回放</button></section>
  </main>
</template>

<style scoped>
.favorite-round-main h3{overflow-wrap:anywhere}.pov-readiness{font-size:11px;color:var(--color-text-secondary);line-height:1.5;margin:10px 0 0}.pov-readiness.complete{color:var(--color-brand)}.favorite-note input{width:100%;box-sizing:border-box;min-height:34px;margin-bottom:12px;background:var(--color-page-bg);border:1px solid var(--color-border);color:var(--color-text-primary);padding:7px 9px;border-radius:2px;font:inherit;font-size:12px}.favorite-note input:focus{outline:1px solid var(--color-brand)}
.favorites-page{max-width:1500px;margin:0 auto;padding:28px 32px 70px;color:var(--color-text-primary)}.favorites-title{height:auto;min-height:66px;display:flex;justify-content:space-between;align-items:center;gap:24px;padding:0 0 22px;background:transparent;backdrop-filter:none;border-bottom:1px solid var(--color-border)}.favorites-heading{flex:none}.favorites-heading h1{margin:0 0 8px;font-size:26px;line-height:1.2;letter-spacing:0}.favorites-heading>span{color:var(--color-text-secondary);font-size:12px}.favorites-shell{display:grid;grid-template-columns:270px minmax(0,1fr);gap:28px;margin-top:24px}.favorites-sidebar{min-width:0;border-right:1px solid var(--color-border);padding-right:18px;height:max-content}.favorites-sidebar h2{margin:0 0 12px;font-size:12px;color:var(--color-text-secondary)}.favorites-sidebar button{display:flex;align-items:center;gap:12px;width:100%;text-align:left;background:transparent;border:1px solid transparent;border-left:2px solid transparent;color:var(--color-text-primary);padding:12px 10px;cursor:pointer;border-radius:2px;margin-bottom:4px}.favorites-sidebar button.active{background:#2b2d25;border-color:#555843;border-left-color:var(--color-brand)}.favorites-sidebar button:hover{background:var(--color-surface-raised)}.favorite-match-copy{min-width:0;display:flex;flex-direction:column;gap:6px}.favorite-match-copy strong{font-size:14px}.favorite-match-copy time{font-size:11px;color:#c4cbc3;line-height:1.5;overflow-wrap:anywhere}.favorite-match-copy small{color:var(--color-text-secondary);font-size:10px}.favorite-match-heading{display:flex;align-items:center;gap:12px;padding-bottom:18px;border-bottom:1px solid var(--color-border);margin-bottom:18px}.favorite-match-heading>div{min-width:0;flex:1}.favorite-match-heading h2{margin:0;font-size:22px;line-height:1.25;letter-spacing:0;min-height:28px}.favorite-match-heading h2 span{margin-left:12px;font-size:16px;color:#c8d7e5;font-variant-numeric:tabular-nums;white-space:nowrap}.favorite-match-heading p{margin:7px 0 0;font-size:12px;color:var(--color-text-secondary);line-height:1.5}.favorites-list{display:grid;gap:12px}.favorite-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:2px;padding:18px;display:grid;grid-template-columns:minmax(160px,.95fr) minmax(180px,1.1fr) auto;gap:24px;align-items:start}.favorite-round-main h3{font-size:15px;line-height:1.5;margin:0;letter-spacing:0}.favorite-round-main h3 span{font-weight:500;color:#bcc7d0;white-space:nowrap}.favorite-players{font-size:13px;line-height:1.7;margin:10px 0 6px;overflow-wrap:anywhere}.favorite-round-main small{font-size:10px;color:var(--color-text-secondary);overflow-wrap:anywhere}.favorite-note{min-width:0}.favorite-note label{font-size:10px;color:var(--color-text-secondary)}.favorite-note p{font-size:13px;line-height:1.6;margin:8px 0 10px;white-space:pre-wrap;overflow-wrap:anywhere}.favorite-note textarea{display:block;width:100%;min-height:80px;margin:8px 0;background:var(--color-page-bg);border:1px solid var(--color-border);border-radius:2px;color:var(--color-text-primary);padding:8px;font:13px/1.6 Inter,sans-serif;resize:vertical}.favorite-note-actions{display:flex;gap:8px}.favorite-card-actions{display:flex;flex-direction:column;gap:8px}.favorites-empty{padding:80px 0;text-align:center;color:var(--color-text-secondary)}.favorites-empty h2{font-size:18px;color:var(--color-text-primary);margin:16px 0 22px}.favorites-notice{padding:12px 0;color:var(--color-text-secondary);font-size:12px;line-height:1.6}.favorites-notice.error{color:var(--color-danger)}button:focus-visible,textarea:focus-visible{outline:2px solid var(--color-brand);outline-offset:2px}@media(max-width:1100px){.favorites-shell{grid-template-columns:230px minmax(0,1fr);gap:20px}.favorite-card{grid-template-columns:minmax(0,1fr) auto;gap:16px}.favorite-note{grid-row:2;grid-column:1/-1}.favorite-card-actions{grid-column:2;grid-row:1}}@media(max-width:700px){.favorites-page{padding:24px 16px 50px}.favorites-title{align-items:flex-start;flex-direction:column;gap:18px}.favorites-shell{grid-template-columns:1fr}.favorites-sidebar{border-right:0;border-bottom:1px solid var(--color-border);padding:0 0 16px}.favorite-match-heading{flex-wrap:wrap}.favorite-match-heading h2{font-size:20px}.favorite-card{padding:14px;grid-template-columns:minmax(0,1fr)}.favorite-card-actions{grid-column:1;grid-row:3;flex-direction:row;flex-wrap:wrap}.favorite-card-actions button{flex:1}.favorite-note{grid-row:2}.favorite-round-main h3 span{white-space:normal}}
.favorites-content{min-height:640px;display:flex;flex-direction:column}.favorites-pagination{display:flex;justify-content:center;align-items:center;gap:14px;margin-top:auto;padding-top:18px;color:var(--color-text-secondary);font-size:12px}.favorites-pagination .ef-button{min-width:72px}
.favorites-shell{align-items:start}
.favorites-content{min-width:0;align-self:start}
.favorites-list{align-content:start}
.favorites-sidebar-pagination{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--color-border);font-size:11px;color:var(--color-text-secondary)}
.favorites-sidebar-pagination .ef-button{min-width:30px;padding:5px 8px;font-size:16px;line-height:1}
.favorites-sidebar-count{display:block;position:absolute;left:0;right:18px;bottom:10px;text-align:center;color:var(--color-text-secondary);font-size:10px}
.favorites-sidebar{height:900px;min-height:900px;display:flex;flex-direction:column;overflow:hidden;position:relative}
.favorites-sidebar-matches{min-height:0;flex:none;overflow:hidden}
.favorite-match-heading>div{position:relative}
.editable-match-title{cursor:text}.editable-match-title:hover{color:var(--color-brand)}
.match-title-editor{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:28px;box-sizing:border-box}
.match-title-editor input{min-width:0;flex:1 1 auto;width:100%;background:var(--color-page-bg);border:1px solid var(--color-border);color:var(--color-text-primary);padding:0 4px;border-radius:2px;font:inherit;font-size:22px;line-height:1.25;font-weight:700}
.favorite-editor-enter-active,.favorite-editor-leave-active{transition:opacity 160ms ease,transform 160ms var(--motion-ease-standard)}
.favorite-editor-enter-from{opacity:0;transform:translateY(6px)}.favorite-editor-leave-to{opacity:0;transform:translateY(-4px)}
.favorite-title-slot{position:relative;height:28px}
.favorite-title-slot input{height:100%;box-sizing:border-box}
.favorite-title-slot .match-title-editor{position:absolute;inset:0;height:100%;min-height:0;flex-wrap:nowrap}
.favorite-title-slot .editable-match-title{height:100%;min-height:0}
@media(max-width:700px){.favorites-sidebar{height:auto;min-height:0;overflow:visible;position:static}.favorites-sidebar-matches{overflow:visible}}
.favorite-card{cursor:pointer;transition:transform 180ms cubic-bezier(.22,.61,.36,1),border-color 180ms ease,background 180ms ease}.favorite-card:hover{transform:translateY(-2px);border-color:#697052;background:#252922}.favorite-card:focus-visible{outline:2px solid var(--color-brand);outline-offset:3px}.favorites-list-enter-active,.favorites-list-leave-active{transition:opacity var(--motion-duration-slow) var(--motion-ease-standard),transform var(--motion-duration-slow) var(--motion-ease-emphasis)}.favorites-list-enter-from{opacity:0;transform:translateY(var(--motion-distance-md))}.favorites-list-leave-to{opacity:0;transform:translateY(calc(var(--motion-distance-sm) * -0.5))}
</style>

<style>/* stable favorite editor and horizontal pagination */
.favorite-note-view{min-height:150px}
.favorite-note-view>div{width:100%}.favorite-editor-enter-active,.favorite-editor-leave-active{transition:opacity 180ms ease,transform 180ms cubic-bezier(.22,.61,.36,1)}.favorite-editor-enter-from{opacity:0;transform:translateY(8px)}.favorite-editor-leave-to{opacity:0;transform:translateY(-6px)}.favorites-pagination{flex-wrap:nowrap;white-space:nowrap}.match-title-editor{min-height:28px;flex-wrap:nowrap}.match-title-editor input{min-width:0}
.favorites-sidebar-pagination{white-space:nowrap;justify-content:center;position:absolute;left:0;right:18px;bottom:34px;margin:0;padding-top:12px;background:var(--color-page-bg)}
.favorites-sidebar-pagination span{flex:1;text-align:center}
@media(max-width:700px){.favorites-sidebar{height:auto;min-height:0;overflow:visible;position:static}.favorites-sidebar-matches{overflow:visible}.favorites-sidebar-pagination{position:static;justify-content:space-between;margin-top:12px;padding-top:12px;background:transparent}.favorites-sidebar-count{position:static;margin-top:8px}}
@media(min-width:701px){.favorites-sidebar{position:sticky;top:76px;height:calc(100vh - 100px);min-height:0}.favorites-sidebar-matches{flex:1;overflow-y:auto;overflow-x:hidden}}
</style>







