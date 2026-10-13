// Presentation geometry uses the original 1024px radar coordinate system.
// These polygons trace the highlighted plant zones in the bundled radar assets.
const bombsites = {
  de_mirage: [
    { name: 'A', points: [[524,724],[584,724],[608,787],[568,810],[523,810]] },
    { name: 'B', points: [[199,248],[274,248],[274,329],[199,329]] },
  ],
  de_inferno: [
    { name: 'A', points: [[794,643],[868,643],[868,753],[794,753]] },
    { name: 'B', points: [[466,180],[529,180],[543,195],[543,253],[529,268],[466,268],[453,253],[453,195]] },
  ],
  de_dust2: [
    { name: 'A', points: [[781,139],[847,139],[847,207],[798,207],[798,187],[781,187]] },
    { name: 'B', points: [[171,83],[219,83],[254,103],[254,150],[256,175],[171,175]] },
  ],
  de_ancient: [
    { name: 'A', points: [[272,242],[348,242],[348,292],[272,292]] },
    { name: 'B', points: [[720,392],[786,392],[802,399],[812,416],[805,436],[789,448],[720,448]] },
  ],
  de_cache: [
    { name: 'A', points: [[290,220],[358,220],[358,326],[290,326]] },
    { name: 'B', points: [[305,782],[405,782],[405,876],[305,876]] },
  ],
}

export function radarPoint(x, y, meta, width, height) {
  if (x == null || y == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y)) || !meta || !Number.isFinite(meta.x) || !Number.isFinite(meta.y) || !(meta.scale > 0)) return null
  const px = (Number(x) - meta.x) / meta.scale
  const py = (meta.y - Number(y)) / meta.scale
  const crop = meta.crop || { x: 0, y: 0, width: 1024, height: 1024 }
  return { x: (px - crop.x) / crop.width * width, y: (py - crop.y) / crop.height * height }
}

export function radarNumbers(players) {
  const result = new Map()
  // Keep one unique match-wide identity: the first side uses 1–5, while the
  // other side uses 6–9,0. This keeps radar markers, cards and POV buttons
  // unambiguous while preserving the displayed order within each side.
  for (const [team, offset] of [[2, 0], [3, 5]]) {
    players.filter(p => Number(p.teamNumber) === team)
      .forEach((p, index) => result.set(String(p.steamid), String((offset + index + 1) % 10)))
  }
  return result
}

const layers = new WeakMap()
function contourLayer(image) {
  if (layers.has(image)) return layers.get(image)
  const layer = document.createElement('canvas')
  layer.width = image.naturalWidth
  layer.height = image.naturalHeight
  const ctx = layer.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  try {
    const original = ctx.getImageData(0, 0, layer.width, layer.height)
    const outline = ctx.createImageData(layer.width, layer.height)
    const tone = i => original.data[i + 3] < 32 ? 0 : (original.data[i] + original.data[i + 1] + original.data[i + 2]) / 3
    for (let y = 1; y < layer.height - 1; y++) {
      for (let x = 1; x < layer.width - 1; x++) {
        const i = (y * layer.width + x) * 4, level = tone(i)
        if (level < 32) continue
        const near = [tone(i - 4), tone(i + 4), tone(i - layer.width * 4), tone(i + layer.width * 4)]
        const outer = near.some(n => n < 28)
        if (!outer && !near.some(n => level - n > 32)) continue
        outline.data.set([232, 233, 216, outer ? 150 : 65], i)
      }
    }
    ctx.clearRect(0, 0, layer.width, layer.height)
    ctx.putImageData(outline, 0, 0)
  } catch {
    // Asset errors must not hide the original radar or interrupt playback.
    ctx.clearRect(0, 0, layer.width, layer.height)
  }
  layers.set(image, layer)
  return layer
}

export function drawRadarMap(ctx, image, map, width, height, meta) {
  if (!image?.complete || !image.naturalWidth) return
  ctx.save()
  ctx.globalAlpha = .88
  const crop = meta?.crop
  if (crop) ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  else ctx.drawImage(image, 0, 0, width, height)
  ctx.globalAlpha = 1
  if (crop) ctx.drawImage(contourLayer(image), crop.x, crop.y, crop.width, crop.height, 0, 0, width, height)
  else ctx.drawImage(contourLayer(image), 0, 0, width, height)
  for (const site of bombsites[map] || []) {
    const points = site.points.map(([x, y]) => [x / 1024 * width, y / 1024 * height])
    ctx.beginPath()
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))
    ctx.closePath()
    ctx.fillStyle = '#f5d84ccc'
    ctx.fill()
    ctx.strokeStyle = '#ffeb80'
    ctx.lineWidth = 1.5
    ctx.stroke()
    const x = points.reduce((s, p) => s + p[0], 0) / points.length
    const y = points.reduce((s, p) => s + p[1], 0) / points.length
    ctx.font = `800 ${Math.max(14, width * .025)}px Inter, sans-serif`
    ctx.fillStyle = '#202616'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(site.name, x, y)
  }
  ctx.restore()
}

export function drawPlayerMarker(ctx, { x, y, yaw, number, color, dead, selected, hovered, radius }) {
  ctx.save()
  ctx.translate(x, y)
  if (selected || hovered) {
    ctx.beginPath()
    ctx.arc(0, 0, radius + 3, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff8c7'
    ctx.lineWidth = 2
    ctx.stroke()
  }
  ctx.globalAlpha = dead ? .4 : 1
  ctx.save()
  ctx.rotate(Math.PI / 2 - yaw * Math.PI / 180)
  ctx.beginPath()
  if (dead) ctx.arc(0, 0, radius, 0, Math.PI * 2)
  else {
    ctx.moveTo(0, -radius - 4)
    ctx.lineTo(radius * .84, -radius * .53)
    ctx.arc(0, 0, radius, -Math.PI / 6, Math.PI * 7 / 6)
    ctx.closePath()
  }
  ctx.fillStyle = color
  ctx.shadowColor = '#0009'
  ctx.shadowBlur = 4
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = dead ? '#b7c1b7' : '#eaf7ef'
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.restore()
  ctx.font = `800 ${radius * 1.25}px Inter, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#152526'
  ctx.fillText(number ?? '?', 0, .5)
  if (dead) {
    ctx.globalAlpha = .9
    ctx.strokeStyle = '#e4e7df'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(radius - 2, -radius - 2)
    ctx.lineTo(radius + 4, -radius + 4)
    ctx.moveTo(radius + 4, -radius - 2)
    ctx.lineTo(radius - 2, -radius + 4)
    ctx.stroke()
  }
  ctx.restore()
}

export function drawPlayerTooltip(ctx, player, point, width, height) {
  const state = player.dead ? '阵亡' : player.health == null ? '血量未知' : `${player.health} HP`
  const text = `${player.number} · ${player.name || '未知玩家'} · ${state}`
  ctx.save()
  ctx.font = '600 12px Inter, sans-serif'
  const boxWidth = Math.min(width - 16, ctx.measureText(text).width + 20)
  const x = Math.max(8, Math.min(width - boxWidth - 8, point.x + 20))
  const y = Math.max(8, Math.min(height - 32, point.y - 32))
  ctx.fillStyle = '#111b19f5'
  ctx.fillRect(x, y, boxWidth, 26)
  ctx.strokeStyle = player.color
  ctx.lineWidth = 1
  ctx.strokeRect(x, y, boxWidth, 26)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#f2f4e8'
  ctx.fillText(text, x + 10, y + 13, boxWidth - 20)
  ctx.restore()
}
