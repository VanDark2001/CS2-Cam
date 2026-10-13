<!-- 桌面运行设置：把便携版原生菜单里的录制配置提供给网页端，并集中放置破坏性数据操作。 -->
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import EndfieldIcon from '../components/EndfieldIcon.vue'
import { API, assetUrl } from '../lib/presentation'
import projectInfo from '../../../electron/release-config.json'

const router = useRouter()
const desktop = typeof window !== 'undefined' ? window.csdemoDesktop?.settings : null
const updateApi = typeof window !== 'undefined' ? window.csdemoDesktop?.updates : null
const updateState = ref({available:false,currentVersion:'0.1.1',autoCheck:true,status:'idle',message:'',progress:0,hasUpdate:false})
const updateError=ref(''),avatarFailed=ref(false)
const updateBusy=computed(()=>['checking','downloading','preparing'].includes(updateState.value.status))
let unsubscribeUpdates=null
async function checkUpdate(){updateError.value='';try{updateState.value=await updateApi.check()}catch(exception){updateError.value=exception.message}}
async function setAutoUpdate(event){try{updateState.value=await updateApi.setAutoCheck(event.target.checked)}catch(exception){updateError.value=exception.message}}
async function installUpdate(){updateError.value='';try{await updateApi.install()}catch(exception){updateError.value=exception.message}}
function openProjectLink(event,key){if(updateApi){event.preventDefault();updateApi.openLink(key).catch(exception=>{updateError.value=exception.message})}}
const loading = ref(true)
const saving = ref('')
const error = ref('')
const notice = ref('')
const state = ref({ available: false, version: '0.1.1', recording: {}, tools: [] })
const matchCount = ref(0)
const clearing = ref(false)
const toolLabels = { CS2_EXE: 'CS2', HLAE_EXE: 'HLAE', FFMPEG_EXE: 'FFmpeg', FFPROBE_EXE: 'FFprobe' }
const recording = computed(() => ({ resolution: '1920x1080', speed: '2', bitrate: 'auto', hideHud: false, hideViewmodel: false, showXray: false, hideKillfeed: false, ...state.value.recording }))
const hlae = computed(() => state.value.tools.find(item => item.key === 'HLAE_EXE'))
const toolItems = computed(() => state.value.tools.map(item => ({ ...item, label: toolLabels[item.key] || item.key })))
const recordingReady = computed(() => toolItems.value.length > 0 && toolItems.value.every(item => item.ready))
const installing = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [settings, matches] = await Promise.all([
      desktop ? desktop.get() : Promise.resolve({ available: false, version: '0.1.1', recording: {}, tools: [] }),
      fetch(`${API}/matches`).then(response => response.ok ? response.json() : [])
    ])
    state.value = settings
    matchCount.value = matches.length
  } catch (exception) {
    error.value = `设置读取失败：${exception.message}`
  } finally { loading.value = false }
}

async function updateRecording(key, value) {
  if (!desktop || saving.value) return
  saving.value = key
  notice.value = ''
  error.value = ''
  try { state.value = await desktop.setRecording(key, value); notice.value = '设置已保存，下一次录制任务生效。' }
  catch (exception) { error.value = `设置保存失败：${exception.message}` }
  finally { saving.value = '' }
}

async function chooseHlae() {
  if (!desktop || saving.value) return
  saving.value = 'HLAE_EXE'; notice.value = ''; error.value = ''
  try { const result = await desktop.choosePath('HLAE_EXE'); state.value = result; if (result.changed) notice.value = 'HLAE 路径已更新。' }
  catch (exception) { error.value = `HLAE 路径设置失败：${exception.message}` }
  finally { saving.value = '' }
}

async function chooseTool(key) {
  if (!desktop || saving.value) return
  saving.value = key; notice.value = ''; error.value = ''
  try {
    const result = await desktop.choosePath(key)
    state.value = result
    if (result.changed) notice.value = `${toolLabels[key] || key} 路径已更新，下一次录制任务生效。`
  } catch (exception) { error.value = `${toolLabels[key] || key} 路径设置失败：${exception.message}` }
  finally { saving.value = '' }
}

