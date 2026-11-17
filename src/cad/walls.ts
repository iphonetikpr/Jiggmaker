import { MIN_WALL_EXTRA_MM } from "../constants";
import type { Loop } from "../types";
import { bboxOf } from "./geom";
import { leadInDepth } from "./leadIn";

/** clearance + lead-in chamfer + extra wall, measured from the pocket seat. */
export function requiredWallMm(clearance: number, chamfer: number): number {
  return Math.max(0, clearance) + Math.max(0, chamfer) + MIN_WALL_EXTRA_MM;
}

export function edgeGapMm(loop: Loop, plateW: number, plateH: number): number {
  const b = bboxOf([loop]);
  return Math.min(b.minX, b.minY, plateW - b.maxX, plateH - b.maxY);
}

/** Positive when the seats are apart. Negative when their boxes overlap. */
export function seatGapMm(a: Loop[], b: Loop[]): number {
  let best = Infinity;
  for (const la of a) {
    for (const lb of b) {
      const ba = bboxOf([la]);
      const bb = bboxOf([lb]);
      const ox = Math.min(ba.maxX, bb.maxX) - Math.max(ba.minX, bb.minX);
      const oy = Math.min(ba.maxY, bb.maxY) - Math.max(ba.minY, bb.minY);
      let gap: number;
      if (ox > 0 && oy > 0) gap = -Math.min(ox, oy);
      else if (ox > 0) gap = -oy;
      else if (oy > 0) gap = -ox;
      else gap = Math.hypot(-ox, -oy);
      if (gap < best) best = gap;
    }
  }
  return best;
}

export interface WallPiece {
  label: string;
  clearance: number;
  leadIn: boolean;
  loops: Loop[];
}

export function wallBlockers(pieces: WallPiece[], plateW: number, plateH: number): string[] {
  const problems: string[] = [];
  const reqs = pieces.map((piece) => {
    const chamfer = piece.loops.reduce((max, loop) => Math.max(max, leadInDepth(loop, piece.leadIn)), 0);
    return requiredWallMm(piece.clearance, chamfer);
  });
  pieces.forEach((piece, i) => {
    if (!piece.loops.length) return;
    const gap = Math.min(...piece.loops.map((loop) => edgeGapMm(loop, plateW, plateH)));
    if (gap < reqs[i] - 1e-3) {
      problems.push(`${piece.label} (margen ${gap.toFixed(1)} mm, mínimo ${reqs[i].toFixed(1)} mm)`);
    }
  });
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const gap = seatGapMm(pieces[i].loops, pieces[j].loops);
      if (gap < -0.05) continue;
      const req = Math.max(reqs[i], reqs[j]);
      if (gap < req - 1e-3) {
        problems.push(`${pieces[i].label}–${pieces[j].label} (pared ${gap.toFixed(1)} mm, mínimo ${req.toFixed(1)} mm)`);
      }
    }
  }
  if (!problems.length) return [];
  return [`Pared insuficiente: ${problems.join("; ")}`];
}
