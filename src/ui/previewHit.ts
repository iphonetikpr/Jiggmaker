import { pointInPoly } from "../cad/geom";
import type { Loop, PlacedPiece, Pt } from "../types";

/** Pocket outline first (jiggenerator), then the visible art silhouette. */
export function hitLoopsOf(piece: PlacedPiece): Loop[] {
  const loops = piece.loops.length ? piece.loops : [];
  const art = piece.art.length && piece.art !== piece.loops ? piece.art : [];
  return loops.length ? loops.concat(art) : art;
}

function distToSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function distToLoop(p: Pt, loop: Loop): number {
  if (loop.length < 2) return Infinity;
  let best = Infinity;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    best = Math.min(best, distToSeg(p, loop[j], loop[i]));
  }
  return best;
}

/** Grab a piece when the pointer is inside its silhouette or on the outline. */
export function hitPieceLabel(placed: PlacedPiece[], x: number, y: number, slopMm = 0.75): string | null {
  const pt: Pt = [x, y];
  for (let i = placed.length - 1; i >= 0; i--) {
    const piece = placed[i];
    for (const loop of hitLoopsOf(piece)) {
      if (loop.length < 3) continue;
      if (pointInPoly(pt, loop) || distToLoop(pt, loop) <= slopMm) return piece.label;
    }
  }
  return null;
}
