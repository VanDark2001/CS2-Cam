import { radarPoint } from './replayRadar.js'
import { drawGameIcon } from './gameIcons.js'

export const effectData = event => {
  try { return typeof event.data === 'string' ? JSON.parse(event.data) : event.data || {} } catch { return {} }
}
const entityId = data => data.entity_id ?? data.entityid ?? data.grenade_entity_id
// Demo parser versions have emitted both `user_X` and `user_x` (and a few
// builds used `position_x`). Keep the visual event contract independent of
// that spelling so an otherwise valid bomb event still gets a fixed map
// position instead of silently becoming a HUD-only timer.
const field = (data, ...names) => {
  for (const name of names) {
    if (data?.[name] != null) return data[name]
    const key = Object.keys(data || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase())
    if (key && data[key] != null) return data[key]
  }
  return null
}
export function grenadeKind(value) {
  const name = String(value).toLowerCase()
  if (name.includes('smoke')) return 'smoke'
  if (name.includes('flash')) return 'flash'
  if (name.includes('molotov') || name.includes('inc') || name.includes('inferno')) return 'fire'
  if (name.includes('decoy')) return 'decoy'
  if (name.includes('bomb') || name.includes('c4')) return 'bomb'
  return 'he'
}
export const BOMB_FUSE_SECONDS = 40
const starts = {
  smokegrenade_detonate: ['smoke', 18], inferno_startburn: ['fire', 7],
  flashbang_detonate: ['flash', .5], hegrenade_detonate: ['he', .5], decoy_started: ['decoy', 15], bomb_planted: ['bomb', BOMB_FUSE_SECONDS],
}
const stops = { smokegrenade_expired: 'smoke', inferno_expire: 'fire', decoy_detonate: 'decoy', bomb_defused: 'bomb', bomb_exploded: 'bomb' }
const colors = { smoke: '#cedbd7', flash: '#fff3a5', fire: '#ffa34c', he: '#d2d694', decoy: '#b9c9e4', bomb: '#ff7863' }

// Keep the HUD and Canvas timer on the exact same tick/rounding path.  The
// Canvas can otherwise render a second value from a duplicate or stale zone
// while the Vue HUD has already selected the current bomb.
export function activeEffectZone(effects, tick, kind = null) {
  const now = Number(tick)
  const active = (effects?.zones || []).filter(zone =>
    (!kind || zone.kind === kind) &&
    Number(zone.start) <= now && now < Number(zone.end) &&
    (zone.stop == null || now < Number(zone.stop))
  )
  // Prefer a coordinate-bearing duplicate so the HUD-selected zone is also
  // drawable on the map. Coordinate-less C4 is still retained for timing.
  return active.find(zone => Number.isFinite(Number(zone.x)) && Number.isFinite(Number(zone.y))) || active[0] || null
}

export function effectRemainingSeconds(zone, tick, tickRate = 64) {
  const rate = Number(tickRate) > 0 ? Number(tickRate) : 64
  return zone ? Math.max(0, (Number(zone.end) - Number(tick)) / rate) : null
}

export function formatEffectRemaining(zone, tick, tickRate = 64) {
  const remaining = effectRemainingSeconds(zone, tick, tickRate)
  if (remaining == null) return ''
  return remaining < 10 ? remaining.toFixed(1) : String(Math.ceil(remaining))
}

