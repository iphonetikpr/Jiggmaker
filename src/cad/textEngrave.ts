import type { Loop } from "../types";
import { rectLoop } from "./geom";

/**
 * Seven-segment digits with a gap between bars so engraved pockets do not share edges.
 * Coordinates are fractions of the glyph height. Glyph width is `W`.
 */
const W = 0.58;
const T = 0.15;
const GAP = 0.04;
const INNER = (1 - 3 * T - 4 * GAP) / 2;

type Seg = [number, number, number, number];

function horiz(y: number): Seg {
  return [T + GAP, y, W - 2 * (T + GAP), T];
}
function vert(x: number, y: number): Seg {
  return [x, y, T, INNER];
}

const LOWER_Y = T + GAP;
const MID_Y = LOWER_Y + INNER + GAP;
const UPPER_Y = MID_Y + T + GAP;
const TOP_Y = UPPER_Y + INNER + GAP;

const A = horiz(TOP_Y);
const G = horiz(MID_Y);
const D = horiz(0);
const F = vert(0, UPPER_Y);
const B = vert(W - T, UPPER_Y);
const E = vert(0, LOWER_Y);
const C = vert(W - T, LOWER_Y);

const DIGITS: Record<string, Seg[]> = {
  "0": [A, B, C, D, E, F],
  "1": [B, C],
  "2": [A, B, G, E, D],
  "3": [A, B, G, C, D],
  "4": [F, G, B, C],
  "5": [A, F, G, C, D],
  "6": [A, F, G, E, C, D],
  "7": [A, B, C],
  "8": [A, B, C, D, E, F, G],
  "9": [A, B, C, D, F, G],
};

/** Outline loops for a clearance label such as `.15`, `height` mm tall, sitting on `y`. */
export function engraveLabel(text: string, x: number, y: number, height: number): Loop[] {
  const loops: Loop[] = [];
  let cursor = x;
  const gap = height * 0.16;
  for (const ch of text) {
    if (ch === ".") {
      const s = height * 0.2;
      loops.push(rectLoop(s, s, cursor, y));
      cursor += s + gap;
      continue;
    }
    const segs = DIGITS[ch];
    if (!segs) continue;
    const gw = height * W;
    for (const [sx, sy, sw, sh] of segs) {
      loops.push(rectLoop(sw * height, sh * height, cursor + sx * height, y + sy * height));
    }
    cursor += gw + gap;
  }
  return loops;
}