async function refreshTools() {
  if (!desktop || saving.value) return
  saving.value = 'refresh'; error.value = ''; notice.value = ''
  try { state.value = await desktop.get(); notice.value = '录制环境已重新检测。' }
  catch (exception) { error.value = `环境检测失败：${exception.message}` }
  finally { saving.value = '' }
}

async function installTool(key) {
  if (!desktop || saving.value || installing.value) return
  installing.value = key; error.value = ''; notice.value = ''
  try { state.value = await desktop.installTools(key); notice.value = `${toolLabels[key]} 已下载、校验并安装。` }
  catch (exception) { error.value = `${toolLabels[key]} 在线安装失败：${exception.message}` }
  finally { installing.value = '' }
}
async function openRecordingCfg() {
  if (!desktop || saving.value) return
  saving.value = 'customCfg'; error.value = ''; notice.value = ''
  try { const result = await desktop.openRecordingCfg(); notice.value = `已打开录制 CFG：${result.path}，保存后下一次录制生效。` }
  catch (exception) { error.value = exception.message }
  finally { saving.value = '' }
}

async function clearDatabase() {
  if (clearing.value || !window.confirm(`确定清空数据库中的 ${matchCount.value} 场比赛吗？此操作会删除统计记录，且无法撤销。`)) return
  clearing.value = true; error.value = ''; notice.value = ''
  try {
    const response = await fetch(`${API}/database`, { method: 'DELETE' })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.message || `HTTP ${response.status}`)
    matchCount.value = 0
    window.dispatchEvent(new CustomEvent('cs2-database-cleared'))
    notice.value = '数据库已清空，比赛记录和统计缓存已重置。'
    await router.push({ name: 'matches' })
  } catch (exception) { error.value = `清空失败：${exception.message}` }
  finally { clearing.value = false }
}

onMounted(()=>{load();if(updateApi){unsubscribeUpdates=updateApi.subscribe(value=>{updateState.value=value});updateApi.get().then(value=>{updateState.value=value}).catch(exception=>{updateError.value=exception.message})}})
onUnmounted(()=>unsubscribeUpdates?.())
</script>

