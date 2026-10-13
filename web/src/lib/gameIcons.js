// CS2 Panorama inventory renders already extracted into public/weapons.
// Bounds omit transparent padding without changing the source PNG files.
const bounds = {
  smokegrenade: [197, 58, 135, 275], hegrenade: [178, 98, 148, 196],
  flashbang: [211, 32, 141, 336], molotov: [159, 0, 169, 384],
  incgrenade: [205, 91, 104, 211], decoy: [211, 32, 141, 336], c4: [117, 29, 264, 326],
}
const icons = new Map()
export function loadGameIcons(assetUrl, redraw) {
  if (typeof Image === 'undefined' || icons.size) return
  for (const [name, crop] of Object.entries(bounds)) {
    const image = new Image(), fallback = new Image()
    icons.set(name, { image, fallback, crop })
    image.onload = redraw
    image.onerror = redraw
    fallback.onload = redraw
    image.src = assetUrl(`/weapons/${name}.png`)
    fallback.src = assetUrl(`/weapons-flat/${name}.svg`)
  }
}

export function drawGameIcon(ctx, name, x, y, height, angle = 0) {
  const icon = icons.get(name)
  if (!icon) return
  // Map markers use the flat CS2 glyphs consistently. The extracted PNGs are
  // reserved for inventory/player cards where their colored treatment helps.
  const image = icon.fallback
  if (!image.complete || !image.naturalWidth) return
  const [sx, sy, sw, sh] = [0, 0, image.naturalWidth, image.naturalHeight]
  const width = height * sw / sh
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle)
  ctx.shadowColor = '#000b'; ctx.shadowBlur = 2
  ctx.drawImage(image, sx, sy, sw, sh, -width / 2, -height / 2, width, height)
  ctx.restore()
}
