const STORAGE_KEY = 'cs2-match-titles'

export function readMatchTitles(raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)) {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

export function writeMatchTitles(titles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(titles))
  window.dispatchEvent(new CustomEvent('cs2-match-titles-changed'))
}

export function matchTitle(match, titles, fallback) {
  const names = match?.teamNames
  const team3 = typeof names?.['3'] === 'string' ? names['3'].trim() : ''
  const team2 = typeof names?.['2'] === 'string' ? names['2'].trim() : ''
  return titles?.[String(match?.id)]?.trim() || (team3 && team2 ? `${team3} VS ${team2}` : '') || fallback
}
