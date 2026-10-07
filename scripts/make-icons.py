#!/usr/bin/env python3
"""Generate reading-light PNG icons without external libraries."""
import struct, zlib, sys, os, math

def png(width, height, pixels):
    raw = b''.join(b'\x00' + bytes(pixels[y]) for y in range(height))
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def icon(size):
    rows = []
    cx = cy = size / 2
    r = size * 0.42
    for y in range(size):
        row = []
        for x in range(size):
            d = math.hypot(x - cx, y - cy) / r
            # glow: amber centre fading to deep red edge, black outside the disc
            if d > 1.08:
                row += [0, 0, 0]
            else:
                k = max(0.0, 1 - d) ** 0.6
                row += [int(255 * min(1, 0.35 + 0.65 * k)), int(64 * k), 0]
        rows.append(row)
    return png(size, size, rows)

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for s in (180, 512):
    with open(os.path.join(out, f'icon-{s}.png'), 'wb') as f:
        f.write(icon(s))
print('ok')
