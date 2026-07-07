#!/usr/bin/env python3
"""Generate src/assets/recipe-images/*.svg and *.png category fallbacks."""
import os
import struct
import subprocess
import zlib

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'src', 'assets', 'recipe-images')

ASSETS = {
    'default': ('🍽️', '#fff4ef', '#ffd8c8', '요리'),
    'egg': ('🥚', '#fffaf0', '#ffe8b8', '계란 요리'),
    'tomato-egg': ('🍅', '#fff5f0', '#ffd4c4', '토마토·계란'),
    'pasta': ('🍝', '#fff6f0', '#ffdccc', '파스타'),
    'stew': ('🍲', '#fff8f2', '#ffd9c2', '찌개'),
    'rice': ('🍚', '#fffaf5', '#f5dfc8', '밥 요리'),
    'potato': ('🥔', '#fffaf5', '#edd9b0', '감자 요리'),
    'noodle': ('🍜', '#fffaf5', '#ffe3c4', '면 요리'),
    'soup': ('🥣', '#f7fbff', '#d6eaff', '국·탕'),
    'stir-fry': ('🥘', '#fff7f0', '#ffd2b0', '볶음'),
}


def hex_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lerp(a, b, t):
    return int(a + (b - a) * t)


def svg_content(emoji, c1, c2, label):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <rect width="400" height="400" fill="url(#g)"/>
  <ellipse cx="200" cy="310" rx="130" ry="20" fill="#000" opacity="0.06"/>
  <circle cx="200" cy="175" r="88" fill="#fff" opacity="0.38"/>
  <text x="200" y="205" text-anchor="middle" font-size="108">{emoji}</text>
  <text x="200" y="355" text-anchor="middle" font-family="Noto Sans KR, Apple SD Gothic Neo, sans-serif" font-size="22" font-weight="700" fill="#5a4035" opacity="0.75">{label}</text>
</svg>'''


def write_png(path, c1, c2, accent):
    size = 400
    c1 = hex_rgb(c1)
    c2 = hex_rgb(c2)
    accent = hex_rgb(accent)
    rows = []
    cx = cy = size / 2
    for y in range(size):
        row = bytearray([0])
        t = y / (size - 1)
        bg = (
            lerp(c1[0], c2[0], t),
            lerp(c1[1], c2[1], t),
            lerp(c1[2], c2[2], t),
            255,
        )
        for x in range(size):
            dx = x - cx
            dy = y - (cy - 20)
            dist = (dx * dx + dy * dy) ** 0.5
            if dist < 92:
                alpha = max(0, min(1, (92 - dist) / 18))
                r = lerp(bg[0], 255, 0.35 * alpha)
                g = lerp(bg[1], 255, 0.35 * alpha)
                b = lerp(bg[2], 255, 0.35 * alpha)
                row.extend((r, g, b, 255))
            elif dist < 78 and dy < 0:
                row.extend((accent[0], accent[1], accent[2], 255))
            else:
                row.extend(bg)
        rows.append(bytes(row))

    raw = b''.join(rows)

    def chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

    ihdr = struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)
    png = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    with open(path, 'wb') as f:
        f.write(png)


ACCENT = {
    'default': '#ff8a65',
    'egg': '#ffc107',
    'tomato-egg': '#e53935',
    'pasta': '#ff7043',
    'stew': '#d84315',
    'rice': '#c9a227',
    'potato': '#b8860b',
    'noodle': '#ff9800',
    'soup': '#42a5f5',
    'stir-fry': '#ff5722',
}


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (_emoji, c1, c2, label) in ASSETS.items():
        svg_path = os.path.join(OUT, f'{name}.svg')
        png_path = os.path.join(OUT, f'{name}.png')
        with open(svg_path, 'w', encoding='utf-8') as f:
            f.write(svg_content(_emoji, c1, c2, label))
        write_png(png_path, c1, c2, ACCENT.get(name, '#ff8a65'))
    print('Wrote assets to', OUT)


if __name__ == '__main__':
    main()
