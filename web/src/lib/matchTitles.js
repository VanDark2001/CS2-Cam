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
  return titles?.[String(match?.id)]?.trim() || fallback
}
