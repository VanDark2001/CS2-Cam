/**
 * Endfield HUD animation timeline.
 *
 * This module keeps the reference project's staged HUD motion in one place so
 * replay cards and other transient status surfaces can reuse the same timing.
 * It does not own data, markup, or page layout.
 */

export const HUD_ANIMATION_MODES = Object.freeze({
  FULL: 'full',
  SIMPLE: 'simple',
  COMPACT: 'compact',
})

export const HUD_ANIMATION_DURATION_MS = 6000

export const HUD_EASINGS = Object.freeze({
  linear: 'linear',
  smooth: 'cubic-bezier(.65,0,.35,1)',
  back: 'cubic-bezier(.175,.885,.32,1.275)',
})

export const HUD_PHASES = Object.freeze([
  { name: 'idle', start: 0, end: 0.07 },
  { name: 'expand', start: 0.07, end: 0.2 },
  { name: 'title', start: 0.2, end: 0.36 },
  { name: 'values', start: 0.36, end: 0.42 },
  { name: 'hold', start: 0.42, end: 0.86 },
  { name: 'close', start: 0.86, end: 1 },
])

const keyframe = (offset, properties, easing) => ({
  ...properties,
  offset,
  ...(easing ? { easing } : {}),
})

function getCompactHudKeyframes() {
  return {
    pill: [
      keyframe(0, { opacity: 1, left: '104px', width: '42px', transform: 'scale(.62) translateY(-2px)', borderRadius: '19px' }),
      keyframe(.08, { opacity: 1, left: '104px', width: '42px', transform: 'scale(.84) translateY(0)', borderRadius: '19px' }, HUD_EASINGS.back),
      keyframe(.28, { opacity: 1, left: '0', width: '250px', transform: 'scale(1.02) translateY(0)', borderRadius: '19px' }, HUD_EASINGS.back),
      keyframe(.5, { opacity: 1, left: '0', width: '250px', transform: 'scale(1) translateY(0)', borderRadius: '19px' }, HUD_EASINGS.smooth),
      keyframe(1, { opacity: 1, left: '0', width: '250px', transform: 'scale(1) translateY(0)', borderRadius: '19px' }),
    ],
    icon: [
      keyframe(0, { opacity: 0, transform: 'translateX(180px) scale(.4)' }),
      keyframe(.16, { opacity: 0, transform: 'translateX(180px) scale(.4)' }, HUD_EASINGS.back),
      keyframe(.34, { opacity: 1, transform: 'translateX(180px) scale(1.12)' }),
      keyframe(.5, { opacity: 1, transform: 'translateX(0) scale(1)' }, HUD_EASINGS.smooth),
      keyframe(1, { opacity: 1, transform: 'translateX(0) scale(1)' }),
    ],
    title: [
      keyframe(0, { opacity: 0, transform: 'translateY(3px)' }),
      keyframe(.44, { opacity: 0, transform: 'translateY(3px)' }),
      keyframe(.62, { opacity: 1, transform: 'translateY(0)' }, HUD_EASINGS.smooth),
      keyframe(1, { opacity: 1, transform: 'translateY(0)' }),
    ],
    values: [
      keyframe(0, { opacity: 0, transform: 'translateY(3px)' }),
      keyframe(.44, { opacity: 0, transform: 'translateY(3px)' }),
      keyframe(.62, { opacity: 1, transform: 'translateY(0)' }, HUD_EASINGS.smooth),
      keyframe(1, { opacity: 1, transform: 'translateY(0)' }),
    ],
    rippleHost: [
      keyframe(0, { transform: 'translateX(0)' }),
      keyframe(1, { transform: 'translateX(0)' }),
    ],
    ripple: [
      keyframe(0, { opacity: 0, transform: 'scale(.4)' }),
      keyframe(.2, { opacity: .22, transform: 'scale(.55)' }),
      keyframe(.58, { opacity: 0, transform: 'scale(1.1)' }),
      keyframe(1, { opacity: 0, transform: 'scale(1.1)' }),
    ],
  }
}

/**
 * The keyframes are normalized to a 0..1 cue so callers can change the total
 * duration without changing the visual rhythm.
 */
