<script setup>
import { computed } from 'vue'
import { assetUrl } from '../lib/presentation'

const props = defineProps({
  player: { type: Object, required: true },
  roundStats: { type: Object, default: () => ({ kills: 0, headshots: 0 }) },
  mirrorWeapon: { type: Boolean, default: false },
  selected: { type: Boolean, default: false },
  weaponIcon: { type: String, default: '' },
  equipment: { type: Array, default: () => [] },
  radarNumber: { type: String, default: '' },
  radarColor: { type: String, default: '#e5efec' },
})
const emit = defineEmits(['toggle'])
const dead = computed(() => props.player.alive === false || (props.player.health != null && Number(props.player.health) <= 0))
const health = computed(() => props.player.health == null || !Number.isFinite(Number(props.player.health)) ? null : Math.max(0, Math.min(100, Number(props.player.health))))
const killStars = computed(() => Array.from({ length: Math.min(5, Math.max(0, Number(props.roundStats?.kills) || 0)) }))
const stats = computed(() => {
  const old = props.player.kda ? String(props.player.kda).split(/[/-]/) : []
  return [props.player.kills ?? old[0] ?? '—', props.player.deaths ?? old[1] ?? '—', props.player.assists ?? old[2] ?? '—']
})
const equipmentSlots = ['hegrenade', 'flashbang', 'smokegrenade', 'incgrenade', 'defuser', 'c4']
const equipmentNames = { hegrenade: '高爆手雷', flashbang: '闪光弹', smokegrenade: '烟雾弹', incgrenade: '燃烧弹', defuser: '拆弹器', c4: 'C4 炸弹' }
</script>

<template>
  <article class="replay-player-card" :class="{ dead, selected }" :style="{ '--player-color': radarColor }" role="button" tabindex="0" :aria-label="`选择 ${player.name || player.steamid} 的 POV`" :aria-pressed="selected" @click="emit('toggle', player.steamid)" @keydown.enter.prevent="!$event.repeat && emit('toggle', player.steamid)" @keydown.space.prevent="!$event.repeat && emit('toggle', player.steamid)">
    <div class="player-identity">
      <div class="player-name" :title="`${player.name} · ${player.steamid}`">{{ player.name || player.steamid }}</div>
      <div class="player-selection-label" aria-hidden="true">POV</div>
      <div class="player-state">{{ dead ? '阵亡' : '存活' }}</div>
    </div>
    <div class="player-broadcast">
      <div class="player-score">
        <div class="player-kd" title="击杀 / 死亡">
          <div aria-label="击杀"><div class="player-stat-label">K</div>{{ stats[0] }}</div>
          <div><img :src="assetUrl('/weapons-flat/icon_suicide.svg')" alt="死亡">{{ stats[1] }}</div>
        </div>
        <div class="player-assists">助攻 {{ stats[2] }}</div>
      </div>
      <div class="player-id-portrait" :title="`SteamID: ${player.steamid}`" :aria-label="`玩家编号 ${radarNumber || '未知'}`">
        <div class="player-id-label">ID</div>
        <div class="player-id-number">{{ radarNumber || '—' }}</div>
        <div v-if="killStars.length" class="player-kill-stars" :aria-label="`本回合击杀 ${roundStats.kills} 人`">{{ killStars.map(() => '★').join('') }}</div>
      </div>
      <div class="player-vitals">
        <div class="player-health" :aria-label="dead ? '阵亡' : `血量 ${health ?? '未知'}`">{{ dead ? '×' : health ?? '—' }}</div>
        <div class="player-health-unit">{{ dead ? '阵亡' : 'HP' }}</div>
      </div>
    </div>
    <div class="player-loadout">
      <div class="player-weapon" :title="player.weapon || '未持枪'">
        <img v-if="weaponIcon" :class="{ mirrored: mirrorWeapon }" :src="weaponIcon" :alt="player.weapon">
        <div v-else>{{ player.weapon || '未持枪' }}</div>
      </div>
      <div class="player-money">{{ player.money != null ? `$${Number(player.money).toLocaleString()}` : '$—' }}</div>
      <div class="player-armor" :title="`护甲 ${player.armor ?? '未知'}`"><img :src="assetUrl('/weapons-flat/armor.svg')" alt="护甲">{{ player.armor ?? '—' }}</div>
    </div>
    <div class="player-equipment" aria-label="携带道具">
      <div v-for="item in equipmentSlots" :key="item" class="player-equipment-slot">
        <img v-if="equipment.includes(item)" :src="assetUrl(`/weapons-flat/${item}.svg`)" :alt="equipmentNames[item]" :title="equipmentNames[item]">
      </div>
    </div>
    <div class="player-health-track" :aria-label="`血量 ${health ?? '未知'}`"><div class="player-health-fill" :style="{ width: `${dead ? 0 : health ?? 0}%` }"></div></div>
  </article>
</template>

