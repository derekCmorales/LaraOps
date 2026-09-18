#!/usr/bin/env python3
"""Generate LaraOps favicon PNG/ICO assets from public/favicon.svg."""

from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web" / "public"

# 32x32 "L" mark on #0a1628 — hand-tuned bitmap (1 = ink, 0 = bg)
# Rows are top-to-bottom; each row is 32 bits.
BITMAP = [
    0x00000000,
    0x1FF00000,
    0x1FF00000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x18000000,
    0x00000000,
    0x00000000,
]

BG = (10, 22, 40, 255)  # #0a1628
FG = (255, 255, 255, 255)


def render(size: int) -> list[tuple[int, int, int, int]]:
    pixels: list[tuple[int, int, int, int]] = []
    for y in range(size):
        for x in range(size):
            sx = x * 32 // size
            sy = y * 32 // size
            on = (BITMAP[sy] >> (31 - sx)) & 1
            pixels.append(FG if on else BG)
    return pixels


def write_png(path: Path, size: int) -> None:
    pixels = render(size)
    raw = b"".join(
        b"\x00" + bytes(pixels[i * size + j] for j in range(size))
        for i in range(size)
    )
    compressed = zlib.compress(raw, 9)

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", compressed) + chunk(b"IEND", b"")
    path.write_bytes(png)


def write_ico(path: Path, sizes: list[int]) -> None:
    images: list[bytes] = []
    for size in sizes:
        pixels = render(size)
        # BGRA, bottom-up for ICO
        bmp = b""
        for y in range(size - 1, -1, -1):
            row = b"\x00"
            for x in range(size):
                r, g, b, a = pixels[y * size + x]
                row += bytes((b, g, r, a))
            bmp += row
        and_mask = b"\x00" * (((size + 31) // 32) * 4 * size)
        image_data = struct.pack("<IIIHH", 40, size, size * 2, 1, 32) + bmp + and_mask
        images.append(image_data)

    offset = 6 + 16 * len(images)
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    data = b""
    for size, image_data in zip(sizes, images):
        entries += struct.pack(
            "<BBBBHHII",
            size if size < 256 else 0,
            size if size < 256 else 0,
            0,
            0,
            1,
            32,
            len(image_data),
            offset + len(data),
        )
        data += image_data
    path.write_bytes(header + entries + data)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "favicon-16x16.png", 16)
    write_png(OUT / "favicon-32x32.png", 32)
    write_png(OUT / "apple-touch-icon.png", 180)
    write_ico(OUT / "favicon.ico", [16, 32])
    print("Wrote favicons to", OUT)


if __name__ == "__main__":
    main()