export function getHudKeyframes(mode = HUD_ANIMATION_MODES.FULL) {
  if (mode === HUD_ANIMATION_MODES.COMPACT) return getCompactHudKeyframes()
  const simple = mode === HUD_ANIMATION_MODES.SIMPLE

  const common = {
    pill: [
      keyframe(0, { opacity: 0, transform: 'scale(.6)', height: '60px', top: '20px', borderRadius: '30px' }, simple ? HUD_EASINGS.back : undefined),
      keyframe(simple ? 0.05 : 0.07, { opacity: simple ? 1 : 0, transform: simple ? 'scale(1)' : 'scale(.6)', height: '60px', top: '20px', borderRadius: '30px' }, HUD_EASINGS.back),
      ...(simple ? [] : [
        keyframe(0.09, { opacity: 1, transform: 'scale(1)', height: '60px', top: '20px' }, HUD_EASINGS.back),
        keyframe(0.12, { opacity: 1, height: '90px', top: '5px', borderRadius: '18px' }),
        keyframe(0.3, { height: '90px', top: '5px', borderRadius: '18px' }, HUD_EASINGS.smooth),
        keyframe(0.36, { height: '60px', top: '20px', borderRadius: '30px' }),
      ]),
      keyframe(simple ? 0.8 : 0.86, { opacity: 1, transform: 'scale(1)' }, HUD_EASINGS.smooth),
      keyframe(simple ? 0.86 : 0.89, { opacity: 0, transform: 'scale(0)' }),
      keyframe(1, { opacity: 0, transform: 'scale(0)' }),
    ],
    icon: simple
      ? [
          keyframe(0, { opacity: 0, transform: 'translateX(0) scale(.6)' }),
          keyframe(0.08, { opacity: 1, transform: 'translateX(0) scale(.65)' }),
          keyframe(0.8, { opacity: 1 }),
          keyframe(0.85, { opacity: 0 }),
          keyframe(1, { opacity: 0 }),
        ]
      : [
          keyframe(0, { opacity: 0, transform: 'translateX(245px) scale(.4)' }),
          keyframe(0.04, { opacity: 0, transform: 'translateX(245px) scale(.4)' }, HUD_EASINGS.back),
          keyframe(0.1, { opacity: 1, transform: 'translateX(245px) scale(1.12)' }),
          keyframe(0.12, { transform: 'translateX(245px) scale(1)' }, HUD_EASINGS.smooth),
          keyframe(0.2, { transform: 'translateX(66px) scale(1)' }),
          keyframe(0.3, { transform: 'translateX(66px) scale(1)' }, HUD_EASINGS.smooth),
          keyframe(0.36, { opacity: 1, transform: 'translateX(0) scale(.65)', borderRadius: '6px' }),
          keyframe(0.86, { opacity: 1, transform: 'translateX(0) scale(.65)' }),
          keyframe(0.89, { opacity: 0, transform: 'translateX(245px) scale(0)' }),
          keyframe(1, { opacity: 0 }),
        ],
    title: simple
      ? [keyframe(0, { opacity: 0 }), keyframe(1, { opacity: 0 })]
      : [
          keyframe(0, { opacity: 0, transform: 'translateY(5px)' }),
          keyframe(0.2, { opacity: 0, transform: 'translateY(5px)' }, HUD_EASINGS.smooth),
          keyframe(0.25, { opacity: 1, transform: 'translateY(0)' }),
          keyframe(0.3, { opacity: 1 }),
          keyframe(0.36, { opacity: 0, transform: 'translateY(-5px)' }),
          keyframe(1, { opacity: 0 }),
        ],
    values: simple
      ? [
          keyframe(0, { opacity: 0 }),
          keyframe(0.05, { opacity: 0 }),
          keyframe(0.09, { opacity: 1 }),
          keyframe(0.8, { opacity: 1 }),
          keyframe(0.85, { opacity: 0 }),
          keyframe(1, { opacity: 0 }),
        ]
      : [
          keyframe(0, { opacity: 0, transform: 'translateY(5px)' }),
          keyframe(0.38, { opacity: 0, transform: 'translateY(5px)' }),
          keyframe(0.42, { opacity: 1, transform: 'translateY(0)' }),
          keyframe(0.86, { opacity: 1 }),
          keyframe(0.885, { opacity: 0 }),
          keyframe(1, { opacity: 0 }),
        ],
  }

  if (simple) return common

  return {
    ...common,
    rippleHost: [
      keyframe(0, { transform: 'translateX(0)' }),
      keyframe(0.12, { transform: 'translateX(0)' }, HUD_EASINGS.smooth),
      keyframe(0.2, { transform: 'translateX(-179px)' }),
      keyframe(0.3, { transform: 'translateX(-179px)' }),
      keyframe(0.36, { transform: 'translateX(-245px)' }),
      keyframe(1, { transform: 'translateX(-245px)' }),
    ],
    ripple: [
      keyframe(0, { opacity: 0, transform: 'scale(0)' }),
      keyframe(0.12, { opacity: 0, transform: 'scale(0)' }),
      keyframe(0.14, { opacity: 0.25, transform: 'scale(.05)' }),
      keyframe(0.3, { opacity: 0.25, transform: 'scale(1)' }),
      keyframe(0.36, { opacity: 0, transform: 'scale(1)' }),
      keyframe(1, { opacity: 0 }),
    ],
  }
}

