// Cache only the current round. Keep Blob URLs stable while views are promoted.
export function createPovMediaCache({ fetcher = fetch, createUrl = blob => URL.createObjectURL(blob), revokeUrl = url => URL.revokeObjectURL(url), onChange = () => {}, concurrency = 2 } = {}) {
  const entries = new Map()
  let disposed = false, active = 0
  const publish = () => { if (!disposed) onChange(Object.fromEntries([...entries].map(([source, entry]) => [source, { status: entry.status, url: entry.url || '', error: entry.error || '' }]))) }
  const pump = () => {
    if (disposed) return
    for (const [source, entry] of entries) {
      if (active >= concurrency) break
      if (entry.status !== 'queued') continue
      entry.status = 'loading'
      entry.controller = new AbortController()
      active++
      publish()
      Promise.resolve().then(async () => {
        const response = await fetcher(source, { signal: entry.controller.signal })
        if (response.status !== 200) throw new Error('无法完整读取视频，请重试')
        const blob = await response.blob()
        const expected = Number(response.headers.get('content-length'))
        if (!blob.size || (expected > 0 && blob.size !== expected)) throw new Error('视频读取不完整，请重试')
        if (disposed || entries.get(source) !== entry) return
        entry.url = createUrl(blob)
        entry.status = 'ready'
      }).catch(error => {
        if (!disposed && entries.get(source) === entry && error.name !== 'AbortError') { entry.status = 'error'; entry.error = error.message || '视频缓存失败，请重试' }
      }).finally(() => { active--; publish(); pump() })
    }
  }
  const remove = (source, entry) => { entries.delete(source); entry.controller?.abort(); if (entry.url) revokeUrl(entry.url) }
  return {
    setFiles(sources) {
      if (disposed) return
      const wanted = new Set(sources.filter(Boolean))
      for (const [source, entry] of entries) if (!wanted.has(source)) remove(source, entry)
      for (const source of wanted) if (!entries.has(source)) entries.set(source, { status: 'queued' })
      publish(); pump()
    },
    retry(source) { const entry = entries.get(source); if (entry?.status === 'error') { entry.status = 'queued'; entry.error = ''; publish(); pump() } },
    dispose() { disposed = true; for (const [source, entry] of entries) remove(source, entry) },
  }
}
