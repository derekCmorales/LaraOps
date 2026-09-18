#!/usr/bin/env python3
"""Generate LaraOps favicon PNG/ICO assets from web/public/favicon.svg."""

from __future__ import annotations

import io
from pathlib import Path

import cairosvg
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SVG = ROOT / "web" / "public" / "favicon.svg"
OUT = ROOT / "web" / "public"


def main() -> None:
    svg = SVG.read_text(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)

    for size, name in ((16, "favicon-16x16.png"), (32, "favicon-32x32.png"), (180, "apple-touch-icon.png")):
        (OUT / name).write_bytes(cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size))

    imgs = [
        Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode(), output_width=s, output_height=s)))
        for s in (16, 32)
    ]
    imgs[0].save(OUT / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32)], append_images=imgs[1:])
    print(f"Wrote favicons to {OUT}")


if __name__ == "__main__":
    main()
