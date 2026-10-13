// Every POV starts at the shared round origin, including legacy death clips.
export function povPlaybackSeconds(tick, startTick, tickRate = 64) {
  return Math.max(0, (Number(tick) - Number(startTick)) / tickRate)
}

export function povPlaybackTick(seconds, startTick, endTick, tickRate = 64) {
  return Math.max(Number(startTick), Math.min(Number(endTick), Number(startTick) + seconds * tickRate))
}

export function isPovAutomaticPause(video, switchingSource = false) {
  return switchingSource || video.ended
}
