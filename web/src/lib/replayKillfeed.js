// Resolve assist identity from the event SteamID, independently of nicknames.
export function killfeedAssisterColor(data, event, players, team2Side) {
  const id = String(data.assister_steamid || data.assister_steamid64 || data.assister_xuid || data.assisterSteamid || data.assisterSteamId || event.assister_steamid || '').trim()
  if (!id || id === '0') return null
  const player = players.find(item => String(item.steamid) === id)
  const team = Number(player?.teamNumber), side = Number(team2Side)
  if (![2,3].includes(team) || ![2,3].includes(side)) return null
  const isT = team === 2 ? side === 2 : side === 3
  return isT ? '#f3bf4c' : '#4aa3ff'
}
