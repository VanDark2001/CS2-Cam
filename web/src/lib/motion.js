// 全站动效入口：统一滚动入场时机，并为无 IntersectionObserver 的桌面环境提供降级。
const REVEAL_SELECTORS = [
  '[data-motion="reveal"]',
  '.portal-page > *',
  '.favorites-page > *',
  '.settings-page > *'
].join(',')

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function observeScrollMotion(root) {
  if (typeof document === 'undefined' || !root) return () => {}
  document.documentElement.classList.add('motion-ready')
  const reduced = prefersReducedMotion() || typeof IntersectionObserver === 'undefined'
  const observed = new WeakSet()
  const observer = reduced ? null : new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('is-visible')
      observer.unobserve(entry.target)
    })
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })

  // Lazy route chunks can mount after AppLayout's first onMounted tick. Keep
  // watching the shell so those nodes are registered instead of remaining at
  // the hidden pre-entry state forever.
  const collect = () => {
    const nodes = [...root.querySelectorAll(REVEAL_SELECTORS)]
    nodes.forEach((node, index) => {
      if (observed.has(node)) return
      observed.add(node)
      node.dataset.motion = 'reveal'
      node.style.setProperty('--motion-delay', `${Math.min(index * 45, 240)}ms`)
      if (reduced) node.classList.add('is-visible')
      else observer.observe(node)
    })
  }
  const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(collect)
  mutations?.observe(root, { childList: true, subtree: true })
  collect()
  return () => { mutations?.disconnect(); observer?.disconnect() }
}
