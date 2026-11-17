import { MIN_WALL_EXTRA_MM } from "../constants";
import type { Loop } from "../types";
import { formatMm } from "./format";
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

/** Next margin the number field can show: round the threshold up to a 0.5 mm step. */
export function suggestedMarginMm(required: number): number {
  const step = 0.5;
  return Math.ceil((required - 1e-9) / step) * step;
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
      problems.push(
        `Pared insuficiente: ${piece.label} (margen ${formatMm(Math.max(0, gap), 2)} mm, mínimo ${formatMm(reqs[i], 2)} mm). Sube el margen a ${formatMm(suggestedMarginMm(reqs[i]), 2)} mm.`,
      );
    }
  });
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const gap = seatGapMm(pieces[i].loops, pieces[j].loops);
      if (gap < -0.05) continue;
      const req = Math.max(reqs[i], reqs[j]);
      if (gap < req - 1e-3) {
        problems.push(
          `Pared insuficiente: ${pieces[i].label}–${pieces[j].label} (pared ${formatMm(Math.max(0, gap), 2)} mm, mínimo ${formatMm(req, 2)} mm). Sepáralas o reduce el chaflán.`,
        );
      }
    }
  }
  return problems;
}