export function prepareReplayEffects(events, tickRate = 64) {
  const parsed = events.map(event => ({ ...event, tick: Number(event.tick), payload: effectData(event) }))
  const zones = [], paths = [], shots = []
  for (const event of parsed) {
    const data = event.payload
    if (starts[event.type]) {
      const [kind, duration] = starts[event.type]
      const x = field(data, 'x', 'position_x', 'user_X')
      const y = field(data, 'y', 'position_y', 'user_Y')
      const z = field(data, 'z', 'position_z', 'user_Z')
      // C4 plant events in older demos often omit the plant coordinates. Keep
      // the timer zone so a replay response enriched by the service can still
      // render the fixed plant location once its coordinates are available.
      if ((x == null || y == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) && kind !== 'bomb') continue
      const end = parsed.find(next => next.tick >= event.tick && stops[next.type] === kind && (kind === 'bomb' || (entityId(data) != null && String(entityId(next.payload)) === String(entityId(data)))))
      const fuseEnd = event.tick + duration * tickRate
      const stop = end?.tick ?? null
      zones.push({
        kind, x, y, z, site: data.site,
        steamid: String(event.steamid || data.user_steamid || ''),
        start: event.tick,
        // C4 always counts down from the full fuse. `stop` only controls when
        // a defused bomb disappears from the map.
        end: kind === 'bomb' ? fuseEnd : Math.min(fuseEnd, stop ?? Infinity),
        stop,
        duration: duration * tickRate,
      })
    }
    if (event.type === 'grenade_trajectory' && Array.isArray(data.points) && data.points.length > 1) {
      const points = data.points.filter(p => Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(n => n != null && Number.isFinite(Number(n))))
      if (points.length < 2) continue
      const kind = grenadeKind(data.grenade_type)
      const detonation = parsed.find(next => next.tick >= points[0][0] && starts[next.type]?.[0] === kind && entityId(data) != null && String(entityId(next.payload)) === String(entityId(data)))
      paths.push({ points, kind, icon: /incendiary|incgrenade/i.test(data.grenade_type) ? 'incgrenade' : gameGrenades[kind], steamid: String(data.steamid || event.steamid || ''), start: Number(points[0][0]), end: Math.min(Number(points.at(-1)[0]), detonation?.tick ?? Infinity) })
    }
    if (event.type === 'weapon_fire') {
      const weapon = String(data.weapon || '').toLowerCase()
      if (!weapon || /knife|bayonet|grenade|flashbang|molotov|decoy|c4/.test(weapon)) continue
      shots.push({ tick: event.tick, steamid: String(event.steamid || data.user_steamid || ''), x: data.user_X ?? data.x, y: data.user_Y ?? data.y, z: data.user_Z ?? data.z, yaw: data.user_yaw ?? data.yaw })
    }
  }
  const ready = parsed.find(e => e.type === 'replay_effects_ready')?.payload.features || []
  return { zones, paths, shots, hasTrajectories: ready.includes('grenade_trajectory') || paths.length > 0, hasShots: ready.includes('weapon_fire') || shots.length > 0 }
}

// Return only the portion of a real projectile path reached at the replay tick.
export function trajectoryAt(path, tick, tickRate = 64) {
  if (tick < path.start || tick > path.end + tickRate * .5) return null
  const now = Math.min(tick, path.end), points = path.points
  let lo = 0, hi = points.length - 1
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (points[mid][0] <= now) lo = mid; else hi = mid - 1 }
  const a = points[lo], b = points[Math.min(lo + 1, points.length - 1)]
  const fraction = b[0] > a[0] ? Math.max(0, Math.min(1, (now - a[0]) / (b[0] - a[0]))) : 0
  const head = [now, a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction]
  const tail = points.filter(p => p[0] <= now && p[0] >= now - tickRate * 1.5)
  return { head, tail: [...tail, head], flying: tick < path.end, opacity: tick <= path.end ? 1 : Math.max(0, 1 - (tick - path.end) / (tickRate * .5)) }
}

const gameGrenades = { smoke: 'smokegrenade', flash: 'flashbang', fire: 'molotov', he: 'hegrenade', decoy: 'decoy', bomb: 'c4' }
export function drawGrenade(ctx, kind, x, y, size = 16, angle = 0, icon = null) {
  drawGameIcon(ctx, icon || gameGrenades[kind], x, y, size, angle)
}

function drawTimerBadge(ctx, zone, tick, point, tickRate) {
  const remaining = effectRemainingSeconds(zone, tick, tickRate), r = zone.kind === 'bomb' ? 12 : 10
  ctx.save(); ctx.translate(point.x, point.y)
  ctx.shadowColor = '#000b'; ctx.shadowBlur = 2
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = '#111e21df'; ctx.fill(); ctx.shadowBlur = 0
  ctx.strokeStyle = '#6b79766b'; ctx.lineWidth = 1.2; ctx.stroke()
  ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, (zone.end - tick) / zone.duration)); ctx.strokeStyle = colors[zone.kind]; ctx.stroke()
  drawGrenade(ctx, zone.kind, 0, -3, zone.kind === 'bomb' ? 13 : 11)
  ctx.fillStyle = '#f8f4e3'; ctx.font = '800 7px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(formatEffectRemaining(zone, tick, tickRate), 0, r - 5)
  ctx.restore()
}