<template>
  <main class="settings-page">
    <section class="settings-hero">
      <div><div class="eyebrow">SYSTEM / CONFIGURATION</div><h1>设置</h1><p>CS2 Cam · 录制环境、版本与本地数据管理</p></div>
      <div class="settings-identity"><span class="settings-code">LOCAL CONTROL // 02</span><b>v{{ state.version }}</b></div>
    </section>
    <div v-if="loading" class="state settings-state">正在读取本地设置…</div>
    <div v-else class="settings-layout">
      <section class="settings-card">
        <header><div><small>HLAE / POV CAPTURE</small><h2>录制环境与设置</h2></div><div class="settings-header-actions"><span class="settings-status" :class="{ready:recordingReady}">{{ !state.available ? 'BROWSER MODE' : recordingReady ? 'RECORDING READY' : 'TOOLS MISSING' }}</span><button class="ef-button ef-button--quiet settings-refresh" :disabled="!state.available || !!saving" @click="refreshTools">重新检测</button></div></header>
        <div class="settings-body">
          <div v-if="state.available" class="settings-environment-note" :class="{ready:recordingReady}">{{ recordingReady ? 'HLAE、FFmpeg、FFprobe 和 CS2 路径均已找到。录制前仍需启动 Steam 并关闭普通 CS2。' : '缺少录制工具时仍可使用统计与已有 POV；选择本机文件补全后即可生成新 POV。' }}</div>
          <div v-for="item in toolItems" :key="item.key" class="settings-tool-row"><div><b>{{ item.label }} 路径</b><small>{{ item.path || '未设置' }}</small></div><button v-if="['HLAE_EXE','FFMPEG_EXE'].includes(item.key) && !item.ready" class="ef-button ef-button--accent" :disabled="!state.available || !!saving || !!installing" @click="installTool(item.key)">{{ installing===item.key ? '下载中…' : '在线安装' }}</button><button class="ef-button" :disabled="!state.available || !!saving || !!installing" @click="chooseTool(item.key)"><EndfieldIcon name="edit" :size="14" />选择文件</button><span class="tool-state" :class="{ready:item.ready}">{{ item.ready ? '已找到' : '缺少' }}</span></div>
          <div class="settings-divider"></div>
          <div class="settings-row"><span><b>自定义 CFG</b><small>打开录制配置文件，保存后下一次录制生效</small></span><button class="ef-button" :disabled="!state.available || !!saving" @click="openRecordingCfg">打开录制 CFG</button></div>
          <label class="settings-row"><span><b>录制码率</b><small>成片视频目标码率，越高文件越大；下一次录制生效</small></span><select :value="recording.bitrate" :disabled="!state.available || !!saving" @change="updateRecording('bitrate', $event.target.value)"><option value="auto">自动（默认画质）</option><option v-for="rate in ['8','12','20','30','50']" :key="rate" :value="rate">{{ rate }} Mbps</option></select></label>
          <label class="settings-row"><span><b>录制分辨率</b><small>POV 输出画面尺寸</small></span><select :value="recording.resolution" :disabled="!state.available || !!saving" @change="updateRecording('resolution', $event.target.value)"><option value="1920x1080">1920 × 1080</option><option value="1600x900">1600 × 900</option><option value="1280x720">1280 × 720</option></select></label>
          <label class="settings-row"><span><b>处理速度</b><small>回放处理倍速，成片时长会自动校正</small></span><select :value="recording.speed" :disabled="!state.available || !!saving" @change="updateRecording('speed', $event.target.value)"><option value="1">1× 正常</option><option value="2">2× 快速</option><option value="4">4× 测试</option></select></label>
          <label v-for="item in [['hideHud','隐藏 HUD'],['showXray','显示观战透视（X-Ray）']]" :key="item[0]" class="settings-row settings-toggle"><span><b>{{ item[1] }}</b><small>下一次录制任务生效</small></span><input type="checkbox" :checked="recording[item[0]]" :disabled="!state.available || !!saving" @change="updateRecording(item[0], $event.target.checked)"><i aria-hidden="true"></i></label>
        </div>
      </section>
      <section class="settings-card settings-danger-card">
        <header><div><small>DATA / MAINTENANCE</small><h2>本地数据</h2></div><EndfieldIcon name="remove" :size="18" /></header>
        <div class="settings-body"><div class="database-summary"><strong>{{ matchCount }}</strong><span>场比赛已记录</span></div><p>清空会删除比赛、回合、击杀和位置统计记录，保留应用设置与表结构。上传的 Demo 文件不会被删除。</p><button class="ef-button ef-button--danger settings-clear" :disabled="clearing" @click="clearDatabase"><EndfieldIcon name="remove" :size="14" />{{ clearing ? '清空中…' : '清空数据库' }}</button></div>
      </section>
    </div>
    <div class="settings-about-layout">
      <section class="settings-card settings-author-card">
        <header><div><small>CREATOR / CS2 CAM</small><h2>项目与作者</h2></div></header>
        <div class="settings-body">
          <div class="settings-author"><img v-if="!avatarFailed" :src="assetUrl('/author/bilibili-avatar.jpg')" :alt="`${projectInfo.authorName} 的 B 站头像`" @error="avatarFailed=true"><span v-else class="settings-author-avatar">{{projectInfo.authorName.slice(0,1)}}</span><div><b>{{projectInfo.authorName}}</b><small>CS2 Cam 作者 · VanDark2001</small></div></div>
          <p>本地 CS2 比赛分析、2D 战术回放与玩家 POV 录制。</p>
          <div class="settings-project-links"><a class="ef-button" :href="projectInfo.authorBilibili" target="_blank" rel="noopener noreferrer" @click="openProjectLink($event,'bilibili')">B 站主页</a><a class="ef-button" :href="projectInfo.authorGithub" target="_blank" rel="noopener noreferrer" @click="openProjectLink($event,'github')">GitHub 主页</a></div>
        </div>
      </section>
      <section class="settings-card settings-update-card">
        <header><div><small>GITHUB / RELEASES</small><h2>版本更新</h2></div><b class="settings-version">v{{updateState.currentVersion}}</b></header>
        <div class="settings-body">
          <label class="settings-update-preference"><input type="checkbox" :checked="updateState.autoCheck" :disabled="!updateState.available || updateBusy" @change="setAutoUpdate">启动后自动检查新版本</label>
          <p v-if="!updateState.available">请使用 Windows 便携桌面版检查并安装更新。</p>
          <p v-else role="status">{{updateState.message || '从项目的 GitHub 稳定发行版检查更新。'}}</p>
          <p v-if="updateState.latestVersion && updateState.hasUpdate">最新版本：v{{updateState.latestVersion}}</p>
          <progress v-if="['downloading','preparing'].includes(updateState.status)" class="settings-update-progress" :value="updateState.progress" max="100" :aria-label="`更新下载进度 ${updateState.progress}%`"></progress>
          <small v-if="updateState.status==='downloading'">{{updateState.progress}}%</small>
          <div class="settings-project-links"><button class="ef-button" :disabled="!updateState.available || updateBusy" @click="checkUpdate">{{updateState.status==='checking'?'检查中…':'检查更新'}}</button><button v-if="updateState.hasUpdate" class="ef-button ef-button--accent" :disabled="updateBusy" @click="installUpdate"><EndfieldIcon name="download" :size="14"/>{{updateState.status==='ready'?'安装并重启':'下载并安装'}}</button><a class="ef-button ef-button--quiet" :href="`${projectInfo.homepage}/releases`" target="_blank" rel="noopener noreferrer" @click="openProjectLink($event,'releases')">发行记录</a></div>
          <p class="settings-update-note">更新会关闭软件并重新启动，保留比赛、Demo、视频、收藏与配置。请先完成解析和录制任务。</p>
          <p v-if="updateError || updateState.status==='error'" class="settings-update-error" role="alert">{{updateError || updateState.message}}</p>
        </div>
      </section>
    </div>
    <p v-if="notice" class="settings-notice" role="status">{{ notice }}</p><p v-if="error" class="state error settings-error" role="alert">{{ error }}</p>
  </main>
