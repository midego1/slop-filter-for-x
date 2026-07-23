#!/usr/bin/env python3
"""Slop Filter icon: AI sparkle with a prohibition slash, crimson gradient.
Pure stdlib PNG output, supersampled for clean anti-aliasing."""
import struct, zlib, sys, os

def lerp(a, b, t): return a + (b - a) * t

def render(size, ss=6):
    S = size * ss
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]

    # palette
    top = (216, 34, 88)      # crimson
    bot = (94, 13, 56)       # deep plum
    white = (255, 255, 255)
    slash_c = (46, 6, 27)    # near-black plum

    radius = 0.225 * S       # corner radius
    cx = cy = S / 2

    tiny = size <= 16
    big_r = (0.42 if tiny else 0.35) * S   # main sparkle radius
    sm_r = 0.115 * S                        # secondary sparkle (omitted when tiny)
    sm_x, sm_y = S * 0.78, S * 0.22
    slash_w = (0.068 if tiny else 0.062) * S  # half-width of slash stripe
    slash_len = 0.54 * S                    # half-length along the diagonal (inset ends)

    def astroid(x, y, cx_, cy_, r):
        dx, dy = abs(x - cx_), abs(y - cy_)
        if dx > r or dy > r: return False
        return (dx / r) ** (2/3) + (dy / r) ** (2/3) <= 1.0

    for y in range(S):
        t = y / S
        bg = tuple(int(lerp(top[i], bot[i], t)) for i in range(3))
        for x in range(S):
            # rounded-rect mask
            qx = max(abs(x - cx) - (cx - radius), 0)
            qy = max(abs(y - cy) - (cy - radius), 0)
            if qx * qx + qy * qy > radius * radius:
                continue
            c = bg
            # sparkles (main, slightly low-left; small echo top-right unless tiny)
            if astroid(x, y, cx * 0.94, cy * 1.05, big_r) or (not tiny and astroid(x, y, sm_x, sm_y, sm_r)):
                c = white
            # prohibition slash: top-left -> bottom-right, ends inset from corners
            perp = abs(y - x) / (2 ** 0.5)
            along = abs((x - cx) + (y - cy)) / (2 ** 0.5)
            if perp < slash_w and along < slash_len:
                c = slash_c
            px[y][x] = (*c, 255)

    # box-downsample ss x ss -> final
    out = []
    for Y in range(size):
        row = []
        for X in range(size):
            r = g = b = a = 0
            for dy in range(ss):
                for dx in range(ss):
                    p = px[Y * ss + dy][X * ss + dx]
                    r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3]
            n = ss * ss
            if a == 0:
                row.append((0, 0, 0, 0))
            else:
                row.append((r // a, g // a, b // a, a // n))
        out.append(row)
    return out

def write_png(path, pixels):
    size = len(pixels)
    raw = b''.join(b'\x00' + b''.join(struct.pack('BBBB', *p) for p in row) for row in pixels)
    def chunk(typ, data):
        c = typ + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f: f.write(png)

outdir = sys.argv[1] if len(sys.argv) > 1 else '.'
for n in (16, 48, 128, 512):
    write_png(os.path.join(outdir, f'icon{n}.png'), render(n, ss=8 if n <= 48 else 6))
    print(f'icon{n}.png done')
