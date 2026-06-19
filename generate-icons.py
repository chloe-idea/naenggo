#!/usr/bin/env python3
"""Generate PWA PNG icons (stdlib only)."""
import os
import struct
import zlib

BG = (255, 107, 53)       # #ff6b35
WHITE = (255, 255, 255)
WINDOW = (255, 244, 239)  # primary-light
HANDLE = (229, 90, 43)    # primary-dark


def inside_round_rect(x, y, cx, cy, w, h, r):
    dx = abs(x - cx) - (w / 2 - r)
    dy = abs(y - cy) - (h / 2 - r)
    if dx <= 0 and dy <= 0:
        return True
    if dx > 0 and dy > 0:
        return dx * dx + dy * dy <= r * r
    return dx <= 0 or dy <= 0


def pixel_color(x, y, size, maskable=False):
    pad = size * (0.1 if maskable else 0.08)
    cx = cy = size / 2
    w = size * (0.52 if maskable else 0.46)
    h = size * (0.58 if maskable else 0.54)
    r = size * 0.09

    if not inside_round_rect(x, y, cx, cy, w, h, r):
        return BG + (255,)

    door_y = cy + h * 0.06
    if y < door_y and abs(x - cx) <= w * 0.34:
        return WINDOW + (255,)

    handle_w = size * 0.035
    handle_h = size * 0.12
    hx = cx + w * 0.18
    hy = cy + h * 0.08
    if abs(x - hx) <= handle_w and abs(y - hy) <= handle_h:
        return HANDLE + (255,)

    divider = abs(y - (cy - h * 0.02)) <= size * 0.012
    if divider and abs(x - cx) <= w * 0.38 and y < cy:
        return WINDOW + (255,)

    return WHITE + (255,)


def write_png(path, size, maskable=False):
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            row.extend(pixel_color(x, y, size, maskable))
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


def main():
    out = os.path.join(os.path.dirname(__file__), 'icons')
    os.makedirs(out, exist_ok=True)
    write_png(os.path.join(out, 'icon-180.png'), 180)
    write_png(os.path.join(out, 'icon-192.png'), 192)
    write_png(os.path.join(out, 'icon-512.png'), 512)
    write_png(os.path.join(out, 'icon-512-maskable.png'), 512, maskable=True)
    print('Wrote icons to', out)


if __name__ == '__main__':
    main()
