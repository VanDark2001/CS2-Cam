const formatClock = seconds => {
  const total = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function replayFreezeEnd(replay) {
  const start = Number(replay.startTick)
  const end = Number(replay.roundEndTick ?? replay.endTick)
  const valid = tick => tick != null && Number.isFinite(Number(tick)) && Number(tick) >= start && Number(tick) <= end
  const events = (replay.events || []).filter(event => event.type === 'round_freeze_end' && valid(event.tick))
  if (events.length) return Math.min(...events.map(event => Number(event.tick)))
  return valid(replay.freezeEndTick) ? Number(replay.freezeEndTick) : null
}

export function replayCountdown(replay, { finalRound = false, bomb = false, bombRemaining = null, bombDefused = false, loading = false } = {}) {
  if (loading) return { text: '加载中', bomb: false }
  const now = Number(replay.globalTick)
  if (replay.endTick && now >= Number(replay.endTick)) return { text: finalRound ? '比赛结束' : '回合结束', bomb: false }
  if (bombDefused) return { text: '炸弹已拆除', bomb: false, defused: true }
  if (bomb) return { text: bombRemaining != null && Number.isFinite(Number(bombRemaining)) ? `爆炸 ${formatClock(bombRemaining)}` : '炸弹已安放', bomb: true }
  const freezeEnd = replayFreezeEnd(replay)
  if (freezeEnd == null) return { text: '回合进行中', bomb: false }
  const tickRate = Number(replay.tickRate) > 0 ? Number(replay.tickRate) : 64
  if (now < freezeEnd) return { text: `购买 ${formatClock((freezeEnd - now) / tickRate)}`, bomb: false }
  return { text: `回合 ${formatClock(Math.max(0, 115 - (now - freezeEnd) / tickRate))}`, bomb: false }
}