export function getHudPhase(elapsedMs, durationMs = HUD_ANIMATION_DURATION_MS, mode = HUD_ANIMATION_MODES.FULL, loop = false) {
  const duration = Math.max(1, Number(durationMs) || HUD_ANIMATION_DURATION_MS)
  const raw = Number(elapsedMs) || 0
  const progress = loop
    ? ((raw % duration) + duration) % duration / duration
    : Math.max(0, Math.min(duration, raw)) / duration
  if (mode === HUD_ANIMATION_MODES.COMPACT) return progress < 0.72 ? 'expand' : 'hold'
  if (mode === HUD_ANIMATION_MODES.SIMPLE) {
    if (progress < 0.08) return 'expand'
    if (progress < 0.8) return 'hold'
    return 'close'
  }
  return HUD_PHASES.find(phase => progress < phase.end)?.name || 'idle'
}

function createAnimation(node, frames, durationMs) {
  if (!node || typeof node.animate !== 'function') return null
  const animation = node.animate(frames, { duration: durationMs, fill: 'both', easing: HUD_EASINGS.linear })
  animation.pause()
  return animation
}

/**
 * Bind the timeline to a HUD root. The returned controller is deliberately
 * small so it can be owned by a Vue component or a plain DOM surface.
 */
export function createHudAnimationController(root, options = {}) {
  const mode = [HUD_ANIMATION_MODES.SIMPLE, HUD_ANIMATION_MODES.COMPACT].includes(options.mode) ? options.mode : HUD_ANIMATION_MODES.FULL
  const durationMs = Math.max(1, Number(options.durationMs) || HUD_ANIMATION_DURATION_MS)
  const loop = options.loop === true
  const frames = getHudKeyframes(mode)
  const animations = []
  const add = (selector, keyframes) => {
    const animation = createAnimation(root?.querySelector(selector), keyframes, durationMs)
    if (animation) animations.push(animation)
  }

  add('.hud-pill', frames.pill)
  add('.hud-icon', frames.icon)
  add('.hud-title', frames.title)
  add('.hud-values', frames.values)
  add('.ripples', frames.rippleHost)
  root?.querySelectorAll?.('.ripples i').forEach(node => {
    const animation = createAnimation(node, frames.ripple, durationMs)
    if (animation) animations.push(animation)
  })

  let elapsedMs = 0
  const render = timeMs => {
    const raw = Number(timeMs) || 0
    elapsedMs = loop ? ((raw % durationMs) + durationMs) % durationMs : Math.max(0, Math.min(durationMs, raw))
    animations.forEach(animation => { animation.currentTime = elapsedMs })
    return { elapsedMs, phase: getHudPhase(elapsedMs, durationMs, mode, loop) }
  }

  return {
    animations,
    durationMs,
    mode,
    get elapsedMs() { return elapsedMs },
    render,
    play() { animations.forEach(animation => animation.play()) },
    pause() { animations.forEach(animation => animation.pause()) },
    settle() { render(durationMs); animations.forEach(animation => animation.pause()) },
    replay() { animations.forEach(animation => { animation.cancel(); animation.currentTime = 0; animation.pause() }); elapsedMs = 0 },
    destroy() { animations.forEach(animation => animation.cancel()) },
  }
}

