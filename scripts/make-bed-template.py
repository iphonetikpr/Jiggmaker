#!/usr/bin/env python3
"""Rasterize the eufyMake E1 bed overlay used by the preview canvas.

Inner blue rectangle aspect is Mini (333×88). Preview code maps that rectangle
to Mini 333×88, Frame 334×90, or Large 333×418.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 8 px per Mini-mm in the printable area → crisp on retina canvases
PX_PER_MM = 8
INNER_W = 333 * PX_PER_MM  # 2664
INNER_H = 88 * PX_PER_MM  # 704
PAD_L = 96
PAD_T = 96
PAD_B = 96
PAD_R = 288  # extra for top-right chamfer
IMG_W = PAD_L + INNER_W + PAD_R
IMG_H = PAD_T + INNER_H + PAD_B

INNER = (PAD_L, PAD_T, PAD_L + INNER_W, PAD_T + INNER_H)

OUTER_INSET_L = 36
OUTER_INSET_T = 36
OUTER_INSET_B = 36
OUTER_INSET_R = 72
CORNER_R = 52
CHAMFER = 118

PINK = (232, 88, 120, 255)
BLUE = (74, 168, 255, 255)
GREEN = (61, 220, 151, 255)
BLACK = (0, 0, 0, 255)


def arc(cx: float, cy: float, r: float, a0: float, a1: float, n: int = 14) -> list[tuple[float, float]]:
    pts = []
    for i in range(n + 1):
        t = a0 + (a1 - a0) * (i / n)
        pts.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return pts


def outer_plate_path() -> list[tuple[float, float]]:
    l = INNER[0] - OUTER_INSET_L
    t = INNER[1] - OUTER_INSET_T
    r = INNER[2] + OUTER_INSET_R
    b = INNER[3] + OUTER_INSET_B
    rad = CORNER_R
    ch = CHAMFER
    pts: list[tuple[float, float]] = []
    # Start after top-left corner, going right along top
    pts += arc(l + rad, t + rad, rad, -math.pi, -math.pi / 2)
    pts.append((r - ch, t))
    pts.append((r, t + ch))  # chamfer (top-right)
    pts += arc(r - rad, b - rad, rad, 0, math.pi / 2)
    pts += arc(l + rad, b - rad, rad, math.pi / 2, math.pi)
    return pts


def main() -> None:
    img = Image.new("RGBA", (IMG_W, IMG_H), BLACK)
    draw = ImageDraw.Draw(img)

    outer = outer_plate_path()
    draw.line(outer + [outer[0]], fill=PINK, width=3, joint="curve")

    draw.rectangle(INNER, outline=BLUE, width=2)

    ox, oy = INNER[0], INNER[3]
    arm = 44
    draw.line([(ox, oy - arm), (ox, oy), (ox + arm, oy)], fill=BLUE, width=4)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 28)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 22)
    except OSError:
        font = ImageFont.load_default()
        small = font
    draw.text((ox + 12, oy - 40), "0,0", fill=BLUE, font=small)

    gx, gy = INNER[2], INNER[3]
    draw.line([(gx - arm, gy), (gx, gy), (gx, gy - arm)], fill=GREEN, width=4)

    cx = (INNER[0] + INNER[2]) / 2
    cy = (INNER[1] + INNER[3]) / 2
    d = 34
    diamond = [(cx, cy - d), (cx + d, cy), (cx, cy + d), (cx - d, cy), (cx, cy - d)]
    draw.line(diamond, fill=BLUE, width=3)
    bbox = draw.textbbox((0, 0), "A1", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    draw.text((cx - tw / 2, cy - th / 2 - 2), "A1", fill=BLUE, font=font)

    out = Path(__file__).resolve().parents[1] / "public" / "bed-template.png"
    img.save(out, "PNG")
    meta = {
        "imageW": IMG_W,
        "imageH": IMG_H,
        "inner": {"x": INNER[0], "y": INNER[1], "w": INNER_W, "h": INNER_H},
    }
    print(json.dumps(meta))
    print(f"wrote {out} {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
