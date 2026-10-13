// New assets use the matching resource/overviews settings from the local CS2 VPK.
export const radarMetadata = {
  de_cache: { x: -2000, y: 3250, scale: 5.5 },
  de_ancient: { x: -2953, y: 2164, scale: 5 },
  de_mirage: { x: -3230, y: 1713, scale: 5 },
  de_inferno: { x: -2087, y: 3870, scale: 4.9 },
  de_dust2: { x: -2476, y: 3239, scale: 4.4 },
  de_anubis: { x: -2796, y: 3328, scale: 5.22 },
  de_nuke: { x: -3453, y: 2887, scale: 7 },
  de_overpass: { x: -4831, y: 1781, scale: 5.2 },
  de_train: { x: -2308, y: 2078, scale: 4.082077 },
  de_vertigo: { x: -3168, y: 1762, scale: 4 },
}

// Nuke's lower overview contains large empty margins. The crop is applied
// only to rendering; world coordinates still use the original overview.
export const radarCrops = {
  // Focus the inset on Nuke's lower-floor rooms instead of the full-map shell.
  de_nuke: { x: 280, y: 340, width: 650, height: 460 },
}

export function isRadarImage(image) {
  return Boolean(image?.complete && image.naturalWidth >= 1024 && image.naturalWidth === image.naturalHeight)
}
