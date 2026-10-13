import { computed, ref } from 'vue'

export const THEME_KEY = 'cs2-cam-appearance'
export function resolveTheme(mode, date = new Date()) {
  return mode === 'auto' ? (date.getHours() >= 7 && date.getHours() < 19 ? 'light' : 'dark') : mode === 'light' ? 'light' : 'dark'
}
const valid = value => ['light', 'dark', 'auto'].includes(value)
function readPreference() {
  try { const value = localStorage.getItem(THEME_KEY); return valid(value) ? value : 'dark' } catch { return 'dark' }
}
export const themeMode = ref(readPreference())
export const activeTheme = ref(resolveTheme(themeMode.value))
export const themeStorageError = ref('')
export const themeDescription = computed(() => themeMode.value === 'auto' ? `自动 · 当前${activeTheme.value === 'light' ? '浅色' : '深色'}` : activeTheme.value === 'light' ? '浅色模式' : '深色模式')
let applied = null
function apply() {
  activeTheme.value = resolveTheme(themeMode.value)
  if (applied === activeTheme.value) return
  applied = activeTheme.value
  document.documentElement.dataset.theme = activeTheme.value
  document.documentElement.style.colorScheme = activeTheme.value
  window.csdemoDesktop?.theme?.set(activeTheme.value).catch(() => {})
}
export function setThemeMode(value) {
  if (!valid(value)) return
  themeMode.value = value
  themeStorageError.value = ''
  try { localStorage.setItem(THEME_KEY, value) } catch { themeStorageError.value = '当前外观已切换，但无法保存；下次启动需重新选择。' }
  apply()
}
let stop = null
export function startThemeClock() {
  if (stop) return stop
  apply()
  const timer = window.setInterval(apply, 1000)
  const storage = event => { if (event.key === THEME_KEY) { themeMode.value = valid(event.newValue) ? event.newValue : 'dark'; apply() } }
  const visible = () => { if (!document.hidden) apply() }
  window.addEventListener('focus', apply)
  window.addEventListener('pageshow', apply)
  window.addEventListener('storage', storage)
  document.addEventListener('visibilitychange', visible)
  stop = () => { clearInterval(timer); window.removeEventListener('focus', apply); window.removeEventListener('pageshow', apply); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); stop = null; applied = null }
  return stop
}