</template>

<style scoped>
.settings-about-layout{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px}
.settings-author{display:flex;align-items:center;gap:16px;padding:18px 0 8px}
.settings-author>img,.settings-author-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;border:1px solid var(--color-border);flex:none}
.settings-author-avatar{display:grid;place-items:center;background:var(--color-surface);color:var(--color-brand);font-size:24px}
.settings-author>div{display:flex;flex-direction:column;gap:7px;min-width:0}.settings-author b{font-size:16px}.settings-author small,.settings-update-note{color:var(--color-text-secondary);font-size:11px}
.settings-project-links{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:14px 0 4px}.settings-project-links>a{text-decoration:none}
.settings-version{margin-left:auto;color:var(--color-brand);font-size:14px}
.settings-update-preference{display:flex;align-items:center;gap:9px;padding:16px 0 4px;font-size:12px}.settings-update-preference input{accent-color:var(--color-brand)}
.settings-update-progress{display:block;width:100%;height:8px;accent-color:var(--color-brand);margin:14px 0 7px}.settings-update-error{color:var(--color-danger)!important}
@media(max-width:800px){.settings-about-layout{grid-template-columns:1fr}}
.settings-header-actions{margin-left:auto;display:flex;align-items:center;gap:14px}.settings-refresh{padding:6px 10px}.settings-environment-note{padding:12px 0;color:var(--color-warning);font-size:12px;line-height:1.6}.settings-environment-note.ready{color:var(--color-success)}.tool-state{color:var(--color-danger);font-size:11px;flex:none}.tool-state.ready{color:var(--color-success)}.settings-page{padding:42px clamp(24px,6vw,96px) 80px;max-width:1440px;margin:0 auto}.settings-hero{display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid var(--color-border);padding-bottom:28px}.settings-hero h1{font:600 clamp(44px,5vw,70px)/.95 'Barlow Condensed';margin:10px 0 8px}.settings-hero p{margin:0;color:var(--color-text-secondary);font-size:13px}.settings-code{color:#6e7268;font-size:10px;letter-spacing:1.7px}.settings-identity{display:flex;align-items:flex-end;gap:16px;flex-direction:column}.settings-identity>b{color:var(--color-brand);font:600 18px 'Barlow Condensed';letter-spacing:1px}.settings-layout{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(300px,.8fr);gap:20px;margin-top:28px}.settings-card{background:var(--color-surface);border:1px solid var(--color-border);border-radius:2px}.settings-card>header{height:auto;display:flex;padding:20px 22px;border:0;border-bottom:1px solid var(--color-border);background:transparent}.settings-card header small{color:#a5a790;letter-spacing:1.5px}.settings-card h2{font:600 25px 'Barlow Condensed';margin:8px 0 0}.settings-status{color:#8d9188;font-size:10px;letter-spacing:1px}.settings-status.ready{color:var(--color-brand)}.settings-body{padding:8px 22px 22px}.settings-tool-row,.settings-row{display:flex;align-items:center;gap:16px;min-height:62px;border-bottom:1px solid var(--color-border-soft)}.settings-tool-row>div,.settings-row>span{display:flex;flex-direction:column;gap:5px;min-width:0;flex:1}.settings-tool-row b,.settings-row b{font-size:13px}.settings-tool-row small,.settings-row small{color:var(--color-text-secondary);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.settings-tool-row .ef-button{flex:none}.settings-divider{height:10px}.settings-row select{min-width:150px;padding:8px 10px;background:#292b25;border:1px solid var(--color-border);border-radius:2px;color:var(--color-text-primary)}.settings-row select:disabled{opacity:.55}.tool-dot{width:8px;height:8px;background:#665d50;border-radius:50%;flex:none}.tool-dot.ready{background:var(--color-brand);box-shadow:0 0 8px #c6ca4c88}.settings-toggle{cursor:pointer}.settings-toggle input{position:absolute;opacity:0}.settings-toggle i{width:34px;height:18px;border:1px solid #66695d;border-radius:10px;position:relative;flex:none;transition:.15s}.settings-toggle i:before{content:"";position:absolute;width:12px;height:12px;left:2px;top:2px;background:#888c80;border-radius:50%;transition:.15s}.settings-toggle input:checked+i{background:#c6ca4c33;border-color:var(--color-brand)}.settings-toggle input:checked+i:before{left:18px;background:var(--color-brand)}.settings-toggle input:focus-visible+i{outline:2px solid var(--color-brand);outline-offset:3px}.settings-danger-card{align-self:start}.settings-danger-card>header>.ef-icon{margin-left:auto;color:#b7675e}.database-summary{display:flex;align-items:baseline;gap:10px;padding:14px 0 10px}.database-summary strong{font:600 46px 'Barlow Condensed';color:var(--color-brand)}.database-summary span{color:var(--color-text-secondary);font-size:12px}.settings-body p{color:var(--color-text-secondary);font-size:12px;line-height:1.7}.settings-clear{margin-top:12px}.settings-notice{margin:18px 0 0;color:var(--color-brand);font-size:12px}.settings-error{margin:18px 0 0;padding:14px}.settings-state{margin:28px 0}.ef-button{flex:none}@media(max-width:800px){.settings-header-actions{margin-left:auto;display:flex;align-items:center;gap:14px}.settings-refresh{padding:6px 10px}.settings-environment-note{padding:12px 0;color:var(--color-warning);font-size:12px;line-height:1.6}.settings-environment-note.ready{color:var(--color-success)}.tool-state{color:var(--color-danger);font-size:11px;flex:none}.tool-state.ready{color:var(--color-success)}.settings-page{padding:28px 4% 60px}.settings-hero{align-items:start;gap:20px}.settings-identity{align-items:flex-end}.settings-code{display:none}.settings-layout{grid-template-columns:1fr}.settings-card>header{padding:18px}.settings-body{padding:6px 18px 18px}.settings-row select{min-width:120px}}
</style>

