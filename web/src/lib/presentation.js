// 展示层工具：集中处理 API 基址、地图/武器名称、头像地址和比分颜色。
// Vite dev server keeps the relative proxy path.  The packaged Electron
// window is loaded from file://, so it must address the local Spring service
// directly instead of trying to resolve /api as a filesystem path.
export const API = (typeof window !== 'undefined' && window.csdemoDesktop?.apiBase) || import.meta.env.VITE_API_BASE_URL ||
  (typeof window !== 'undefined' && window.location.protocol === 'file:'
    ? 'http://127.0.0.1:8091/api'
    : '/api')
export const assetUrl = path => `${import.meta.env.BASE_URL}${String(path).replace(/^\//, '')}`

// 此处只负责显示名称；统计聚合和武器归一化必须在后端完成。
const mapNames = { de_inferno: '炼狱小镇', de_mirage: '荒漠迷城', de_ancient: '远古遗迹', de_dust2: '炙热沙城Ⅱ', de_nuke: '核子危机', de_anubis: '阿努比斯', de_vertigo: '殒命大厦', de_overpass: '死亡游乐园', de_train: '列车停放站', de_cache: '死城之谜' }
const weaponNames = {
  inferno: '燃烧弹', m4a1silencer: 'm4a1s', m4a1slencer: 'm4a1s',
  m4a1_silencer: 'm4a1s', m4a1_silencer_vip: 'm4a1s', fiveseven: 'fn57',
  hegrenade: '手雷', flashbang: '闪光弹', smokegrenade: '烟雾弹',
  incgrenade: '燃烧弹', molotov: '燃烧弹', knife: '刀具', knife_t: '刀具',
  knife_skeleton: '骷髅匕首', knife_butterfly: '蝴蝶刀', knife_karambit: '爪子刀',
}

// Demo tools can decorate the weapon id (for example
// `5E_2024PASS5_AK47`). The suffix after the pass marker is the real CS2
// weapon id, so normalize it once before displaying it or resolving an icon.
const weaponAssets = new Set([
  'ak47', 'aug', 'awp', 'bizon', 'cz75a', 'deagle', 'elite', 'famas', 'fiveseven',
  'g3sg1', 'galilar', 'glock', 'hkp2000', 'm249', 'm4a1', 'm4a1_silencer', 'mac10',
  'mag7', 'mp5sd', 'mp7', 'mp9', 'negev', 'nova', 'p2000', 'p250', 'p90', 'revolver',
  'sawedoff', 'scar20', 'sg556', 'ssg08', 'taser', 'tec9', 'ump45', 'usp_silencer',
  'xm1014', 'hegrenade', 'flashbang', 'smokegrenade', 'incgrenade', 'molotov', 'inferno',
  'c4', 'defuser', 'knife', 'knife_t', 'bayonet', 'knifegg', 'melee',
  'knife_bowie', 'knife_butterfly', 'knife_canis', 'knife_cord', 'knife_css',
  'knife_falchion', 'knife_flip', 'knife_gut', 'knife_gypsy_jackknife',
  'knife_karambit', 'knife_kukri', 'knife_m9_bayonet', 'knife_outdoor',
  'knife_push', 'knife_skeleton', 'knife_stiletto', 'knife_survival_bowie',
  'knife_tactical', 'knife_twinblade', 'knife_ursus', 'knife_widowmaker',
  'm4a1_silencer_off', 'usp_silencer_off',
])

