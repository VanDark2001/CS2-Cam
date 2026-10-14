<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import EndfieldIcon from './EndfieldIcon.vue'
import { useMatchPackages } from '../composables/useMatchPackages'
const props = defineProps({ matchId: { type: [Number, String], default: null }, scope: { type: String, default: 'match' }, allowImport: { type: Boolean, default: true } })
const { state, exportMatch, importMatch, mergeFavorites } = useMatchPackages()
const showStatus = computed(() => state.operation === 'export' ? Number(state.exportMatchId) === Number(props.matchId) && state.exportScope === props.scope : props.allowImport)
const input = ref(null), router = useRouter()
function choose(event) { const file = event.target.files?.[0]; event.target.value = ''; importMatch(file) }
function retryFavorites() { try { mergeFavorites(); state.message = '收藏已合并' } catch { state.message = '收藏保存失败，请检查本地存储空间' } }
</script>
<template>
  <div class="package-controls">
    <div class="package-buttons">
      <button v-if="allowImport" class="ef-button ef-button--toolbar" :disabled="state.working" @click="input.click()"><EndfieldIcon name="upload" :size="14" />导入比赛包</button>
      <button class="ef-button ef-button--toolbar" v-if="matchId" :disabled="state.working" @click="exportMatch(matchId,scope)"><EndfieldIcon name="download" :size="14" />{{scope==='favorites' ? '导出本场收藏' : '导出整场比赛'}}</button>
      <input v-if="allowImport" ref="input" type="file" accept=".csdemo" aria-label="选择比赛包" @change="choose" hidden>
    </div>
    <div v-if="state.message && showStatus" class="package-status" :class="{error:state.status==='failed'}" role="status">
      <span>{{state.message}}</span>
      <progress v-if="state.progress!=null" max="100" :value="state.progress" aria-label="比赛包上传进度"></progress>
      <a class="ef-button ef-button--accent" v-if="state.downloadUrl" :href="state.downloadUrl" :download="state.fileName"><EndfieldIcon name="download" :size="14" />下载比赛包</a>
      <button class="ef-button" v-if="state.pendingFavorites.length" @click="retryFavorites">重新合并收藏</button>
      <button class="ef-button" v-if="state.matchId" @click="router.push({name:'matches',params:{id:state.matchId}})">查看导入比赛</button>
    </div>
  </div>
</template>
<style scoped>
.package-controls { min-width: 0; }
.package-buttons { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.package-status { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 10px; color:var(--color-text-secondary); font-size: 12px; line-height: 1.5; max-width: 620px; overflow-wrap: anywhere; }
.package-status.error { color:var(--color-danger); }
.package-status progress { width: 120px; height: 6px; accent-color:var(--color-brand); }
@media (max-width: 700px) { .package-buttons, .package-status { justify-content: flex-start; } }
</style>
