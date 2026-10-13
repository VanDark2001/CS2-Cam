"""Generate the geometric desktop mark and Windows icon (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

DEST = Path(__file__).resolve().parents[1] / 'electron/assets'
# Shared polygon geometry keeps the editable vector and raster assets identical.
SHAPES = [
    ('#474941', [(58, 16), (454, 16), (496, 58), (496, 454), (454, 496), (58, 496), (16, 454), (16, 58)]),
    ('#191a19', [(61, 24), (451, 24), (488, 61), (488, 451), (451, 488), (61, 488), (24, 451), (24, 61)]),
    ('#c6ca4c', [(88, 176), (88, 112), (112, 88), (176, 88), (176, 116), (124, 116), (116, 124), (116, 176)]),
    ('#c6ca4c', [(336, 88), (400, 88), (424, 112), (424, 176), (396, 176), (396, 124), (388, 116), (336, 116)]),
    ('#c6ca4c', [(88, 304), (116, 304), (116, 356), (124, 364), (176, 364), (176, 392), (112, 392), (88, 368)]),
    ('#c6ca4c', [(396, 304), (424, 304), (424, 368), (400, 392), (336, 392), (336, 364), (388, 364), (396, 356)]),
    ('#e9e7e4', [(216, 152), (352, 240), (216, 328)]),
    ('#c6ca4c', [(216, 364), (240, 364), (240, 392), (216, 392)]),
    ('#c6ca4c', [(256, 364), (280, 364), (280, 392), (256, 392)]),
    ('#474941', [(296, 364), (320, 364), (320, 392), (296, 392)]),
]


def main():
    DEST.mkdir(parents=True, exist_ok=True)
    polygons = '\n'.join(f'  <polygon fill="{color}" points="' + ' '.join(f'{x},{y}' for x, y in points) + '"/>' for color, points in SHAPES)
    (DEST / 'app-icon.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n' + polygons + '\n</svg>\n', encoding='utf-8')
    scale = 4
    image = Image.new('RGBA', (512 * scale, 512 * scale))
    draw = ImageDraw.Draw(image)
    for color, points in SHAPES:
        draw.polygon([(x * scale, y * scale) for x, y in points], fill=color)
    image = image.resize((512, 512), Image.Resampling.LANCZOS)
    image.save(DEST / 'app-icon.png')
    image.save(DEST / 'app-icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    print(f'Generated desktop icons in {DEST}')


if __name__ == '__main__':
    main()