export function drawEffectAreas(ctx, effects, tick, meta, width, height, tickRate = 64) {
  ctx.save()
  for (const zone of effects.zones) {
    if (tick < zone.start || tick >= zone.end || zone.kind === 'bomb') continue
    const point = radarPoint(zone.x, zone.y, meta, width, height); if (!point) continue
    const elapsed = (tick - zone.start) / tickRate, radius = Math.min(width, height) * .047
    const fade = Math.min(1, (zone.end - tick) / (tickRate * 2)), color = colors[zone.kind]
    const gradient = ctx.createRadialGradient(point.x, point.y, 0, point.x, point.y, radius)
    gradient.addColorStop(0, `${color}80`); gradient.addColorStop(1, `${color}08`)
    ctx.globalAlpha = fade; ctx.fillStyle = gradient; ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = `${color}66`; ctx.lineWidth = 1; ctx.setLineDash(zone.kind === 'fire' ? [3, 4] : [])
    ctx.beginPath(); ctx.arc(point.x, point.y, radius * (zone.kind === 'flash' || zone.kind === 'he' ? .6 + elapsed * 1.5 : 1), 0, Math.PI * 2); ctx.stroke()
  }
  ctx.restore()
}

export function drawEffectIcons(ctx, effects, tick, meta, width, height, tickRate = 64, fallbackPoint = null) {
  const scale = Math.max(.5, Math.min(1, Math.min(width, height) / 700))
  const activeBomb = activeEffectZone(effects, tick, 'bomb')
  for (const zone of effects.zones) {
    if (tick < zone.start || tick >= zone.end || (zone.stop != null && tick >= zone.stop)) continue
    // There can be duplicate bomb_planted rows in older parsed demos. Draw
    // exactly the same active zone the HUD uses, so the two timers cannot
    // diverge or overlap.
    if (zone.kind === 'bomb' && zone !== activeBomb) continue
    const point = radarPoint(zone.x, zone.y, meta, width, height) || (fallbackPoint ? fallbackPoint(zone) : null)
    if (!point || point.x < 0 || point.x > width || point.y < 0 || point.y > height) continue
    // Keep the badge fully inside the radar when a plant is close to its edge.
    const badgePoint = {
      x: Math.max(14, Math.min(width - 14, point.x)),
      y: Math.max(14, Math.min(height - 14, point.y))
    }
    ctx.save(); ctx.scale(scale, scale); drawTimerBadge(ctx, zone, tick, { x: badgePoint.x / scale, y: badgePoint.y / scale }, tickRate); ctx.restore()
  }
}

export function drawTrajectories(ctx, effects, tick, meta, width, height, colorFor, tickRate = 64) {
  for (const path of effects.paths) {
    const current = trajectoryAt(path, tick, tickRate); if (!current) continue
    const head = radarPoint(current.head[1], current.head[2], meta, width, height); if (!head) continue
    ctx.save(); ctx.globalAlpha = current.opacity; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = colorFor(path.steamid); ctx.lineWidth = 1.4
    const points = current.tail.map(p => radarPoint(p[1], p[2], meta, width, height)).filter(Boolean)
    // Older tail segments fade, while the head follows the recorded bounce path.
    for (let i = 1; i < points.length; i++) { ctx.globalAlpha = current.opacity * (.12 + .7 * i / points.length); ctx.beginPath(); ctx.moveTo(points[i - 1].x, points[i - 1].y); ctx.lineTo(points[i].x, points[i].y); ctx.stroke() }
    ctx.globalAlpha = current.opacity
    if (current.flying) {
      const previous = points.at(-2) || head
      drawGrenade(ctx, path.kind, head.x, head.y, Math.max(6, Math.min(9, Math.min(width, height) * .013)), Math.atan2(head.y - previous.y, head.x - previous.x) + Math.PI / 2, path.icon)
    }
    ctx.restore()
  }
}

export function drawGunfire(ctx, effects, tick, meta, width, height, markers, tickRate = 64) {
  for (const shot of effects.shots) {
    const age = (tick - shot.tick) / tickRate
    if (age < 0 || age > .18) continue
    const player = markers.find(p => String(p.player.steamid) === shot.steamid)
    const point = radarPoint(shot.x, shot.y, meta, width, height) || player
    const yaw = Number(shot.yaw ?? player?.yaw)
    if (!point || !Number.isFinite(yaw)) continue
    ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(-yaw * Math.PI / 180); ctx.globalAlpha = (1 - age / .18) * .95
    ctx.strokeStyle = '#fff0a2'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(27 + age * 45, 0); ctx.stroke()
    ctx.translate(16, 0); ctx.scale(.7, .7); ctx.fillStyle = '#ffcf67'; ctx.shadowColor = '#ffc45c'; ctx.shadowBlur = 8
    ctx.beginPath(); ctx.moveTo(-4, 0); ctx.lineTo(3, -4); ctx.lineTo(1, -9); ctx.lineTo(8, -3); ctx.lineTo(14, 0); ctx.lineTo(8, 3); ctx.lineTo(1, 9); ctx.lineTo(3, 4); ctx.closePath(); ctx.fill(); ctx.restore()
  }
}
