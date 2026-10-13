export function readPovFavorites(raw) {
  try {
    const value = JSON.parse(raw || '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

export function samePovFavorite(left, right) {
  if (Number(left?.matchId) !== Number(right?.matchId) || Number(left?.round) !== Number(right?.round)) return false
  const identities = item => [...new Set((Array.isArray(item?.players) ? item.players : []).map(player => String(player?.steamid || '')).filter(Boolean))].sort()
  const a = identities(left), b = identities(right)
  return a.length > 0 && a.length === b.length && a.every((steamid, index) => steamid === b[index])
}

export function addPovFavorite(favorites, item) {
  // Preserve the existing entry's ID, notes and original metadata on repeat saves.
  return favorites.some(existing => samePovFavorite(existing, item)) ? favorites : [item, ...favorites].slice(0, 100)
}
