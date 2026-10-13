export function matchTime(date, source) {
  if (!date) return '时间未知'
  const text = String(date).replace('T', ' ')
  const match = text.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/)
  if (!match) return '时间未知'
  return `${match[1]} ${match[2]}${!source || source === 'imported_at' ? ' · 导入时间' : ''}`
}

export function fileLabel(path) {
  return String(path || '').split(/[\\/]/).pop() || ''
}