<style scoped>
.replay-player-card { display:grid; grid-template-rows:20px minmax(40px,1fr) 23px 18px 3px; gap:3px; min-width:0; min-height:112px; padding:7px 7px 7px 10px; margin:3px 0; box-sizing:border-box; position:relative; border:1px solid var(--theme-border-31454e); border-left:3px solid var(--player-color); background:linear-gradient(115deg,color-mix(in srgb,var(--player-color) 13%,var(--theme-bg-0c151d)),var(--theme-bg-0b151b) 72%); font-size:11px; line-height:1.2; }
.replay-player-card { cursor:pointer; transition:border-color .15s,box-shadow .15s; }
.replay-player-card:hover:not(.selected) { border-top-color:var(--theme-border-78868a); border-right-color:var(--theme-border-78868a); border-bottom-color:var(--theme-border-78868a); }
.replay-player-card.selected { border-top-color:var(--color-brand,var(--theme-border-c6ca4c)); border-right-color:var(--color-brand,var(--theme-border-c6ca4c)); border-bottom-color:var(--color-brand,var(--theme-border-c6ca4c)); box-shadow:inset 0 0 0 1px var(--color-brand,var(--theme-shadow-c6ca4c)); }
.replay-player-card:focus-visible { outline:2px solid var(--theme-border-eef3ef); outline-offset:-5px; }
.replay-player-card.dead { opacity:.46; }
.replay-player-card.dead.selected { opacity:1; }
.replay-player-card.dead.selected > :not(.player-identity) { opacity:.46; }
.replay-player-card.dead.selected .player-name,.replay-player-card.dead.selected .player-state { opacity:.6; }
.player-identity { display:grid; grid-template-columns:minmax(0,1fr) 24px 22px; gap:4px; align-items:center; min-width:0; }
.player-selection-label { visibility:hidden; color:var(--color-brand,var(--theme-text-c6ca4c)); font-size:8px; font-weight:700; text-align:center; letter-spacing:0; }
.selected .player-selection-label { visibility:visible; }
.player-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:800; color:var(--theme-text-eef3ef); }
.player-state { font-size:8px; color:var(--theme-text-a6b6ba); }
.player-broadcast { display:grid; grid-template-columns:minmax(0,1fr) 29px 32px; align-items:center; gap:5px; min-width:0; min-height:0; overflow:hidden; }
.player-score { min-width:0; overflow:hidden; font-variant-numeric:tabular-nums; }
.player-kd { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:4px; min-width:0; width:100%; font-size:11px; font-weight:800; color:var(--theme-text-e8f1f3); white-space:nowrap; overflow:hidden; }
.player-kd>div { display:flex; align-items:center; gap:2px; min-width:0; }
.player-kd img { width:13px; height:14px; object-fit:contain; opacity:.8; }
.player-stat-label { color:var(--theme-text-aac3d1); font-size:10px; }
.player-assists { color:var(--theme-text-8fa5ae); font-size:9px; margin-top:3px; }
.player-money { color:var(--theme-text-c5dcaa); font:800 10px 'Barlow Condensed',Inter,sans-serif; white-space:nowrap; letter-spacing:-.3px; }
.round-kill-line { display:flex; align-items:center; gap:4px; height:12px; color:var(--theme-text-9fb3bb); font-size:8px; white-space:nowrap; overflow:hidden; }
.round-kill-line b { color:var(--theme-text-eef3ef); font-size:11px; }
.round-kill-line i { color:var(--theme-text-d2dc9a); font-style:normal; overflow:hidden; text-overflow:ellipsis; }
.player-id-portrait { height:38px; display:grid; grid-template-rows:7px 20px 9px; text-align:center; border:1px solid color-mix(in srgb,var(--player-color) 65%,var(--theme-border-e2e8e0)); background:linear-gradient(145deg,var(--theme-bg-26353e),var(--theme-bg-0c151a)); box-sizing:border-box; border-radius:2px; }
.player-id-label { font-size:5px; letter-spacing:0; color:var(--theme-text-a9bbc2); padding-top:1px; }
.player-id-number { color:var(--player-color); font:800 22px/.95 'Barlow Condensed',Inter,sans-serif; }
.player-kill-stars { color:var(--theme-text-f1c84b); font-size:7px; line-height:1; letter-spacing:-1px; white-space:nowrap; overflow:hidden; }
.player-vitals { text-align:right; font-variant-numeric:tabular-nums; }
.player-health { color:var(--theme-text-f0f5f2); font:800 28px/1 'Barlow Condensed',Inter,sans-serif; letter-spacing:-1.5px; }
.player-health-unit { font-size:8px; color:var(--theme-text-9cafb8); margin-top:2px; }
.player-loadout { display:flex; align-items:center; justify-content:space-between; gap:5px; min-width:0; }
.player-weapon { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:9px; color:var(--theme-text-d9e5e9); }
.player-weapon img { display:block; width:76px; max-width:100%; height:23px; object-fit:contain; object-position:left center; filter:brightness(0) invert(1); opacity:.95; }
.player-weapon img.mirrored { transform:scaleX(-1); transform-origin:center; }
.player-armor { display:flex; align-items:center; gap:3px; font-size:10px; color:var(--theme-text-a9c8d7); }
.player-armor img { width:12px; height:15px; object-fit:contain; opacity:.8; }
.player-equipment { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); align-items:center; border-top:1px solid var(--theme-border-354851); }
.player-equipment-slot { display:flex; justify-content:center; align-items:center; min-width:0; height:16px; }
.player-equipment img { display:block; width:17px; max-width:100%; height:16px; object-fit:contain; filter:brightness(0) invert(1); opacity:.85; }
.player-health-track { height:3px; background:var(--theme-bg-28373e); overflow:hidden; }
.player-health-fill { height:100%; background:var(--player-color); }
@media(max-width:950px) {
  .player-broadcast { grid-template-columns:minmax(0,1fr) 25px 24px; gap:1px; }
  .player-kd { gap:1px; font-size:10px; }
  .player-kd>div { min-width:0; overflow:hidden; }
  .player-kd img { width:10px; flex:0 0 10px; }
  .player-kd>div:nth-child(2) img { display:none; }
  .player-id-number { font-size:22px; }
  .player-health { font-size:22px; }
}
</style>

