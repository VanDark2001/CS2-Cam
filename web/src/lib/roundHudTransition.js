// Compact adaptation of the Endfield staged HUD rhythm; geometry stays fixed.
import { HUD_EASINGS } from './endfieldHudAnimation.js'
export function roundHudFrames(shift = -55, scale = .45, reduced = false) {
  // Animate the final label itself: no second text layer or font handoff.
  const expanded = reduced ? 'none' : `translateX(${-shift}px) scale(${1 / scale})`
  return {
    title:[{offset:0,opacity:0,transform:expanded},{offset:.12,opacity:1,transform:expanded},{offset:.56,opacity:1,transform:expanded,easing:HUD_EASINGS.smooth},{offset:.94,opacity:1,transform:'none'},{offset:1,opacity:1,transform:'none'}],
    icon:[{offset:0,opacity:0,transform:reduced?'none':'translateX(14px) scale(.88)'},{offset:.66,opacity:0,transform:reduced?'none':'translateX(14px) scale(.88)',easing:HUD_EASINGS.smooth},{offset:.94,opacity:1,transform:'none'},{offset:1,opacity:1,transform:'none'}],
    values:[{offset:0,opacity:0,transform:reduced?'none':'translateY(5px)'},{offset:.76,opacity:0,transform:reduced?'none':'translateY(5px)',easing:HUD_EASINGS.smooth},{offset:1,opacity:1,transform:'none'}],
  }
}
export function createRoundHudTransition(root, { durationMs = 1700, onComplete = () => {} } = {}) {
  const doc = root.ownerDocument
  let animations=[], frame=0, elapsed=0, last=0, active=false
  const cancel = () => {cancelAnimationFrame(frame);frame=0;animations.forEach(a=>a.cancel());animations=[];active=false}
  const render = time => {elapsed=Math.max(0,Math.min(durationMs,time));animations.forEach(a=>{a.currentTime=elapsed})}
  const tick = now => {
    if(!active||doc.hidden)return
    render(elapsed+Math.max(0,now-last));last=now
    if(elapsed>=durationMs){cancel();onComplete();return}
    frame=requestAnimationFrame(tick)
  }
  const visible = () => {
    cancelAnimationFrame(frame)
    if(active&&!doc.hidden){last=performance.now();frame=requestAnimationFrame(tick)}
  }
  doc.addEventListener('visibilitychange',visible)
  return {
    durationMs,
    get elapsedMs(){return elapsed},
    play({targetSelector = '.hud-phase'} = {}){
      cancel();elapsed=0
      const phase=root.querySelector(targetSelector)
      const nodes={title:[phase],icon:[root.querySelector('.hud-icon')],values:[root.querySelector(targetSelector === '.hud-primary' ? '.hud-phase' : '.hud-primary'),root.querySelector('.hud-badge')]}
      const box=root.getBoundingClientRect(), target=phase.getBoundingClientRect()
      const shift=target.left+target.width/2-box.left-box.width/2
      const scale=parseFloat(getComputedStyle(phase).fontSize)/20
      const frames=roundHudFrames(shift,scale,matchMedia('(prefers-reduced-motion: reduce)').matches)
      const colors=getComputedStyle(root)
      frames.title.forEach(f=>{f.color=f.offset<.94 && targetSelector === '.hud-phase'?colors.getPropertyValue('--replay-hud-text').trim():getComputedStyle(phase).color})
      for(const [key,list] of Object.entries(nodes))for(const node of list){const a=node.animate(frames[key],{duration:durationMs,fill:'both',easing:'linear'});a.pause();a.currentTime=0;animations.push(a)}
      active=true;last=performance.now();if(!doc.hidden)frame=requestAnimationFrame(tick)
    },
    render,
    pause(){cancelAnimationFrame(frame);frame=0;active=false},
    resume(){if(!animations.length||active)return;active=true;last=performance.now();if(!doc.hidden)frame=requestAnimationFrame(tick)},
    replay(){this.play()},
    settle(){cancel();elapsed=durationMs},
    destroy(){cancel();doc.removeEventListener('visibilitychange',visible)},
  }
}
