<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { API, assetUrl, weaponAsset, weaponName } from '../lib/presentation'
import ReplayPlayerCard from '../components/ReplayPlayerCard.vue'
import EndfieldIcon from '../components/EndfieldIcon.vue'
import { radarPoint, radarNumbers, drawRadarMap, drawPlayerMarker, drawPlayerTooltip } from '../lib/replayRadar'
import { radarMetadata, radarCrops, isRadarImage } from '../lib/radarAssets'
import { replayCountdown } from '../lib/replayClock'
import { prepareReplayEffects, grenadeKind, activeEffectZone, effectRemainingSeconds, drawEffectAreas, drawEffectIcons, drawTrajectories, drawGunfire } from '../lib/replayEffects'
import { loadGameIcons } from '../lib/gameIcons'
import { povPlaybackSeconds as playbackSeconds, povPlaybackTick, isPovAutomaticPause } from '../lib/povPlayback'
import { createPovMediaCache } from '../lib/povMediaCache'
import { eventPreviewTick, playerTimelineMarkers } from '../lib/replayTimeline'
import { readPovFavorites, samePovFavorite, addPovFavorite } from '../lib/povFavorites'
import { createHudAnimationController, HUD_ANIMATION_MODES } from '../lib/endfieldHudAnimation'
import '../replay.css'
const weaponIcon=w=>weaponAsset(w)
const playerWeaponIcon=p=>{
  const raw=String(p?.weapon||'').toLowerCase()
  const inventory=String(p?.inventory||'').toLowerCase()
  // Older parsed rows collapsed all knife variants to `knife`; recover the
  // concrete icon from the inventory so existing demos still show the right
  // model without requiring a re-parse.
  if ((raw==='knife'||raw==='bayonet'||raw.startsWith('knife_')) && inventory.includes('skeleton knife')) return weaponAsset('knife_skeleton')
  return weaponIcon(p?.weapon)
}
const formatClock=seconds=>{const total=Math.max(0,Math.ceil(seconds));return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`}
const roundSeconds=computed(()=>{
  const now=Number(replay.value.globalTick)
  const tickRate=Number(replay.value.tickRate)>0?Number(replay.value.tickRate):64
  const bombDefused = replay.value.events.some(event => event.type === 'bomb_defused' && Number(event.tick) <= now)
  return replayCountdown(replay.value,{bomb:Boolean(activeBombZone.value),bombRemaining:activeBombRemaining.value,bombDefused,finalRound:round.value===rounds.value.length,loading:loadingReplay.value&&!roundSwitching.value&&(!toPlayers.length||Number(replay.value.roundNumber)!==Number(round.value))})
})
const roundStatus=computed(()=>{
  const text=String(roundSeconds.value.text||'')
  if(text==='加载中')return 'loading'
  if(roundSeconds.value.defused||text==='炸弹已拆除')return 'defused'
  if(roundSeconds.value.bomb||text==='炸弹已安放')return 'bomb'
  if(text.startsWith('购买'))return 'buy'
  if(text==='回合进行中'||/^回合\s+\d/.test(text))return 'round'
  return 'end'
})
const hudPhaseLabel=computed(()=>`第 ${round.value} 回合`)
const playerTeam=steamid=>{const p=replay.value.players.find(x=>String(x.steamid||'')===String(steamid||''));return Number(p?.teamNumber)||0};const sideColor=team=>{const isT=team===2?replay.value.team2Side===2:replay.value.team2Side===3;return isT?'#f3bf4c':team===2||team===3?'#4aa3ff':'#e5efec'};const killInfo=k=>{let d={};try{d=typeof k.data==='string'?JSON.parse(k.data):(k.data||{})}catch{};const attacker=d.attacker_name||d.attacker||k.attacker||'未知';const assister=d.assister_name||d.assister||d.assist_name||'';const victim=d.user_name||d.victim_name||d.user||k.player||'未知';const attackerSid=d.attacker_steamid||d.attacker_steamid64||d.attacker_xuid||k.attacker_steamid;const victimSid=d.user_steamid||d.victim_steamid||d.user_steamid64||d.victim_steamid64||k.victim_steamid;const weapon=d.weapon||k.weapon||'';const headshot=Boolean(d.headshot||d.head_shot||d.headshot_bool);const throughSmoke=Boolean(d.thru_smoke||d.through_smoke||d.throughSmoke);return {attacker,assister,victim,weapon,weaponLabel:weaponName(weapon),headshot,throughSmoke,attackerColor:sideColor(playerTeam(attackerSid)),victimColor:sideColor(playerTeam(victimSid)),icon:weaponIcon(weapon)}}
const killfeed=computed(()=>replay.value.events.filter(e=>e.type==='player_death'&&Number(e.tick)<=Number(replay.value.globalTick)).slice(-3).reverse())
const inventoryText=inventory=>{if(!inventory)return "";let raw=inventory;try{raw=typeof inventory==="string"?JSON.parse(inventory):inventory}catch{return String(inventory)};if(!Array.isArray(raw))return String(raw);return raw.map(v=>typeof v==="string"?v:(v?.name||v?.item||v?.classname||"" )).filter(Boolean).join("、")};const inventoryIcons=inventory=>{if(!inventory)return[];let raw=inventory;try{raw=typeof inventory==='string'?JSON.parse(inventory):inventory}catch{return[]};const text=JSON.stringify(raw).toLowerCase();const compact=text.replace(/[\\s_-]/g,'');const out=[];const add=name=>{if(name&&!out.includes(name))out.push(name)};if(text.includes('hegrenade')||text.includes('high explosive'))add('hegrenade');if(text.includes('flash'))add('flashbang');if(text.includes('smoke'))add('smokegrenade');if(text.includes('molotov')||text.includes('incgrenade'))add('incgrenade');if(text.includes('defus')||text.includes('kit'))add('defuser');if(text.includes('c4')||text.includes('bomb'))add('c4');if(compact.includes('glock18'))add('glock');if(compact.includes('usp'))add('usp_silencer');if(compact.includes('knifet')||compact.includes('knife'))add('knife');if(compact.includes('flipknife'))add('knife_flip');if(compact.includes('defuser')||compact.includes('defusekit'))add('defuser');if(compact.includes('knifect'))add('knife');const weapons=['ak47','m4a1','m4a1_silencer','awp','deagle','glock','usp_silencer','p250','mp9','mp7','mp5sd','mac10','famas','galilar','aug','sg556','ssg08','scar20','g3sg1','negev','m249','xm1014','nova','mag7','sawedoff','p90','bizon','ump45','tec9','fiveseven','cz75a','revolver'];for(const w of weapons)if(text.includes(w))add(w);return out}
const router=useRouter()
const route=useRoute(),matches=ref([]),matchId=ref(Number(route.params.id)||0),round=ref(1),playing=ref(false),canvas=ref(null),lowerCanvas=ref(null),currentMap=computed(()=>String(matches.value.find(m=>Number(m.id)===Number(matchId.value))?.map||'').toLowerCase()),radar=ref(null),lowerRadar=ref(null),loadingReplay=ref(false)
const replay=ref({startTick:0,endTick:0,globalTick:0,players:[],events:[],roundCount:24})
const replayEffects=computed(()=>prepareReplayEffects(replay.value.events,Number(replay.value.tickRate)||64))
const activeBombZone=computed(()=>activeEffectZone(replayEffects.value,Number(replay.value.globalTick),'bomb'))
const activeBombRemaining=computed(()=>effectRemainingSeconds(activeBombZone.value,Number(replay.value.globalTick),Number(replay.value.tickRate)||64))
const effectsMissing=computed(()=>{
  // `replay.value.events` is already limited to the selected round. Keep the
  // notice round-local as well: one round without projectile samples must not
  // make every other round look unavailable.
  const trajectoryMessage=replayEffects.value.paths.length>0 ? null : '本回合未记录投掷轨迹'
  return [trajectoryMessage,!replayEffects.value.hasShots?'本回合未记录开枪事件':null].filter(Boolean).join('、')
})
const throwTeam=steamid=>{
  const team=playerTeam(steamid)
  if (team!==2&&team!==3) return 'unknown'
  return (team===2 ? replay.value.team2Side===2 : replay.value.team2Side===3) ? 't' : 'ct'
}
const grenadeLabel=kind=>({smoke:'烟雾',flash:'闪光',fire:'燃烧',he:'手雷',decoy:'诱饵',bomb:'炸弹'}[kind]||'投掷物')
const grenadeIcon=kind=>assetUrl(`/weapons-flat/${({smoke:'smokegrenade',flash:'flashbang',fire:'incgrenade',he:'hegrenade',decoy:'decoy',bomb:'c4'}[kind]||'hegrenade')}.svg`)
const markerTeamLabel=team=>({ct:'CT',t:'T',c4:'C4',unknown:'未知'}[team]||'未知')
const throwerLabel=steamid=>{
  const sid=String(steamid||'').trim()
  const player=replay.value.players.find(item=>String(item.steamid||'')===sid)
  return player?.name?.trim() || '未知玩家'
}
const grenadeMarkers=computed(()=>{
  const start=Number(replay.value.startTick),end=Number(replay.value.endTick)
  if (!(end>start)) return []
  const seen=new Set()
  const markers=[]
  const addMarker=(tick,steamid,kind,index,playerName='',teamOverride='',labelOverride='',iconOverride='')=>{
    const key=`${tick}|${steamid||''}|${kind||''}`
    if (!Number.isFinite(tick)||seen.has(key)) return null
    seen.add(key)
    const team=teamOverride||throwTeam(steamid)
    markers.push({key:`${key}|${index}`,tick,steamid:String(steamid||''),kind,team,lane:kind==='bomb'?'middle':(['flash','he'].includes(kind)?'below':'above'),icon:iconOverride||grenadeIcon(kind),thrower:String(playerName||throwerLabel(steamid)).trim()||'未知玩家',percent:Math.max(0,Math.min(100,(tick-start)/(end-start)*100)),label:labelOverride||grenadeLabel(kind)})
  }
  replayEffects.value.paths.forEach((path,index)=>addMarker(Number(path.start),path.steamid,path.kind,index))
  replay.value.events.filter(event=>event.type==='grenade_thrown').forEach((event,index)=>{
    let data={};try{data=typeof event.data==='string'?JSON.parse(event.data):(event.data||{})}catch{}
    addMarker(Number(event.tick),event.steamid||data.user_steamid||data.steamid,grenadeKind(data.weapon||data.grenade_type||data.item||''),`event-${index}`,event.player||data.user_name||data.player_name)
  })
  replay.value.events.filter(event=>event.type==='bomb_planted').forEach((event,index)=>{
    let data={};try{data=typeof event.data==='string'?JSON.parse(event.data):(event.data||{})}catch{}
    addMarker(Number(event.tick),event.steamid||data.user_steamid||data.steamid,'bomb',`c4-${index}`,event.player||data.user_name||data.player_name,'c4','C4 安装',assetUrl('/weapons-flat/c4.svg'))
  })
  replay.value.events.filter(event=>event.type==='bomb_defused').forEach((event,index)=>{
    let data={};try{data=typeof event.data==='string'?JSON.parse(event.data):(event.data||{})}catch{}
    addMarker(Number(event.tick),event.steamid||data.user_steamid||data.steamid,'bomb',`defuse-${index}`,event.player||data.user_name||data.player_name,'ct','拆弹成功',assetUrl('/weapons-flat/defuser.svg'))
  })
  return markers.sort((a,b)=>a.tick-b.tick)
})
const playerNumbers=computed(()=>radarNumbers(replay.value.players))
const playerNumber=player=>playerNumbers.value.get(String(player.steamid))||''
let radarPointer=null, lowerRadarPointer=null, miniRadarPointer=null, drawnRadarPlayers=[], drawnLowerRadarPlayers=[], drawnMiniRadarPlayers=[]
const miniRadar=ref(null),povOverlay=ref(null),overlayFullscreen=ref(false)
const hudRoot=ref(null)
let hudAnimation=null
let lastHudStatus=null
const nukeDual=computed(()=>currentMap.value==='de_nuke')
function onRadarPointer(event,mini=false,floor='upper'){const c=mini?miniRadar.value:floor==='lower'?lowerCanvas.value:canvas.value,bounds=c?.getBoundingClientRect();if(!bounds)return;const pointer={x:(event.clientX-bounds.left)/bounds.width*c.clientWidth,y:(event.clientY-bounds.top)/bounds.height*c.clientHeight};if(mini)miniRadarPointer=pointer;else if(floor==='lower')lowerRadarPointer=pointer;else radarPointer=pointer;draw()}
function onRadarClick(event,mini=false,floor='upper'){
  const c=mini?miniRadar.value:floor==='lower'?lowerCanvas.value:canvas.value,bounds=c?.getBoundingClientRect()
  if(!c||!bounds)return
  const x=(event.clientX-bounds.left)/bounds.width*c.clientWidth,y=(event.clientY-bounds.top)/bounds.height*c.clientHeight
  const radius=mini?7:Math.max(8,Math.min(10,c.clientWidth*.013))
  const hit=(mini?drawnMiniRadarPlayers:floor==='lower'?drawnLowerRadarPlayers:drawnRadarPlayers).map(marker=>({...marker,distance:Math.hypot(marker.x-x,marker.y-y)}))
    .filter(marker=>marker.distance<=radius+8).sort((a,b)=>a.distance-b.distance)[0]
  if(!hit){timelinePlayer.value='';if(overlayVideoUrl.value)closeOverlayVideo();return}
  const file=currentPovFiles.value.find(item=>item.steamid&&String(item.steamid)===String(hit.player.steamid))
  if(!mini)timelinePlayer.value=String(hit.player.steamid)
  if(file?.url)showOverlayVideo(file.url)
}
function onReplayBlankClick(event){
  if(event.target.closest('button,a,input,select,textarea,video,canvas,[role="button"],[contenteditable="true"]'))return
  timelinePlayer.value=''
  if(overlayVideoUrl.value)closeOverlayVideo()
}
function onPovVideoClick(event,url){
  // Thumbnails have no native controls: clicking any part of one opens the
  // focused POV without letting Chromium toggle its paused state first.
  event.preventDefault()
  showOverlayVideo(url)
}
function clearRadarPointer(mini=false,floor='upper'){if(mini)miniRadarPointer=null;else if(floor==='lower')lowerRadarPointer=null;else radarPointer=null;draw()}
const radarError=ref('')
const teamStats=computed(()=>[2,3].map(team=>{const players=replay.value.players.filter(p=>Number(p.teamNumber)===team);return {team,players,score:(replay.value.scoreTimeline||[]).filter(e=>e.team===team&&e.tick<=replay.value.globalTick).length,alive:players.filter(p=>p.alive!==false&&(p.health==null||Number(p.health)>0)).length,health:players.reduce((sum,p)=>sum+Math.max(0,Number(p.health)||0),0)}})),rounds=computed(()=>Array.from({length:Math.max(1,Number(replay.value.roundCount||24))},(_,i)=>i+1)),roundWinner=number=>({2:'t',3:'ct'}[(replay.value.scoreTimeline||[])[number-1]?.side]||''),roundWinnerLabel=number=>({ct:'CT 胜',t:'T 胜'}[roundWinner(number)]||'未记录'),events=computed(()=>replay.value.events.filter(e=>Number(e.tick)<=replay.value.globalTick&&['player_death','bomb_planted','bomb_defused','smokegrenade_detonate','inferno_startburn','flashbang_detonate'].includes(e.type)).slice(-8).reverse())
const roundKillStats=computed(()=>{const result=new Map();for(const event of replay.value.events||[]){if(event.type!=='player_death'||Number(event.tick)>Number(replay.value.globalTick))continue;let data={};try{data=typeof event.data==='string'?JSON.parse(event.data):(event.data||{})}catch{};const sid=String(data.attacker_steamid||data.attacker_steamid64||data.attacker_xuid||'');if(!sid)continue;const row=result.get(sid)||{kills:0,headshots:0};row.kills++;if(data.headshot||data.head_shot||data.headshot_bool)row.headshots++;result.set(sid,row)}return result})
let raf=0,scrubDrawFrame=0,resizeObserver=null,lastSampleAt=0,fromPlayers=[],toPlayers=[],playbackRequest=0,canvasWidth=0,canvasHeight=0,canvasDpr=0,sampleInterval=250,sampleDuration=250
const positionCache=new Map()
let controller=null,lastFrame=0,lastFetch=0,endLoaded=false,endHold=0,suppressPovSync=false
const replayError=ref(''),roundSwitching=ref(false)
const controlsBusy=computed(()=>roundSwitching.value||(loadingReplay.value&&!replay.value.players.length))
const selectedPlayers=ref([])
const timelinePlayer=ref('')
const timelineMarkers=computed(()=>playerTimelineMarkers(grenadeMarkers.value,replay.value.events,timelinePlayer.value,replay.value.startTick,replay.value.endTick))
const timelineScopeLabel=computed(()=>timelinePlayer.value ? `${throwerLabel(timelinePlayer.value)} 的事件` : '全局事件')
const markerTitle=marker=>`${marker.label} · ${marker.thrower} · ${formatClock((marker.tick-replay.value.startTick)/(Number(replay.value.tickRate)||64))} · 点击查看前 3 秒`
function clearPlayerSelection(){selectedPlayers.value=[];if(!overlayVideoUrl.value)timelinePlayer.value=''}
const favorites=ref(readPovFavorites(localStorage.getItem('cs2-pov-favorites')))
const selectedPlayerNames=computed(()=>selectedPlayers.value.map(id=>replay.value.players.find(p=>String(p.steamid)===id)?.name?.trim()||id).join('、'))
const currentFavoriteSelection=computed(()=>({matchId:matchId.value,round:Number(replay.value.roundNumber||round.value),players:selectedPlayers.value.map(steamid=>({steamid}))}))
const selectionSaved=computed(()=>favorites.value.some(item=>samePovFavorite(item,currentFavoriteSelection.value)))
const selectionReady=computed(()=>!replayError.value&&Boolean(currentMap.value)&&replay.value.players.length>0&&Number(replay.value.matchId)===Number(matchId.value)&&Number(replay.value.roundNumber)===Number(round.value))
const favoriteError=ref('')
const togglePlayer=id=>{const key=String(id),wasSelected=selectedPlayers.value.includes(key);selectedPlayers.value=wasSelected?selectedPlayers.value.filter(x=>x!==key):[...selectedPlayers.value,key];if(!overlayVideoUrl.value)timelinePlayer.value=wasSelected&&timelinePlayer.value===key?'':key}
const saveFavorite=()=>{
  if(!selectedPlayers.value.length||!selectionReady.value||selectionSaved.value)return
  const actualRound=Number(replay.value.roundNumber||round.value),match=matches.value.find(m=>Number(m.id)===Number(matchId.value))
  const item={id:Date.now(),matchId:matchId.value,map:currentMap.value,matchFile:match?.file||'',matchServer:match?.server||'',matchDate:match?.date||'',round:actualRound,startTick:Number(replay.value.startTick),endTick:Number(replay.value.endTick),players:selectedPlayers.value.map(id=>{const p=replay.value.players.find(x=>String(x.steamid)===id);return {steamid:id,name:p?.name||id,slot:Math.max(1,replay.value.players.findIndex(x=>String(x.steamid)===id)+1)}}),createdAt:new Date().toISOString()}
  try {
    const next=addPovFavorite(readPovFavorites(localStorage.getItem('cs2-pov-favorites')),item)
    localStorage.setItem('cs2-pov-favorites',JSON.stringify(next));favorites.value=next;favoriteError.value=''
  } catch { favoriteError.value='收藏保存失败，请重试' }
}
const povJobs=ref([]),povVideos=ref([]),povPanel=ref(null),povOverlayHost=ref(null),overlayVideoUrl=ref(''),overlayVideo=ref(null),expandedPovUrl=ref('')
const povMediaState=ref({})
const povMediaCache=createPovMediaCache({onChange:state=>{povMediaState.value=state}})
const povCacheLabel=computed(()=>{const files=currentPovFiles.value,ready=files.filter(f=>povMediaState.value[f.url]?.status==='ready').length;return !files.length?'':ready===files.length?`已缓存 ${ready} 个视角`:`缓存视频 ${ready}/${files.length}`})
let overlayOrigin=null
const timelineDragging=ref(false),timelineValue=ref(0)
let timelineWasPlaying=false
const activePovVideos=()=>[...(povPanel.value?.querySelectorAll('video')||[])]
const allPovVideos=()=>{const out=activePovVideos();if(overlayVideo.value&&!out.includes(overlayVideo.value))out.push(overlayVideo.value);return out}
// During a scrub, syncing every thumbnail forces several decoders to seek at
// once. Keep the transport-critical pair hot and let muted thumbnails catch up
// on the next settled tick.
const transportVideos=()=>{const first=activePovVideos()[0],out=[];for(const v of [overlayVideo.value,first])if(v&&!out.includes(v))out.push(v);return out}
const expectedTransport=new WeakMap(),expectedSeek=new WeakMap()
const pendingVideoSeek=new WeakMap()
const pendingVideoPlay=new WeakSet()
const switchingOverlaySource=ref(false)
const povPlaybackSeconds=()=>playbackSeconds(replay.value.globalTick,replay.value.startTick,Number(replay.value.tickRate)||64)
const fullscreenPov=ref(null)
let previousAudioVideo=null
let seekGeneration=0
const audioVideo=()=>fullscreenPov.value||(overlayVideo.value&&overlayVideoUrl.value?overlayVideo.value:activePovVideos()[0])
function routePovAudio(){
  const target=audioVideo()
  // Only write changed properties: volumechange must not create a feedback
  // loop, and the chosen video's own mute/volume controls remain usable.
  for(const v of allPovVideos())if(v!==target&&!v.muted)v.muted=true
  if(target&&target!==previousAudioVideo)target.muted=false
  previousAudioVideo=target||null
}
function enforcePovAudio(event){if(event.target!==audioVideo()&&!event.target.muted)event.target.muted=true;routePovAudio()}
function onPovFullscreenChange(){
  const element=document.fullscreenElement||document.webkitFullscreenElement
  overlayFullscreen.value=element===povOverlay.value
  fullscreenPov.value=overlayFullscreen.value?overlayVideo.value:allPovVideos().includes(element)?element:null
  routePovAudio()
  nextTick(draw)
}
async function togglePovFullscreen(){
  try{if(document.fullscreenElement)await document.exitFullscreen();else await povOverlay.value?.requestFullscreen()}catch{replayError.value='无法进入 POV 全屏，请重试'}
}
function onOverlayClick(event){
  const overlay=event.currentTarget, video=overlayVideo.value
  if(event.target===overlay){closeOverlayVideo();return}
  if(event.target!==video||!video)return
  // The video element fills the stage for stable sizing, so object-fit's
  // letterbox area still reports the video as the click target. Treat only
  // that rendered blank area as the backdrop; controls and the picture keep
  // their native behaviour.
  const rect=video.getBoundingClientRect(),aspect=video.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:16/9
  const boxAspect=rect.width/Math.max(1,rect.height)
  const contentWidth=boxAspect>aspect?rect.height*aspect:rect.width
  const contentHeight=boxAspect>aspect?rect.height:rect.width/aspect
  const left=rect.left+(rect.width-contentWidth)/2,top=rect.top+(rect.height-contentHeight)/2
  if(event.clientX<left||event.clientX>left+contentWidth||event.clientY<top||event.clientY>top+contentHeight)closeOverlayVideo()
}
function setVideoPlaying(v,play){
  if(play){
    if(!v.paused||v.ended||!povReady(v)||pendingVideoPlay.has(v))return
    expectedTransport.set(v,'play');pendingVideoPlay.add(v)
    const start=()=>v.play().catch(async error=>{
      // A source swap from an asynchronous canplay callback can lose the
      // original click's autoplay gesture. Start muted, then restore the
      // routed audio target once Chromium has accepted playback.
      if(v.muted)return Promise.reject(error)
      const muted=v.muted
      v.muted=true
      try{await v.play();v.muted=muted;routePovAudio()}catch{v.muted=muted;throw error}
    })
    start().then(()=>{
      // A play promise may finish after the user has already paused or closed
      // the overlay. Do not let that late completion restart one POV.
      if(!playing.value||!allPovVideos().includes(v))setVideoPlaying(v,false)
    }).catch(()=>{if(expectedTransport.get(v)==='play')expectedTransport.delete(v)})
      .finally(()=>pendingVideoPlay.delete(v))
  }else if(!v.paused){expectedTransport.set(v,'pause');v.pause()}
}
function setPlayback(play,source=null){playing.value=play;lastFrame=performance.now();routePovAudio();for(const v of allPovVideos())if(v!==source)setVideoPlaying(v,play);if(!play)syncPovVideo()}
function setVideoTime(v,seconds){if(v.readyState<1)return;const target=Math.max(0,Math.min(Number.isFinite(v.duration)?v.duration:seconds,seconds));if(v.seeking){pendingVideoSeek.set(v,target);return}pendingVideoSeek.delete(v);if(Math.abs(v.currentTime-target)<(playing.value?.12:.04))return;expectedSeek.set(v,target);v.currentTime=target}
function onVideoTransport(event){
  const v=event.target,type=event.type
  if(expectedTransport.get(v)===type){expectedTransport.delete(v);return}
  if(!allPovVideos().includes(v))return
  // Media elements emit play/pause while buffering, seeking and changing
  // rounds. Those events are not user intent and must never flip the button
  // state; `playing` is owned by the center transport control.
  const nearEnd=Number.isFinite(v.duration)&&v.duration>0&&v.currentTime>=v.duration-.2
  if(type==='pause'&&playing.value&&!roundSwitching.value&&!loadingReplay.value&&!nearEnd&&!isPovAutomaticPause(v,v===overlayVideo.value&&switchingOverlaySource.value))setVideoPlaying(v,true)
  if(type==='play'&&!playing.value)setVideoPlaying(v,false)
}
function onVideoSeek(event){
  const v=event.target,expected=expectedSeek.get(v),pending=pendingVideoSeek.get(v)
  expectedSeek.delete(v);pendingVideoSeek.delete(v)
  if(pending!==undefined&&Math.abs(v.currentTime-pending)>.04){setVideoTime(v,pending);return}
  if(expected!==undefined||roundSwitching.value||timelineDragging.value||suppressPovSync||!allPovVideos().includes(v))return
  if(!Number.isFinite(v.duration)||v.duration<=0)return
  void seek({target:{value:povPlaybackTick(v.currentTime,replay.value.startTick,replay.value.endTick,Number(replay.value.tickRate)||64)}},playing.value)
}
// HAVE_CURRENT_DATA (2) is enough to start playback. Waiting for HAVE_FUTURE_DATA
// (3) prevents browsers from starting streams that are already buffered enough.
const povReady=v=>v.readyState>=2&&!v.seeking&&!v.error
const currentPovJobs=computed(()=>povJobs.value.filter(j=>Number(j.matchId??j.match_id)===Number(matchId.value)&&Number(j.round)===Number(round.value)&&j.status==='completed'&&j.fileUrl))
const currentPovFiles=computed(()=>currentPovJobs.value.flatMap(j=>{
  const files=j.files?.length?j.files:[{name:'final.mp4',url:j.fileUrl}]
  return files.map(f=>{
    const raw=String(f.name||''); const match=raw.match(/player[_-]?(\d+)/i); const slot=match?Number(match[1]):null
    const player=slot!=null?j.players?.[slot]:j.players?.length===1?j.players[0]:null
    return {...f,name:player?.name||player?.steamid||raw,slot,steamid:player?.steamid||null,url:f.url?.startsWith('/')?`${API.replace(/\/api$/,'')}${f.url}`:f.url}
  })
}))
const loadPovExports=async()=>{const id=Number(matchId.value);if(!id)return;try{const r=await fetch(`${API}/pov/exports?matchId=${id}`);if(!r.ok)return;const rows=await r.json();if(id!==Number(matchId.value))return;const active=povJobs.value.filter(j=>Number(j.matchId??j.match_id)===id&&['queued','recording'].includes(j.status));povJobs.value=[...rows.filter(j=>Number(j.matchId??j.match_id)===id).map(j=>({...j,matchId:id,fileUrl:j.fileUrl?.startsWith('/')?`${API.replace(/\/api$/,'')}${j.fileUrl}`:j.fileUrl})),...active]}catch{}}
const povExporting=ref(new Set())
const watchPovJob=async id=>{for(let i=0;i<720;i++){await new Promise(r=>setTimeout(r,2000));const r=await fetch(`${API}/pov/export/${id}`);const j=await r.json();const old=povJobs.value.find(x=>x.jobId===id)||{};if(j.status==='completed'&&!j.fileUrl)j.fileUrl=`${API}/pov/export/${id}/file`;const merged={...old,...j};povJobs.value=[merged,...povJobs.value.filter(x=>x.jobId!==id)];if(j.status==='completed'||j.status==='failed'){await loadPovExports();return merged}}}
const syncPovVideo=(transport=false)=>{routePovAudio();const videos=transport?transportVideos():allPovVideos();for(const v of videos){setVideoTime(v,povPlaybackSeconds());if(transport)setVideoPlaying(v,playing.value)}}
function syncPovTransport(){
  routePovAudio()
  for(const v of transportVideos()){
    if(playing.value){if(v.paused&&!v.ended&&povReady(v))setVideoPlaying(v,true)}
    else if(!v.paused)setVideoPlaying(v,false)
  }
}
const resyncPovVideo=async()=>{await nextTick();syncPovVideo(true)}
const deletePovJob=async job=>{if(!confirm('删除这个 POV 及其本地视频文件？'))return;const r=await fetch(`${API}/pov/export/${job.jobId}`,{method:'DELETE'});if(r.ok){povJobs.value=povJobs.value.filter(x=>x.jobId!==job.jobId);if(!currentPovJobs.value.length)closeOverlayVideo();await loadPovExports()}else replayError.value='删除 POV 失败'}
const exportFavoriteTask=async item=>{if(povExporting.value.has(item.id))return;povExporting.value=new Set(povExporting.value).add(item.id);const raw=item.players;const one={...item,players:raw.map(p=>{const idx=replay.value.players.findIndex(x=>String(x.steamid)===String(p.steamid));return {...p,slot:Number(p.slot)||Math.max(1,idx+1)}})};try{const r=await fetch(`${API}/pov/export`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(one)});const data=await r.json();if(!r.ok)throw new Error(data.message||'启动 POV 导出失败');povJobs.value=[{...data,...one},...povJobs.value];watchPovJob(data.jobId)}catch(e){replayError.value=e.message}finally{const next=new Set(povExporting.value);next.delete(item.id);povExporting.value=next}}
const startFavoriteExport=exportFavoriteTask
const exportFavorites=()=>{const blob=new Blob([JSON.stringify(favorites.value,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='cs2-pov-favorites.json';a.click();URL.revokeObjectURL(a.href)}
async function loadMatches(){try{const r=await fetch(`${API}/matches`);if(!r.ok)throw new Error('比赛列表加载失败');matches.value=await r.json();if(!matchId.value)matchId.value=matches.value[0]?.id||0}catch(e){replayError.value=e.message}}
async function loadReplay(reset=false,targetRound=round.value){
  if(!matchId.value)return
  controller?.abort();controller=new AbortController()
  const requestId=++playbackRequest,requestedTick=reset?0:replay.value.globalTick
  loadingReplay.value=true;replayError.value='';lastFetch=performance.now()
  try{
    const requestedRound=Math.max(1,Number(targetRound)||Number(round.value)||1)
    const r=await fetch(`${API}/matches/${matchId.value}/replay?round=${requestedRound}&tick=${Math.floor(requestedTick)}`,{signal:controller.signal})
    if(!r.ok)throw new Error('回放加载失败，请重试')
    const n=await r.json();if(requestId!==playbackRequest)return
    const now=performance.now(),alpha=playing.value?Math.min(1,(now-lastSampleAt)/sampleDuration):1
    fromPlayers=reset?n.players:toPlayers.map(p=>{const q=fromPlayers.find(v=>v.steamid===p.steamid)||p;return {...p,x:Number(q.x)+(Number(p.x)-Number(q.x))*alpha,y:Number(q.y)+(Number(p.y)-Number(q.y))*alpha,yaw:lerpYaw(q.yaw,p.yaw,alpha)}})
    n.players=n.players.map(p=>{const key=String(p.steamid),has=Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y));if(has)positionCache.set(key,{x:p.x,y:p.y,z:p.z,yaw:p.yaw});const cached=positionCache.get(key);return has||!cached?p:(Object.assign({},p,cached))})
    toPlayers=n.players
    // Network latency must not stretch the visual interpolation across a round
    // boundary. Keep a stable transition window and let the next sample correct
    // the position naturally.
    const tickGap=Math.abs(Number(n.globalTick)-Number(replay.value.globalTick))
    sampleDuration=Math.min(2000,Math.max(sampleInterval,tickGap/64*1000))
    lastSampleAt=now
    const cursor=reset?n.globalTick:Math.max(n.startTick,Math.min(replay.value.globalTick,n.endTick))
    replay.value={...n,globalTick:cursor};if(reset||roundSwitching.value)round.value=n.roundNumber;if(!playing.value&&!suppressPovSync)resyncPovVideo()
    endLoaded=n.globalTick>=n.endTick
  draw();if(!playing.value&&!suppressPovSync)syncPovVideo()
  }catch(e){if(requestId===playbackRequest&&e.name!=='AbortError'){replayError.value=e.message;playing.value=false}}
  finally{if(requestId===playbackRequest)loadingReplay.value=false}
}
function lerpYaw(from,to,alpha){const a=Number(from)||0,b=Number(to)||0;return a+((b-a+540)%360-180)*alpha}
async function selectRound(n){
  if(n<1||n>rounds.value.length||roundSwitching.value)return
  const wasPlaying=playing.value
  roundSwitching.value=true
  selectedPlayers.value=[]
  closeOverlayVideo()
  positionCache.clear();endLoaded=false;endHold=0;fromPlayers=[];toPlayers=[]
  try{
    await loadReplay(true,n)
    // Wait until the new round's POV cards have been reconciled before
    // releasing the transport guard. Otherwise an old video's late pause
    // event can pause the freshly loaded round and create a visible flash.
    await nextTick()
    await new Promise(resolve=>requestAnimationFrame(resolve))
    roundSwitching.value=false
    // A new round is an explicit visual boundary even when both rounds start
    // in the same semantic phase (for example, buy -> buy).
    nextTick(()=>syncHudAnimation(roundStatus.value,true))
    if(wasPlaying&&!replayError.value){playing.value=true;syncPovVideo(true);setPlayback(true)}
  }catch{roundSwitching.value=false}
}
function previousRound(){if(round.value>1)selectRound(round.value-1)}
function nextRound(){if(round.value<rounds.value.length)selectRound(round.value+1)}
function clampTimelineTick(value){return Math.max(Number(replay.value.startTick)||0,Math.min(Number(replay.value.endTick)||0,Number(value)||0))}
function updateTimelineScrub(event){
  const value=clampTimelineTick(event.target.value)
  timelineValue.value=value
  replay.value.globalTick=value
  endLoaded=false;endHold=0;fromPlayers=[];toPlayers=[]
  if(!scrubDrawFrame)scrubDrawFrame=requestAnimationFrame(()=>{scrubDrawFrame=0;draw()})
}
function startTimelineScrub(event){
  if(!timelineDragging.value){
    timelineDragging.value=true
    timelineWasPlaying=playing.value
    if(timelineWasPlaying)setPlayback(false)
  }
  updateTimelineScrub(event)
}
function finishTimelineScrub(event){
  if(!timelineDragging.value)startTimelineScrub(event)
  else updateTimelineScrub(event)
  const resume=timelineWasPlaying
  timelineWasPlaying=false
  timelineDragging.value=false
  seek(event,resume)
}
async function seek(e,resume=false){
  const seekId=++seekGeneration
  const scrollTop=window.scrollY
  const targetTick=clampTimelineTick(e?.target?.value)
  suppressPovSync=true
  replay.value.globalTick=targetTick
  timelineValue.value=targetTick
  endLoaded=false;endHold=0;fromPlayers=[];toPlayers=[]
  setPlayback(false)
  const videos=allPovVideos(),master=overlayVideo.value||activePovVideos()[0],target=povPlaybackSeconds()
  if(master)setVideoTime(master,target)
  const rest=videos.filter(v=>v!==master)
  try {
    await loadReplay()
    if(master)setVideoTime(master,target)
    await nextTick()
    if(seekId!==seekGeneration)return
    rest.forEach(v=>setVideoTime(v,target))
    if(resume&&!replayError.value)setPlayback(true)
  } finally {
    if(seekId===seekGeneration)suppressPovSync=false
  }
  draw()
  requestAnimationFrame(()=>window.scrollTo({top:scrollTop,behavior:'auto'}))
}
function jumpToThrow(event,tick){
  event?.preventDefault?.()
  event?.stopPropagation?.()
  timelineDragging.value=false
  const preview=eventPreviewTick(tick,replay.value.startTick,replay.value.endTick,replay.value.tickRate)
  void seek({target:{value:String(preview)}},playing.value)
}
function toggle(){++seekGeneration;suppressPovSync=false;if(replayError.value){loadReplay(true);return}setPlayback(!playing.value)}
function onPovReady(event){setVideoTime(event.target,povPlaybackSeconds());if(playing.value)setVideoPlaying(event.target,true)}
async function showOverlayVideo(url){
  ++seekGeneration
  suppressPovSync=false
  const same=overlayVideoUrl.value===url&&overlayVideo.value
  expandedPovUrl.value=url
  if(same)return
  const candidate=activePovVideos().find(v=>v.dataset.povUrl===url)
  if(!candidate||!povOverlayHost.value)return
  timelinePlayer.value=String(currentPovFiles.value.find(f=>f.url===url)?.steamid||'')
  switchingOverlaySource.value=true
  if(overlayVideo.value)closeOverlayVideo({keepFullscreen:true})
  const placeholder=document.createElement('span');placeholder.className='pov-video-placeholder'
  candidate.parentElement?.insertBefore(placeholder,candidate)
  overlayOrigin={video:candidate,placeholder,parent:candidate.parentElement}
  overlayVideo.value=candidate
  overlayVideoUrl.value=url
  candidate.dataset.overlay='true';candidate.controls=true;candidate.classList.add('pov-promoted-video')
  for(const [key,value] of [['position','relative'],['width','100%'],['height','100%'],['max-width','none'],['max-height','none'],['aspect-ratio','auto'],['object-fit','contain']])candidate.style.setProperty(key,value,'important')
  povOverlayHost.value.appendChild(candidate)
  await nextTick()
  onPovFullscreenChange()
  setVideoTime(candidate,povPlaybackSeconds())
  candidate.muted=false;previousAudioVideo=null;routePovAudio()
  requestAnimationFrame(()=>{if(overlayVideo.value!==candidate)return;switchingOverlaySource.value=false;candidate.muted=false;previousAudioVideo=null;routePovAudio();setVideoPlaying(candidate,playing.value)})
}

function closeOverlayVideo({keepFullscreen=false}={}){if(!keepFullscreen)timelinePlayer.value='';if(!keepFullscreen&&document.fullscreenElement===povOverlay.value)document.exitFullscreen().catch(()=>{});const wasPlaying=playing.value,origin=overlayOrigin,video=overlayVideo.value;if(origin?.video){origin.video.controls=false;origin.video.dataset.overlay='';origin.video.classList.remove('pov-promoted-video');for(const key of ['position','width','height','max-width','max-height','aspect-ratio','object-fit'])origin.video.style.removeProperty(key);origin.placeholder?.replaceWith(origin.video)}overlayOrigin=null;overlayVideo.value=null;switchingOverlaySource.value=keepFullscreen;expandedPovUrl.value='';overlayVideoUrl.value='';miniRadarPointer=null;nextTick(()=>{routePovAudio();if(video&&playing.value&&!roundSwitching.value)setVideoPlaying(video,true)})}
function syncHudAnimation(status=roundStatus.value,force=false){
  if(!hudAnimation)return
  if(lastHudStatus===null){
    lastHudStatus=status
    hudAnimation.settle()
    return
  }
  if(!force&&lastHudStatus===status)return
  lastHudStatus=status
  hudAnimation.replay()
  hudAnimation.play()
}
watch(roundStatus,status=>nextTick(()=>syncHudAnimation(status)),{flush:'post'})
function frame(now){
  const dt=Math.min(1000,Math.max(0,now-lastFrame));lastFrame=now
  // Native video controls can emit transport events while a source buffers.
  // Re-apply the shared state every frame so no POV can drift on its own.
  syncPovTransport()
  if(playing.value&&!replayError.value&&replay.value.endTick){
    // A round switch must finish before this clock may advance its new cursor.
    if(toPlayers.length){
      const master=overlayVideo.value||activePovVideos()[0]
      if(master&&povReady(master)&&!master.paused&&!master.ended){
        replay.value.globalTick=povPlaybackTick(master.currentTime,replay.value.startTick,replay.value.endTick,Number(replay.value.tickRate)||64)
      }else if(!master||master.ended){
        replay.value.globalTick=Math.min(replay.value.endTick,replay.value.globalTick+dt*(Number(replay.value.tickRate)||64)/1000)
      }
      
      for(const v of allPovVideos()){
        if(!povReady(v))continue
        if(Math.abs(v.currentTime-povPlaybackSeconds())>.35)setVideoTime(v,povPlaybackSeconds())
        setVideoPlaying(v,true)
      }
      if(replay.value.globalTick>=replay.value.endTick&&endLoaded){
        endHold+=dt
        const hudDuration=hudAnimation?.durationMs||1600
        if(endHold>=Math.max(600,hudDuration+120)){if(round.value<rounds.value.length)nextRound();else playing.value=false}
      }else if(!loadingReplay.value&&now-lastFetch>=sampleInterval)loadReplay()
    }
  }
  if(!timelineDragging.value)draw();raf=requestAnimationFrame(frame)
}
function draw(){
  drawRadar(canvas.value,false,'upper')
  if(nukeDual.value)drawRadar(lowerCanvas.value,false,'lower')
  if(overlayVideoUrl.value)drawRadar(miniRadar.value,true)
}
function drawRadar(c,mini=false,floor='upper'){
  if(!c||!c.clientWidth||!c.clientHeight)return
  const d=window.devicePixelRatio||1,w=c.clientWidth,h=c.clientHeight
  if(c.width!==Math.round(w*d)||c.height!==Math.round(h*d)){c.width=Math.round(w*d);c.height=Math.round(h*d)}
  const ctx=c.getContext('2d')
  ctx.setTransform(d,0,0,d,0,0)
  // Let the radar stage background continue through the canvas margins. A
  // separate opaque fill made the canvas boundary visibly darker than its
  // surrounding frame.
  ctx.clearRect(0,0,w,h)
  if(!currentMap.value)return
  const m=floor==='lower'&&radarCrops[currentMap.value]?{...radarMetadata[currentMap.value],crop:radarCrops[currentMap.value]}:radarMetadata[currentMap.value]
  const image=floor==='lower' ? lowerRadar.value : radar.value
  if(!m||!isRadarImage(image))return
  drawRadarMap(ctx,image,currentMap.value,w,h,m)
  const elapsed=performance.now()-lastSampleAt,alpha=playing.value?Math.min(1,elapsed/sampleDuration):1
  const effects=effectsForFloor(replayEffects.value,floor),tick=Number(replay.value.globalTick),tickRate=Number(replay.value.tickRate)||64
  drawEffectAreas(ctx,effects,tick,m,w,h,tickRate)
  drawTrajectories(ctx,effects,tick,m,w,h,sid=>sideColor(playerTeam(sid)),tickRate)
  // Bomb coordinates are resolved at the plant tick by the replay service.
  // Render the C4 badge first so player markers remain the top-most layer.
  drawEffectIcons(ctx,effects,tick,m,w,h,tickRate)
  const radius=mini?7:Math.max(8,Math.min(10,w*.013)),markers=[]
  const focusedSteamid=currentPovFiles.value.find(file=>file.url===overlayVideoUrl.value)?.steamid
  for(const p of (toPlayers.length?toPlayers:replay.value.players)){
    if(!mini&&nukeDual.value&&playerFloor(p)!==floor)continue
    const q=fromPlayers.find(v=>v.steamid===p.steamid)||p
    const destination=radarPoint(p.x,p.y,m,w,h)
    if(!destination)continue
    const origin=radarPoint(q.x,q.y,m,w,h)||destination
    const point={x:origin.x+(destination.x-origin.x)*alpha,y:origin.y+(destination.y-origin.y)*alpha}
    const dead=p.alive===false||(p.health!=null&&Number(p.health)<=0)
    markers.push({...point,player:p,dead,number:playerNumber(p),color:sideColor(Number(p.teamNumber)),yaw:lerpYaw(q.yaw,p.yaw,alpha),selected:mini?String(focusedSteamid)===String(p.steamid):selectedPlayers.value.includes(String(p.steamid))})
  }
  // Only one tooltip is visible, even when several players share a spawn.
  if(mini)drawnMiniRadarPlayers=markers;else if(floor==='lower')drawnLowerRadarPlayers=markers;else drawnRadarPlayers=markers
  const pointer=mini?miniRadarPointer:floor==='lower'?lowerRadarPointer:radarPointer
  const hovered=pointer?markers.map(marker=>({marker,distance:Math.hypot(marker.x-pointer.x,marker.y-pointer.y)})).filter(item=>item.distance<=radius+6).sort((a,b)=>a.distance-b.distance)[0]?.marker:null
  const ordered=markers.slice().sort((a,b)=>Number(b.dead)-Number(a.dead)||Number(a===hovered)-Number(b===hovered))
  for(const marker of ordered)drawPlayerMarker(ctx,{...marker,hovered:marker===hovered,radius})
  drawGunfire(ctx,effects,tick,m,w,h,markers,tickRate)
  if(hovered)drawPlayerTooltip(ctx,{...hovered.player,...hovered},hovered,w,h)
  c.style.cursor=hovered&&currentPovFiles.value.some(file=>String(file.steamid)===String(hovered.player.steamid))?'pointer':hovered?'help':'default'
}
function playerFloor(player){return Number(player?.z)<-495?'lower':'upper'}
function effectsForFloor(effects,floor){
  if(currentMap.value!=='de_nuke')return effects
  const lower=floor==='lower', matches=z=>Number.isFinite(Number(z))&&((Number(z)<-495)===lower)
  return {...effects,zones:effects.zones.filter(zone=>zone.kind==='bomb'&&zone.z==null ? !lower : matches(zone.z)),paths:effects.paths.filter(path=>matches(path.points?.[0]?.[3])),shots:effects.shots.filter(shot=>matches(shot.z))}
}

watch(()=>route.params.id,id=>{const next=Number(id)||0;if(next!==Number(matchId.value))matchId.value=next})
// Match metadata can arrive after replay snapshots. Never substitute another
// map's radar or save its name into a favorite while those requests race.
watch(currentMap,map=>{
  radar.value=null;lowerRadar.value=null;radarError.value=''
  if(!map)return
  if(!radarMetadata[map]){radarError.value='该地图缺少雷达坐标配置';draw();return}
  const load=(src,target)=>{const image=new Image();target.value=image;image.onload=()=>{if(target.value===image){if(!isRadarImage(image)){target.value=null;radarError.value='雷达底图尺寸错误，无法显示 2D 地图'}draw()}};image.onerror=()=>{if(target.value===image){target.value=null;radarError.value='雷达底图加载失败';draw()}};image.src=assetUrl(src)}
  load(`/maps/radar/${map}.png`,radar)
  if(map==='de_nuke')load('/maps/radar/de_nuke_lower.png',lowerRadar)
},{immediate:true})
watch(matchId,()=>{playing.value=false;selectedPlayers.value=[];favoriteError.value='';positionCache.clear();povJobs.value=[];round.value=Math.max(1,Number(route.query.round)||1);endLoaded=false;endHold=0;fromPlayers=[];toPlayers=[];loadPovExports();loadReplay(true)},{immediate:true})
watch(()=>currentPovFiles.value.map(f=>f.url).join('|'),()=>{allPovVideos().forEach(v=>setVideoPlaying(v,false));povMediaCache.setFiles(currentPovFiles.value.map(f=>f.url));resyncPovVideo()},{immediate:true})
let resizeDrawFrame=0
const scheduleResizeDraw=()=>{if(resizeDrawFrame)return;resizeDrawFrame=requestAnimationFrame(()=>{resizeDrawFrame=0;draw()})}
onMounted(()=>{document.addEventListener('fullscreenchange',onPovFullscreenChange);document.addEventListener('webkitfullscreenchange',onPovFullscreenChange);window.addEventListener('resize',scheduleResizeDraw);nextTick(()=>{hudAnimation=createHudAnimationController(hudRoot.value,{mode:HUD_ANIMATION_MODES.COMPACT,durationMs:1600,loop:false});syncHudAnimation(roundStatus.value)});loadGameIcons(assetUrl,draw);loadMatches();raf=requestAnimationFrame(frame)})
onUnmounted(()=>{povMediaCache.dispose();document.removeEventListener('fullscreenchange',onPovFullscreenChange);document.removeEventListener('webkitfullscreenchange',onPovFullscreenChange);window.removeEventListener('resize',scheduleResizeDraw);closeOverlayVideo();hudAnimation?.destroy();hudAnimation=null;++playbackRequest;controller?.abort();cancelAnimationFrame(raf);cancelAnimationFrame(resizeDrawFrame);resizeObserver?.disconnect()})
</script>
<template>
<main class="replay-page" @click="onReplayBlankClick">
  <header class="replay-command-bar">
    <div class="replay-context">
      <h1>2D 回放</h1>
      <span>{{currentMap ? currentMap.replace(/^de_/, '').toUpperCase() : '…'}} · 第 {{round}} 回合</span>
    </div>
    <div class="pov-selection" aria-label="POV 玩家选择" role="group">
      <span class="pov-selection-count"><EndfieldIcon name="players" :size="16" />已选 <strong>{{selectedPlayers.length}}</strong> 人</span>
      <span class="pov-selection-names" :title="selectedPlayerNames">{{selectedPlayerNames || '未选择玩家'}}</span>
      <button class="pov-clear-selection ef-button ef-button--danger ef-button--icon" :disabled="!selectedPlayers.length" aria-label="清空玩家选择" title="清空玩家选择" @click="clearPlayerSelection"><EndfieldIcon name="remove" :size="16" /></button>
    </div>
    <div class="replay-command-actions">
      <button class="pov-save-selection ef-button ef-button--toolbar" :class="{saved:selectionSaved}" :disabled="!selectedPlayers.length || !selectionReady || selectionSaved" @click="saveFavorite"><EndfieldIcon name="archive" :size="16" /><span>{{selectionSaved ? '已收藏' : '收藏本回合 POV'}}</span></button>
      <button class="replay-back ef-button ef-button--toolbar" @click="router.push({name:'matches',params:{id:matchId}})"><EndfieldIcon name="chevron" :size="16" /><span>返回比赛记录</span></button>
    </div>
  </header>
  <div class="replay-status" :class="{visible:replayError || favoriteError}" role="status"><template v-if="replayError">{{replayError}} <button class="ef-button" @click="loadReplay(true)">重试</button></template><template v-else-if="favoriteError">{{favoriteError}} <button class="ef-button" @click="saveFavorite">重试</button></template></div>
  <section class="replay-layout" :aria-busy="loadingReplay"><div class="replay-stage"><div ref="povOverlay" v-show="overlayVideoUrl" class="pov-overlay" :class="{switching: switchingOverlaySource}" @click="onOverlayClick"><div ref="povOverlayHost" class="pov-overlay-host"></div>
    <div v-if="overlayVideoUrl && povMediaState[overlayVideoUrl]?.status!=='ready'" class="pov-overlay-cache-note" role="status" @click.stop>
      <span>{{povMediaState[overlayVideoUrl]?.error || '正在完整缓存本回合视频…'}}</span>
      <button v-if="povMediaState[overlayVideoUrl]?.status==='error'" class="ef-button ef-button--quiet" @click="povMediaCache.retry(overlayVideoUrl)">重试</button>
    </div><div class="pov-overlay-actions" @click.stop>
      <button class="ef-button ef-button--quiet" :aria-label="overlayFullscreen ? '退出 POV 全屏' : '全屏 POV 与小地图'" @click="togglePovFullscreen">{{overlayFullscreen ? '退出全屏' : '全屏'}}</button>
      <button class="pov-overlay-close ef-button ef-button--quiet ef-button--icon" aria-label="关闭 POV 视频" @click="closeOverlayVideo">×</button>
    </div>
    <aside class="pov-mini-map" aria-label="POV 战术小地图" @click.stop>
      <div class="pov-mini-map-stage">
        <canvas ref="miniRadar" aria-label="点击玩家标记切换对应 POV" @pointermove="onRadarPointer($event,true)" @pointerleave="clearRadarPointer(true)" @click="onRadarClick($event,true)"></canvas>
        <span v-if="radarError || !radar" class="pov-mini-map-status" role="status">{{radarError || '地图加载中'}}</span>
      </div>
      <div class="pov-mini-map-players" aria-label="已录制玩家视角">
        <button v-for="file in currentPovFiles.filter(f=>f.steamid)" :key="file.url" :title="file.name" :aria-label="`切换到 ${file.name} 的 POV`" :aria-pressed="file.url===overlayVideoUrl" :class="{active:file.url===overlayVideoUrl}" @click="showOverlayVideo(file.url)">{{playerNumbers.get(String(file.steamid)) || '?'}}</button>
      </div>
    </aside>
    </div><div class="team-overlay team-left">
<b>TEAM A · {{teamStats[0]?.alive}}/{{teamStats[0]?.players.length}}<em class="team-score">{{teamStats[0]?.score}}</em></b>
<ReplayPlayerCard v-for="p in teamStats[0]?.players" :key="p.steamid" :player="p" :round-stats="roundKillStats.get(String(p.steamid))" :selected="selectedPlayers.includes(String(p.steamid))" :radar-number="playerNumber(p)" :radar-color="sideColor(Number(p.teamNumber))" :weapon-icon="playerWeaponIcon(p)" :equipment="inventoryIcons(p.inventory).filter(item => ['hegrenade','flashbang','smokegrenade','incgrenade','defuser','c4'].includes(item))" @toggle="togglePlayer" />
</div><div class="radar-panel"><canvas ref="canvas" tabindex="0" aria-label="战术地图，玩家编号与两侧卡片对应；点击玩家切换到该玩家的 POV（如果已录制）" @pointermove="onRadarPointer" @pointerleave="clearRadarPointer()" @click="onRadarClick"></canvas><div ref="hudRoot" class="replay-hud" :class="{paused: !playing, loading: loadingReplay, [`status-${roundStatus}`]: true}" aria-label="回合倒计时与状态"><div class="hud-pill"><div class="ripples" aria-hidden="true"><i></i><i></i><i></i></div></div><div class="hud-icon"><EndfieldIcon v-if="roundStatus==='buy'" name="buy" :size="15" label="购买时间" /><img v-else-if="roundStatus==='bomb'" class="hud-game-icon" :src="assetUrl('/weapons-flat/c4.svg')" alt="C4 状态" /><img v-else-if="roundStatus==='defused'" class="hud-game-icon" :src="assetUrl('/weapons-flat/defuser.svg')" alt="拆弹器" /><EndfieldIcon v-else name="pulse" :size="15" label="正常回合" /></div><div class="hud-values"><span class="hud-phase">{{hudPhaseLabel}}</span><span class="hud-primary">{{roundSeconds.text}}</span><span class="hud-badge">{{playing ? 'LIVE' : 'PAUSE'}}</span></div></div><div v-if="nukeDual" class="nuke-lower-inset" aria-label="Nuke 下层缩略地图"><span class="nuke-floor-label">下层 · {{replay.players.filter(p=>playerFloor(p)==='lower').length}} 人</span><canvas ref="lowerCanvas" tabindex="0" aria-label="Nuke 下层战术地图" @pointermove="onRadarPointer($event,false,'lower')" @pointerleave="clearRadarPointer(false,'lower')" @click="onRadarClick($event,false,'lower')"></canvas></div><div v-if="radarError || (effectsMissing && !loadingReplay && replay.players.length)" class="radar-effects-note" role="status"><template v-if="radarError">{{radarError}}</template><template v-else>{{effectsMissing}}</template></div><div class="killfeed"><div v-for="(k,i) in killfeed" :key="`${k.tick}-${i}`"><b :style="{color:killInfo(k).attackerColor}">{{killInfo(k).attacker}}</b><span v-if="killInfo(k).assister" class="kill-assist">+ {{killInfo(k).assister}}</span><img v-if="killInfo(k).icon" :src="killInfo(k).icon" class="kill-icon" :alt="killInfo(k).weapon"><span v-else class="kill-weapon-label">{{killInfo(k).weaponLabel}}</span><span v-if="killInfo(k).throughSmoke" class="kill-smoke">穿烟</span><img v-if="killInfo(k).headshot" class="headshot-icon" :src="assetUrl('/weapons-flat/icon_headshot.svg')" alt="爆头"><strong :style="{color:killInfo(k).victimColor}">{{killInfo(k).victim}}</strong></div></div></div><div class="team-overlay team-right">
<b>TEAM B · {{teamStats[1]?.alive}}/{{teamStats[1]?.players.length}}<em class="team-score">{{teamStats[1]?.score}}</em></b>
<ReplayPlayerCard v-for="p in teamStats[1]?.players" :key="p.steamid" :player="p" :round-stats="roundKillStats.get(String(p.steamid))" :mirror-weapon="true" :selected="selectedPlayers.includes(String(p.steamid))" :radar-number="playerNumber(p)" :radar-color="sideColor(Number(p.teamNumber))" :weapon-icon="playerWeaponIcon(p)" :equipment="inventoryIcons(p.inventory).filter(item => ['hegrenade','flashbang','smokegrenade','incgrenade','defuser','c4'].includes(item))" @toggle="togglePlayer" />
</div></div></section><section class="timeline"><div class="replay-center-controls" aria-label="回合回放控制"><span class="timeline-clock">{{formatClock((replay.globalTick-replay.startTick)/64)}} / {{formatClock((replay.endTick-replay.startTick)/64)}}</span><button v-memo="[round, controlsBusy]" class="round-nav-button" title="上一回合" aria-label="上一回合" :disabled="round<=1 || controlsBusy" @click="previousRound"><EndfieldIcon name="previous" :size="18" /></button><button v-memo="[playing]" class="center-play-button" :title="playing ? '暂停回放' : '播放回放'" :aria-label="playing ? '暂停回放' : '播放回放'" @click="toggle"><EndfieldIcon :name="playing ? 'pause' : 'play'" :size="24" /></button><button v-memo="[round, rounds.length, controlsBusy]" class="round-nav-button" title="下一回合" aria-label="下一回合" :disabled="round>=rounds.length || controlsBusy" @click="nextRound"><EndfieldIcon name="next" :size="18" /></button><span class="round-counter">第 {{round}} 回合</span></div><div v-memo="[round, rounds.length]" class="round-track" :style="{gridTemplateColumns:`repeat(${rounds.length}, minmax(0, 1fr))`}"><button v-for="n in rounds" :key="n" :class="[{active:n===round}, `winner-${roundWinner(n)}`]" @click="selectRound(n)" :aria-label="`跳转到第 ${n} 回合，${roundWinnerLabel(n)}`" :title="`第 ${n} 回合 · ${roundWinnerLabel(n)}`">{{n}}</button></div><div class="timeline-scrubber-wrap">
  <div v-for="lane in ['above','middle','below']" :key="lane" class="grenade-markers" :class="`grenade-markers-${lane}`" :aria-label="`${timelineScopeLabel} · ${lane==='above'?'上方':lane==='below'?'下方':'中间'}事件`">
    <button v-for="marker in timelineMarkers.filter(item=>item.lane===lane)" type="button" :key="marker.key" class="grenade-marker" :class="`team-${marker.team}`" :data-event-tick="marker.tick" :data-event-kind="marker.kind" :style="{left:`${marker.percent}%`}" :title="markerTitle(marker)" :aria-label="`${markerTitle(marker)}，跳转到事件前 3 秒`" @click="jumpToThrow($event,marker.tick)">
      <EndfieldIcon v-if="marker.symbol" :name="marker.symbol" :size="15" />
      <span v-else class="grenade-marker-icon" aria-hidden="true" :style="{maskImage:`url(${marker.icon})`,WebkitMaskImage:`url(${marker.icon})`}"></span>
    </button>
  </div>
  <input class="timeline-scrubber" aria-label="当前回合进度" type="range" step="1" :min="replay.startTick" :max="replay.endTick||1" :value="timelineDragging ? timelineValue : replay.globalTick" @pointerdown="startTimelineScrub" @input="updateTimelineScrub" @change="finishTimelineScrub"/>
</div></section><section ref="povPanel" class="pov-panel" aria-label="已录制玩家视角">
  <div class="pov-panel-title">
    <div class="pov-panel-heading"><span>已录制 POV</span><small>回合 {{round}} · {{currentPovFiles.length}} 个视角 · {{povCacheLabel}}</small></div>
    <div class="pov-panel-actions">
      <button v-if="overlayVideoUrl" class="ef-button" @click="closeOverlayVideo">返回 2D 地图</button>
      <button v-for="job in currentPovJobs" :key="job.jobId" class="ef-button ef-button--danger" @click="deletePovJob(job)">删除已导出 POV</button>
    </div>
  </div>
  <div v-if="currentPovFiles.length" class="pov-video-grid">
    <article v-for="(f,i) in currentPovFiles" :key="f.url" class="pov-video-card" :class="{active: overlayVideoUrl===f.url}"
      role="button" tabindex="0" :aria-label="`查看 ${f.name} 的 POV`" :aria-pressed="overlayVideoUrl===f.url"
      @click="showOverlayVideo(f.url)" @keydown.enter.prevent="showOverlayVideo(f.url)" @keydown.space.prevent="showOverlayVideo(f.url)">
      <video ref="povVideos" class="pov-video" playsinline preload="auto" :data-pov-url="f.url" :src="povMediaState[f.url]?.url || undefined" tabindex="-1"
        :muted="Boolean(overlayVideoUrl) || i!==0"
        @click.stop="onPovVideoClick($event,f.url)"
        @seeked="onVideoSeek" @play="onVideoTransport" @pause="onVideoTransport"
        @volumechange="enforcePovAudio" @loadedmetadata="syncPovVideo" @canplay="onPovReady"></video>
      <div v-if="povMediaState[f.url]?.status!=='ready' && overlayVideoUrl!==f.url" class="pov-cache-note" role="status">
        <span>{{povMediaState[f.url]?.error || '正在缓存视频…'}}</span>
        <button v-if="povMediaState[f.url]?.status==='error'" class="ef-button ef-button--quiet" @click.stop="povMediaCache.retry(f.url)">重试</button>
      </div>
      <div class="pov-card-footer">
        <span class="pov-file-label" :title="f.name">{{f.name}}</span>
        <span v-if="!overlayVideoUrl && i===0" class="pov-audio-label">声音</span>
      </div>
    </article>
  </div>
  <div v-else class="pov-empty">当前回合还没有录制好的视角</div>
</section></main></template>
