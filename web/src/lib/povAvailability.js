export function readyPovPlayers(jobs, round) {
  const ready = new Set()
  for (const job of jobs || []) {
    if (Number(job.round) !== Number(round) || job.status !== 'completed') continue
    for (const file of job.files || []) {
      const index = String(file.name || '').match(/^player_(\d+)$/)?.[1]
      const player = index != null ? job.players?.[Number(index)] : job.players?.length === 1 ? job.players[0] : null
      if (file.url && player?.steamid) ready.add(String(player.steamid))
    }
  }
  return ready
}

export function favoritePovStatus(item, jobs) {
  const ready = readyPovPlayers(jobs, item.round)
  const players = [...new Map((item.players || []).map(player => [String(player.steamid), player])).values()]
  const missing = players.filter(player => !ready.has(String(player.steamid)))
  return { total: players.length, completed: players.length - missing.length, missing }
}