const aliases = {
  'tec-9': 'tec9', 'tec 9': 'tec9', 'ak-47': 'ak47', 'm4a4': 'm4a1', 'mac-10': 'mac10',
  'mac 10': 'mac10', 'c4 explosive': 'c4', 'm4a1-s': 'm4a1_silencer', m4a1s: 'm4a1_silencer',
  'glock-18': 'glock', glock18: 'glock', 'usp-s': 'usp_silencer', usp: 'usp_silencer',
  'five-seven': 'fiveseven', 'five seven': 'fiveseven', fivese: 'fiveseven',
  'galil ar': 'galilar', galil: 'galilar', 'desert eagle': 'deagle', deserteagle: 'deagle',
  'r8 revolver': 'revolver', 'p2000': 'hkp2000', 'ssg 08': 'ssg08', 'sg 553': 'sg556',
  'ak_47': 'ak47', 'glock_18': 'glock', 'usp_s': 'usp_silencer',
  'he grenade': 'hegrenade', 'high explosive grenade': 'hegrenade', 'high-explosive grenade': 'hegrenade',
  'smoke grenade': 'smokegrenade', 'incendiary grenade': 'incgrenade', incendiary: 'incgrenade',
  'molotov cocktail': 'molotov', firebomb: 'molotov', 'flip knife': 'knife_flip',
  'butterfly knife': 'knife_butterfly', 'kukri knife': 'knife_kukri', 'stiletto knife': 'knife_stiletto',
  'skeleton knife': 'knife_skeleton', 'knife skeleton': 'knife_skeleton',
  'falchion knife': 'knife_falchion', 'bowie knife': 'knife_survival_bowie',
  'huntsman knife': 'knife_tactical', 'gut knife': 'knife_gut', 'shadow daggers': 'knife_push',
  'survival knife': 'knife_canis', 'paracord knife': 'knife_cord', 'nomad knife': 'knife_outdoor',
  'ursus knife': 'knife_ursus', 'classic knife': 'knife_css', 'zeus x27': 'taser',
  karambit: 'knife_karambit', 'm9 bayonet': 'knife_m9_bayonet',
}

export const weaponKey = weapon => {
  let value = String(weapon ?? '').trim().toLowerCase().replace(/^weapon[_-]/, '')
  // Covers 5E_2024PASS5_AK47 as well as future 5E_2024PASS*_AK47 variants.
  value = value.replace(/^5e[_-]2024pass\d*[_-]/, '')
  value = value.replace(/^5e[_-]/, '')
  value = value.replace(/^(?:default|plus1|weapon)[_-]/, '')
  value = value.replace(/_(?:txz\d+|vip|default|plus1|silencer)$/, '')
  value = value.replace(/^(?:default|plus1)(?=[a-z0-9])/, '')
  value = value.replace(/\s+/g, ' ').replace(/-/g, '_')
  value = aliases[value] || aliases[value.replace(/_/g, ' ')] || value
  if (value === 'm4a1_s') value = 'm4a1_silencer'
  if (value.startsWith('awp')) value = 'awp'
  if (value.startsWith('galil')) value = 'galilar'
  if (value.startsWith('hkp20')) value = 'hkp2000'
  if (value === 'knife_t' || value === 'knife_ct') return 'knife_t'
  return value
}

export const weaponAsset = weapon => {
  const key = weaponKey(weapon)
  return weaponAssets.has(key) ? assetUrl(`/weapons-flat/${key}.svg`) : ''
}

export const mapName = map => mapNames[map] || map?.replace('de_', '') || '未知地图'
export const weaponName = weapon => {
  const key = weaponKey(weapon)
  return weaponNames[key] || (key ? key.toUpperCase() : 'unknown')
}
export const avatarUrl = (steamid, cacheKey = '') => `${API}/avatars/${steamid}${cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : ''}`
export const hideBrokenAvatar = event => { event.target.style.display = 'none' }
export const scoreValues = score => (String(score || '').match(/\d+/g) || []).map(Number)
// 常规赛或加时均以最终较高分的一侧显示胜方颜色；平局保持中性色。
export const scoreTone = (score, index) => {
  const values = scoreValues(score)
  if (values.length !== 2) return ''
  if (values[0] === values[1]) return ''
  return values[index] === Math.max(...values) ? 'score-win' : 'score-loss'
}
