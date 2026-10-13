export function eventPreviewTick(tick, startTick, endTick, tickRate = 64, leadSeconds = 3) {
  const rate = Number(tickRate) > 0 ? Number(tickRate) : 64
  return Math.max(Number(startTick), Math.min(Number(endTick), Number(tick) - leadSeconds * rate))
}

export function playerTimelineMarkers(markers, events, steamid, startTick, endTick) {
  if (!steamid) return markers
  const sid = String(steamid), start = Number(startTick), end = Number(endTick)
  const result = markers.filter(marker => String(marker.steamid || '') === sid)
  if (!(end > start)) return result
  for (const [index, event] of events.entries()) {
    if (event.type !== 'player_death') continue
    let data = {}; try { data = typeof event.data === 'string' ? JSON.parse(event.data) : (event.data || {}) } catch { continue }
    const tick = Number(event.tick)
    if (!Number.isFinite(tick) || tick < start || tick > end) continue
    const death = String(data.user_steamid || '') === sid
    const kill = !death && String(data.attacker_steamid || '') === sid
    if (!death && !kill) continue
    const kind = death ? 'death' : 'kill'
    result.push({ key: `${kind}-${tick}-${index}`, tick, steamid: sid, kind, lane: death ? 'below' : 'above', team: kind,
      symbol: death ? 'skull' : 'crosshair', percent: (tick - start) / (end - start) * 100,
      label: death ? `死亡 · ${data.attacker_name || '未知玩家'}` : `击杀 · ${data.user_name || '未知玩家'}`,
      thrower: death ? (data.user_name || '') : (data.attacker_name || '') })
  }
  return result.sort((a, b) => a.tick - b.tick)
}
